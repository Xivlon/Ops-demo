import { Pool } from '@neondatabase/serverless';
import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env, JWTPayload } from '../../../shared/types';
import { createRepositories } from '../../../shared/repositories';

// Debug logging for inspect console
function debug(...args: unknown[]) {
  console.log('[STORAGE-WORKER]', ...args);
}

// JWT utilities (copied from shared/utils/jwt to avoid import issues)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const arr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): ArrayBuffer {
  const base64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + (4 - (str.length % 4)) % 4, '=');
  const bytes = atob(base64).split('').map(c => c.charCodeAt(0));
  return new Uint8Array(bytes).buffer;
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(signature);
}

async function verify(data: string, signature: string, secret: string): Promise<boolean> {
  const expectedSig = await sign(data, secret);
  if (signature.length !== expectedSig.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return result === 0;
}

async function verifyJWT(token: string, env: Env): Promise<JWTPayload | null> {
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    if (!headerB64 || !payloadB64 || !signature) return null;
    
    const signingInput = `${headerB64}.${payloadB64}`;
    const isValid = await verify(signingInput, signature, env.JWT_SECRET);
    if (!isValid) return null;
    
    const payloadArray = new Uint8Array(base64UrlDecode(payloadB64));
    const payloadJson = decoder.decode(payloadArray);
    const payload = JSON.parse(payloadJson) as JWTPayload;
    
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    
    return payload;
  } catch {
    return null;
  }
}

function extractJWT(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookie = request.headers.get('Cookie');
  if (cookie) {
    const match = cookie.match(/token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// Authentication middleware
async function authenticate(request: Request, env: Env): Promise<JWTPayload | null> {
  const token = extractJWT(request);
  if (!token) return null;
  return verifyJWT(token, env);
}

// Create a new pool for each request (Cloudflare Workers requirement)
function createPool(env: Env): Pool {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL not configured');
  }
  return new Pool({ 
    connectionString: env.DATABASE_URL,
    // Optimized for Cloudflare Workers (short-lived connections)
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 1, // Single connection per request
  });
}

// Test database connection
async function testConnection(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  } finally {
    client.release();
  }
}

// Helper for JSON responses with CORS
function jsonResponse(data: unknown, status = 200, origin: string | null = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

// Helper for error responses
function errorResponse(error: string, code: string, status = 400, origin: string | null = '*') {
  return jsonResponse({ success: false, error, code }, status, origin);
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');
    
    debug(`${method} ${path}`, { origin: origin || 'none' });

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    
    // Public endpoints that don't require auth
    const publicPaths = ['/ping', '/health', '/'];
    if (!publicPaths.includes(path)) {
      const auth = await authenticate(request, env);
      if (!auth) {
        debug('Authentication failed for', path);
        return errorResponse('Authentication required', 'UNAUTHORIZED', 401, origin);
      }
      debug('Authenticated user:', auth.sub);
    }

    // Root endpoint - API documentation
    if (path === '/' && method === 'GET') {
      return jsonResponse({
        success: true,
        data: {
          worker: 'storage',
          description: 'Storage operations microservice for Luggster Ops',
          endpoints: [
            { path: '/ping', method: 'GET', description: 'Simple health ping' },
            { path: '/health', method: 'GET', description: 'Health check with DB connection test' },
            { path: '/api/storage', method: 'GET', description: 'List storage orders with filters' },
            { path: '/api/storage/stats', method: 'GET', description: 'Storage statistics' },
            { path: '/api/storage/:id/assign-pickup', method: 'POST', description: 'Assign pickup driver' },
            { path: '/api/storage/:id/assign-delivery', method: 'POST', description: 'Assign delivery driver' },
            { path: '/api/storage/:id/confirm-pickup', method: 'POST', description: 'Confirm pickup' },
            { path: '/api/storage/:id/confirm-storage', method: 'POST', description: 'Confirm storage entry' },
            { path: '/api/storage/:id/status', method: 'POST', description: 'Update status' },
            { path: '/api/storage/:id/cancel', method: 'POST', description: 'Cancel order' },
          ]
        },
        meta: { timestamp: new Date().toISOString() }
      }, 200, origin);
    }

    // Simple ping endpoint
    if (path === '/ping' && method === 'GET') {
      return jsonResponse({ 
        success: true, 
        data: { 
          message: 'pong', 
          worker: 'storage',
          timestamp: new Date().toISOString() 
        } 
      }, 200, origin);
    }

    // Health check endpoint
    if (path === '/health' && method === 'GET') {
      let pool: Pool | undefined;
      try {
        pool = createPool(env);
        const isConnected = await testConnection(pool);
        await pool.end();
        
        return jsonResponse({ 
          success: true, 
          data: { 
            connected: isConnected,
            message: 'Database connection OK',
            worker: 'storage'
          }
        }, 200, origin);
      } catch (error) {
        if (pool) {
          await pool.end().catch(() => {});
        }
        debug('Health check failed:', error);
        return errorResponse(
          'Database connection failed',
          'DB_ERROR',
          503,
          origin
        );
      }
    }

    // Initialize repositories for this request
    let repos;
    let pool;
    try {
      pool = createPool(env);
      repos = createRepositories(pool);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Database connection failed';
      console.error('Repository initialization error:', error);
      return errorResponse('Database connection failed', 'DB_ERROR', 503, origin);
    }

    try {
      // ===== STORAGE ENDPOINTS =====

      // Storage list
      if (path === '/api/storage' && method === 'GET') {
        const status = url.searchParams.get('status') as any;
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        
        const storage = await repos.storage.list({ 
          status: status || undefined, 
          limit, 
          days 
        });
        
        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: storage,
          meta: {
            count: storage.length,
            source: 'storage-worker',
            timestamp: new Date().toISOString()
          }
        }, 200, origin);
      }

      // Storage stats
      if (path === '/api/storage/stats' && method === 'GET') {
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const stats = await repos.storage.getStorageStats(days);
        
        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: stats,
          meta: {
            source: 'storage-worker',
            timestamp: new Date().toISOString()
          }
        }, 200, origin);
      }

      // Assign pickup driver
      const assignPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-pickup$/);
      if (assignPickupMatch && method === 'POST') {
        const storageId = assignPickupMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400, origin);
        }

        const success = await repos.storage.assignPickupDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign pickup driver', 'ASSIGN_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Pickup driver assigned' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Assign delivery driver
      const assignDeliveryMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-delivery$/);
      if (assignDeliveryMatch && method === 'POST') {
        const storageId = assignDeliveryMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400, origin);
        }

        const success = await repos.storage.assignDeliveryDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign delivery driver', 'ASSIGN_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Delivery driver assigned' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Confirm dropoff - customer drops off bags
      const confirmDropoffMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-dropoff$/);
      if (confirmDropoffMatch && method === 'POST') {
        const storageId = confirmDropoffMatch[1];
        
        const success = await repos.storage.confirmDropoff(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm dropoff - order may not be in pending dropoff status', 'CONFIRM_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Dropoff confirmed' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Schedule pickup - customer wants bags back
      const schedulePickupMatch = path.match(/^\/api\/storage\/([^/]+)\/schedule-pickup$/);
      if (schedulePickupMatch && method === 'POST') {
        const storageId = schedulePickupMatch[1];
        
        const success = await repos.storage.schedulePickup(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to schedule pickup - order may not be in storage', 'SCHEDULE_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Pickup scheduled' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Confirm pickup - driver picks up bags
      const confirmPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-pickup$/);
      if (confirmPickupMatch && method === 'POST') {
        const storageId = confirmPickupMatch[1];
        
        const success = await repos.storage.confirmPickup(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm pickup - order may not be in pending pickup status', 'CONFIRM_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Pickup confirmed' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Update storage status
      const updateStatusMatch = path.match(/^\/api\/storage\/([^/]+)\/status$/);
      if (updateStatusMatch && method === 'POST') {
        const storageId = updateStatusMatch[1];
        const body = await request.json() as { status: string };
        
        if (!body.status) {
          await pool.end();
          return errorResponse('status is required', 'MISSING_STATUS', 400, origin);
        }

        const success = await repos.storage.updateStatus(storageId, body.status);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to update status', 'UPDATE_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Status updated' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Cancel storage order
      const cancelStorageMatch = path.match(/^\/api\/storage\/([^/]+)\/cancel$/);
      if (cancelStorageMatch && method === 'POST') {
        const storageId = cancelStorageMatch[1];
        
        const success = await repos.storage.cancel(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to cancel storage order - may already be delivered, cancelled, or not found', 'CANCEL_FAILED', 400, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: { message: 'Storage order cancelled' },
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      // Get single storage by ID
      const getByIdMatch = path.match(/^\/api\/storage\/([^/]+)$/);
      if (getByIdMatch && method === 'GET') {
        const storageId = getByIdMatch[1];
        
        const storage = await repos.storage.findById(storageId);
        
        if (!storage) {
          await pool.end();
          return errorResponse('Storage order not found', 'NOT_FOUND', 404, origin);
        }

        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: storage,
          meta: { source: 'storage-worker' }
        }, 200, origin);
      }

      await pool.end();
      return errorResponse('Not Found', 'NOT_FOUND', 404, origin);

    } catch (error) {
      console.error('Request error:', error);
      const message = error instanceof Error ? error.message : 'Internal error';
      
      if (pool) {
        await pool.end().catch(e => console.error('Failed to close pool:', e));
      }
      
      return errorResponse(message, 'INTERNAL_ERROR', 500, origin);
    }
  },
};

export default worker;
