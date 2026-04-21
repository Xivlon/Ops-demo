import { Pool } from '@neondatabase/serverless';
import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env, LoginRequest, ApiResponse } from '../../../shared/types';
import { createRepositories } from '../../../shared/repositories';
import { authMiddleware, validatePin, requireRole, getRole } from '../../../shared/utils/auth';
import { createJWT, verifyJWT, extractJWT } from '../../../shared/utils/jwt';
import {
  jsonResponse,
  htmlResponse,
  errorResponse,
  unauthorizedResponse,
  corsPreflightResponse,
  clearJWTCookie,
} from '../../../shared/utils/response';
import {
  DASHBOARD_HTML,
  DRIVER_STATS_HTML,
  LOGIN_HTML,
  LOADING_HTML,
  STORAGE_HTML,
} from './generated/html-templates';

// Configuration for driver stats worker
const DEFAULT_DRIVER_STATS_WORKER_URL = 'https://driver-stats.constance-api.workers.dev';
const USE_DRIVER_STATS_WORKER = true; // Set to false to use direct queries
const DRIVER_STATS_TIMEOUT_MS = 10000; // 10 second timeout for proxy requests

// Configuration for storage worker
const DEFAULT_STORAGE_WORKER_URL = 'https://storage.constance-api.workers.dev';
const USE_STORAGE_WORKER = true; // Set to false to disable storage worker and use direct queries
const STORAGE_TIMEOUT_MS = 10000; // 10 second timeout for proxy requests

// Simple in-memory rate limiter for login (per-IP, resets on worker restart)
interface RateLimitEntry { count: number; resetAt: number }
const loginAttempts = new Map<string, RateLimitEntry>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_LOGIN_ATTEMPTS) return false;
  record.count++;
  return true;
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

// Helper to proxy requests to driver stats worker
async function proxyToDriverStatsWorker(
  endpoint: string, 
  origin: string | null,
  request: Request,
  env: Env
): Promise<Response> {
  if (!USE_DRIVER_STATS_WORKER) {
    throw new Error('Driver stats worker not enabled');
  }

  try {
    const workerUrl = env.DRIVER_STATS_WORKER_URL || DEFAULT_DRIVER_STATS_WORKER_URL;
    const url = `${workerUrl}${endpoint}`;
    console.log(`Proxying to driver stats worker: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DRIVER_STATS_TIMEOUT_MS);
    
    // Forward Cookie header for JWT authentication
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const cookie = request.headers.get('Cookie');
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Driver stats worker responded with ${response.status}: ${errorText}`);
    }
    
    // Get the raw response body and pass it through with CORS headers
    const body = await response.text();
    
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      }
    });
    
  } catch (error) {
    console.error('Proxy error:', error);
    throw error;
  }
}

// Helper to proxy requests to storage worker
async function proxyToStorageWorker(
  endpoint: string, 
  method: string, 
  body: unknown | null, 
  origin: string | null,
  request: Request,
  env: Env
): Promise<Response> {
  if (!USE_STORAGE_WORKER) {
    throw new Error('Storage worker not enabled');
  }

  try {
    const workerUrl = env.STORAGE_WORKER_URL || DEFAULT_STORAGE_WORKER_URL;
    const url = `${workerUrl}${endpoint}`;
    console.log(`[PROXY] Storage worker: ${method} ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
    
    // Forward Cookie header for JWT authentication
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const cookie = request.headers.get('Cookie');
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    
    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers,
    };
    
    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, fetchOptions);
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Storage worker responded with ${response.status}: ${errorText}`);
    }
    
    // Get the raw response body and pass it through with CORS headers
    const responseBody = await response.text();
    
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Credentials': 'true',
      }
    });
    
  } catch (error) {
    console.error('Storage proxy error:', error);
    throw error;
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');

    // Simple ping endpoint - no auth, no DB
    if (path === '/ping' && method === 'GET') {
      return jsonResponse({ success: true, data: { message: 'pong', timestamp: new Date().toISOString() } }, 200, true, origin);
    }

    // Connection health check endpoint
    if (path === '/health' && method === 'GET') {
      try {
        const pool = createPool(env);
        const isConnected = await testConnection(pool);
        await pool.end(); // Close pool after health check
        return jsonResponse({ 
          success: true, 
          data: { 
            connected: isConnected,
            message: 'Database connection OK',
            driverStatsWorkerEnabled: USE_DRIVER_STATS_WORKER,
            storageWorkerEnabled: USE_STORAGE_WORKER
          }
        }, 200, true, origin);
      } catch (error) {
        return jsonResponse({ 
          success: false, 
          error: 'Database connection failed'
        }, 503, true, origin);
      }
    }

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return corsPreflightResponse(origin);
    }

    // Auth middleware
    const authResponse = await authMiddleware(request, env);
    if (authResponse) return authResponse;

    // Initialize repositories for this request
    let repos;
    let pool;
    try {
      pool = createPool(env);
      repos = createRepositories(pool);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Database connection failed';
      console.error('Repository initialization error:', error);
      return errorResponse('Database connection failed: ' + error, 'DB_CONNECTION_ERROR', 503);
    }

    try {
      // Health check
      if (path === '/test' && method === 'GET') {
        const start = Date.now();
        const result = await repos.shipments.getDashboardStats(1);
        await pool.end(); // Close pool after request
        return jsonResponse({
          success: true,
          data: { connected: true, latencyMs: Date.now() - start, stats: result },
        }, 200, true, origin);
      }

      // Get current user role
      if (path === '/api/me' && method === 'GET') {
        const role = getRole(request);
        if (!role) {
          await pool.end();
          return unauthorizedResponse();
        }
        await pool.end();
        return jsonResponse({ success: true, data: { role } }, 200, true, origin);
      }

      // Login
      if (path === '/api/login' && method === 'POST') {
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (!checkRateLimit(clientIP)) {
          await pool.end();
          return errorResponse('Too many login attempts. Try again in 15 minutes.', 'RATE_LIMITED', 429);
        }

        const body = await request.json() as LoginRequest;
        
        const role = await validatePin(body.pin, env);
        if (!role) {
          await pool.end();
          return errorResponse('Invalid PIN', 'INVALID_PIN', 401);
        }

        const jwt = await createJWT(env, role);
        
        const response = jsonResponse(
          { success: true, data: { message: 'Login successful', role } },
          200,
          true,
          origin
        );
        
        const expiryHours = parseInt(env.JWT_EXPIRY_HOURS || '24', 10);
        response.headers.set('Set-Cookie', `token=${jwt}; HttpOnly; Secure; SameSite=Strict; Max-Age=${expiryHours * 3600}; Path=/`);
        
        await pool.end(); // Close pool after request
        return response;
      }

      // Logout
      if (path === '/api/logout' && method === 'POST') {
        const response = jsonResponse(
          { success: true, data: { message: 'Logout successful' } },
          200,
          true,
          origin
        );
        response.headers.set('Set-Cookie', clearJWTCookie());
        await pool.end(); // Close pool after request
        return response;
      }

      // Dashboard stats (admin + transport)
      if (path === '/api/dashboard/stats' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        const stats = await repos.shipments.getDashboardStats();
        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: stats }, 200, true, origin);
      }

      // Shipments list (admin + transport)
      if (path === '/api/shipments' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        const status = url.searchParams.get('status') as any;
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        
        const shipments = await repos.shipments.list({ 
          status: status || undefined, 
          limit, 
          days 
        });
        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: shipments }, 200, true, origin);
      }

      // Assign driver (admin + transport)
      const assignMatch = path.match(/^\/api\/shipments\/([^/]+)\/assign$/);
      if (assignMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        const shipmentId = assignMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        const success = await repos.shipments.assignDriver(shipmentId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign driver', 'ASSIGN_FAILED', 400);
        }

        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: { message: 'Driver assigned' } }, 200, true, origin);
      }

      // Cancel shipment (admin + transport)
      const cancelMatch = path.match(/^\/api\/shipments\/([^/]+)\/cancel$/);
      if (cancelMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        const shipmentId = cancelMatch[1];
        
        const success = await repos.shipments.cancel(shipmentId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to cancel order - may already be delivered, cancelled, or not found', 'CANCEL_FAILED', 400);
        }

        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: { message: 'Order cancelled', bknd: true } }, 200, true, origin);
      }

      // DRIVER STATS ENDPOINTS - PROXY TO SEPARATE WORKER
      
      // Drivers list - try proxy first, fallback to direct (admin + transport)
      if (path === '/api/drivers' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers', origin, request, env);
            await pool.end(); // Close pool before returning
            return response;
          } catch (proxyError) {
            console.log('Proxy failed, falling back to direct query:', proxyError);
            // Continue to fallback below
          }
        }
        // Fallback to direct query
        const drivers = await repos.drivers.listAll();
        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: drivers }, 200, true, origin);
      }

      // Online drivers - try proxy first, fallback to direct (admin + transport)
      if (path === '/api/drivers/online' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers/online', origin, request, env);
            await pool.end(); // Close pool before returning
            return response;
          } catch (proxyError) {
            console.log('Proxy failed, falling back to direct query:', proxyError);
            // Continue to fallback below
          }
        }
        // Fallback to direct query
        const drivers = await repos.drivers.listOnline();
        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: drivers }, 200, true, origin);
      }

      // Get driver stats from driver_stats table only (no calculations) (admin + transport)
      if (path === '/api/drivers/stats' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        try {
          const stats = await repos.drivers.getCachedStats();
          await pool.end();
          return jsonResponse({
            success: true,
            data: stats,
            meta: { 
              source: 'driver_stats table',
              count: stats.length,
              timestamp: new Date().toISOString()
            }
          }, 200, true, origin);
        } catch (error) {
          console.error('Driver stats error:', error);
          await pool.end();
          return errorResponse('Failed to load driver stats', 'DRIVER_STATS_ERROR', 500);
        }
      }

      // Get total revenue from shipments table (calculated from price_cents) (admin only)
      if (path === '/api/drivers/revenue' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        try {
          const totalRevenue = await repos.drivers.getTotalRevenue();
          await pool.end();
          return jsonResponse({
            success: true,
            data: { total_revenue: totalRevenue },
            meta: { 
              source: 'shipments table (price_cents)',
              timestamp: new Date().toISOString()
            }
          }, 200, true, origin);
        } catch (error) {
          console.error('Revenue error:', error);
          await pool.end();
          return errorResponse('Failed to load revenue', 'REVENUE_ERROR', 500);
        }
      }

      // Enhanced driver stats endpoint (only available via worker) (admin + transport)
      if (path === '/api/drivers/stats/enhanced' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers/stats/enhanced', origin, request, env);
            await pool.end(); // Close pool before returning
            return response;
          } catch (proxyError) {
            console.log('Enhanced stats proxy failed:', proxyError);
            await pool.end();
            return errorResponse('Enhanced stats not available', 'ENHANCED_STATS_UNAVAILABLE', 503);
          }
        }
        await pool.end();
        return errorResponse('Enhanced stats require driver stats worker', 'WORKER_REQUIRED', 400);
      }

      // ===== STORAGE ENDPOINTS =====
      
      // Storage list - try proxy first if enabled, fallback to direct (admin + storage)
      if (path === '/api/storage' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        if (USE_STORAGE_WORKER) {
          try {
            const queryString = url.search;
            const response = await proxyToStorageWorker(`/api/storage${queryString}`, 'GET', null, origin, request, env);
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Storage worker proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const status = url.searchParams.get('status') as any;
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        
        const storage = await repos.storage.list({ 
          status: status || undefined, 
          limit, 
          days 
        });
        await pool.end();
        return jsonResponse({ success: true, data: storage }, 200, true, origin);
      }

      // Storage stats - try proxy first if enabled, fallback to direct (admin + storage)
      if (path === '/api/storage/stats' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        if (USE_STORAGE_WORKER) {
          try {
            const queryString = url.search;
            const response = await proxyToStorageWorker(`/api/storage/stats${queryString}`, 'GET', null, origin, request, env);
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Storage stats proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const stats = await repos.storage.getStorageStats(days);
        await pool.end();
        return jsonResponse({ success: true, data: stats }, 200, true, origin);
      }

      // Assign pickup driver - try proxy first if enabled, fallback to direct (admin + storage)
      const assignPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-pickup$/);
      if (assignPickupMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = assignPickupMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/assign-pickup`, 
              'POST', 
              body, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Assign pickup proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.assignPickupDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign pickup driver', 'ASSIGN_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Pickup driver assigned' } }, 200, true, origin);
      }

      // Assign delivery driver - try proxy first if enabled, fallback to direct (admin + storage)
      const assignDeliveryMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-delivery$/);
      if (assignDeliveryMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = assignDeliveryMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/assign-delivery`, 
              'POST', 
              body, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Assign delivery proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.assignDeliveryDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign delivery driver', 'ASSIGN_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Delivery driver assigned' } }, 200, true, origin);
      }

      // Confirm pickup - try proxy first if enabled, fallback to direct (admin + storage)
      const confirmPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-pickup$/);
      if (confirmPickupMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = confirmPickupMatch[1];

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/confirm-pickup`, 
              'POST', 
              {}, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Confirm pickup proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.confirmPickup(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm pickup - order may not be in pending status', 'CONFIRM_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Pickup confirmed' } }, 200, true, origin);
      }

      // Confirm dropoff - try proxy first if enabled, fallback to direct (admin + storage)
      const confirmDropoffMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-dropoff$/);
      if (confirmDropoffMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = confirmDropoffMatch[1];

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/confirm-dropoff`, 
              'POST', 
              {}, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Confirm dropoff proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.confirmDropoff(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm dropoff - order may not be in pending dropoff status', 'CONFIRM_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Dropoff confirmed' } }, 200, true, origin);
      }

      // Update storage status - try proxy first if enabled, fallback to direct (admin + storage)
      const updateStatusMatch = path.match(/^\/api\/storage\/([^/]+)\/status$/);
      if (updateStatusMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = updateStatusMatch[1];
        const body = await request.json() as { status: string };
        
        if (!body.status) {
          await pool.end();
          return errorResponse('status is required', 'MISSING_STATUS', 400);
        }

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/status`, 
              'POST', 
              body, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Update status proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.updateStatus(storageId, body.status as any);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to update status', 'UPDATE_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Status updated' } }, 200, true, origin);
      }

      // Cancel storage order - try proxy first if enabled, fallback to direct (admin + storage)
      const cancelStorageMatch = path.match(/^\/api\/storage\/([^/]+)\/cancel$/);
      if (cancelStorageMatch && method === 'POST') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = cancelStorageMatch[1];

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}/cancel`, 
              'POST', 
              {}, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Cancel storage proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const success = await repos.storage.cancel(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to cancel storage order - may already be delivered, cancelled, or not found', 'CANCEL_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Storage order cancelled' } }, 200, true, origin);
      }

      // Update storage order (admin + storage, only when PENDING_DROPOFF)
      const updateStorageMatch = path.match(/^\/api\/storage\/([^/]+)$/);
      if (updateStorageMatch && method === 'PUT') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const storageId = updateStorageMatch[1];
        const body = await request.json() as Record<string, unknown>;

        if (USE_STORAGE_WORKER) {
          try {
            const response = await proxyToStorageWorker(
              `/api/storage/${storageId}`, 
              'PUT', 
              body, 
              origin,
              request,
              env
            );
            await pool.end();
            return response;
          } catch (proxyError) {
            console.log('Update storage proxy failed, falling back to direct:', proxyError);
          }
        }
        
        // Fallback to direct query
        const current = await repos.storage.findById(storageId);
        if (!current) {
          await pool.end();
          return errorResponse('Storage order not found', 'NOT_FOUND', 404);
        }

        const allowedFields = [
          'customer_name', 'customer_email', 'customer_phone',
          'pickup_contact_name', 'pickup_contact_phone',
          'delivery_contact_name', 'delivery_contact_phone',
          'storage_days', 'storage_start_date', 'storage_end_date',
          'bag_count_large', 'bag_count_carryon', 'bag_count_backpack',
          'luggage_description', 'special_instructions', 'notes'
        ];

        const updates: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (field in body && body[field] !== undefined) {
            updates[field] = body[field];
          }
        }

        // Sync linked date fields (start date counts as day 1)
        const dateFields = ['storage_days', 'storage_start_date', 'storage_end_date'];
        const anyDateChanged = dateFields.some(f => f in updates);
        if (anyDateChanged) {
          const days = updates.storage_days !== undefined ? Number(updates.storage_days) : (current.storage_days || 1);
          const start = updates.storage_start_date !== undefined ? String(updates.storage_start_date) : (current.storage_start_date || '');
          const end = updates.storage_end_date !== undefined ? String(updates.storage_end_date) : (current.storage_end_date || '');

          if (start && days && !end) {
            const d = new Date(start + 'T00:00:00');
            d.setDate(d.getDate() + (days - 1));
            updates.storage_end_date = d.toISOString().split('T')[0];
          } else if (start && end && !updates.storage_days) {
            const s = new Date(start + 'T00:00:00');
            const e = new Date(end + 'T00:00:00');
            updates.storage_days = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          } else if (end && days && !start) {
            const d = new Date(end + 'T00:00:00');
            d.setDate(d.getDate() - (days - 1));
            updates.storage_start_date = d.toISOString().split('T')[0];
          }
        }

        const bagFields = ['bag_count_large', 'bag_count_carryon', 'bag_count_backpack'];
        const bagCountChanged = bagFields.some(f => f in updates);
        
        if (bagCountChanged) {
          const large = Number(updates.bag_count_large ?? current.bag_count_large ?? 0);
          const carryon = Number(updates.bag_count_carryon ?? current.bag_count_carryon ?? 0);
          const backpack = Number(updates.bag_count_backpack ?? current.bag_count_backpack ?? 0);
          const storageDays = Number(updates.storage_days ?? current.storage_days ?? 1);
          
          // Pricing per day: Large $10, Carry-on $7, Backpack $6 (in cents)
          const bagPricePerDay = (large * 1000) + (carryon * 700) + (backpack * 600);
          const storageFeeCents = bagPricePerDay * storageDays;
          
          const pickupFee = current.pickup_fee_cents || 0;
          const deliveryFee = current.delivery_fee_cents || 0;
          updates.storage_fee_cents = storageFeeCents;
          updates.price_cents = storageFeeCents + pickupFee + deliveryFee;
          updates.total_price_cents = updates.price_cents;
        }

        if (Object.keys(updates).length === 0) {
          await pool.end();
          return errorResponse('No valid fields to update', 'NO_CHANGES', 400);
        }

        const success = await repos.storage.updateOrder(storageId, updates);
        
        if (!success) {
          await pool.end();
          return errorResponse(
            'Failed to update order — may not exist or is no longer in pending dropoff status',
            'UPDATE_FAILED',
            400
          );
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Order updated successfully' } }, 200, true, origin);
      }

      // ===== EXPORT ENDPOINTS =====

      // Revenue report (weekly, monthly, quarterly, annual) (admin only)
      if (path === '/api/reports/revenue' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const period = url.searchParams.get('period') || 'monthly';
        let report;
        
        switch (period) {
          case 'weekly':
            report = await repos.reports.getWeeklyReport();
            break;
          case 'monthly':
            report = await repos.reports.getMonthlyReport();
            break;
          case 'quarterly':
            report = await repos.reports.getQuarterlyReport();
            break;
          case 'annual':
            report = await repos.reports.getAnnualReport();
            break;
          default:
            await pool.end();
            return errorResponse('Invalid period. Use: weekly, monthly, quarterly, annual', 'INVALID_PERIOD', 400);
        }
        
        await pool.end();
        return jsonResponse({ success: true, data: report }, 200, true, origin);
      }

      // Driver earnings report (admin only)
      if (path === '/api/reports/driver-earnings' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const period = url.searchParams.get('period') || 'monthly';
        
        if (!['weekly', 'monthly', 'quarterly', 'annual'].includes(period)) {
          await pool.end();
          return errorResponse('Invalid period. Use: weekly, monthly, quarterly, annual', 'INVALID_PERIOD', 400);
        }
        
        const { startDate, endDate, label } = repos.reports.getPeriodRange(period as 'weekly' | 'monthly' | 'quarterly' | 'annual');
        
        const earnings = await repos.reports.getDriverEarnings(startDate, endDate);
        
        await pool.end();
        return jsonResponse({ success: true, data: earnings, meta: { period, label, count: earnings.length } }, 200, true, origin);
      }

      // Get combined earnings breakdown (transport + storage) by month/quarter/year (admin only)
      if (path === '/api/reports/earnings-breakdown' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const type = url.searchParams.get('type') || 'monthly';
        
        if (!['monthly', 'quarterly', 'yearly'].includes(type)) {
          await pool.end();
          return errorResponse('Invalid type. Use: monthly, quarterly, yearly', 'INVALID_TYPE', 400);
        }
        
        const breakdown = await repos.reports.getEarningsBreakdown(type as 'monthly' | 'quarterly' | 'yearly');
        
        await pool.end();
        return jsonResponse({ 
          success: true, 
          data: breakdown, 
          meta: { type, count: breakdown.length },
          totals: {
            totalStorageRevenue: breakdown.reduce((sum, r) => sum + r.storageRevenue, 0),
            totalTransportRevenue: breakdown.reduce((sum, r) => sum + r.transportRevenue, 0),
            totalRevenue: breakdown.reduce((sum, r) => sum + r.totalRevenue, 0),
            totalStorageOrders: breakdown.reduce((sum, r) => sum + r.storageOrders, 0),
            totalTransportOrders: breakdown.reduce((sum, r) => sum + r.transportOrders, 0),
            totalOrders: breakdown.reduce((sum, r) => sum + r.totalOrders, 0)
          }
        }, 200, true, origin);
      }

      // Export storage orders as CSV (admin only)
      if (path === '/api/export/storage-orders.csv' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const endDate = new Date().toISOString();
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        
        const orders = await repos.reports.getStorageOrdersForExport(startDate, endDate);
        
        // Generate CSV
        const headers = ['ID', 'Created At', 'Status', 'Customer Name', 'Customer Email', 'Customer Phone', 'Price', 'Storage Days', 'Total Bags', 'Pickup Driver', 'Picked Up At'];
        const rows = orders.map(o => [
          o.id,
          o.created_at,
          o.status,
          o.customer_name || '',
          o.customer_email || '',
          o.customer_phone || '',
          o.price,
          o.storage_days,
          o.total_bags,
          o.pickup_driver || '',
          o.picked_up_at || ''
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
        
        await pool.end();
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="storage-orders-${new Date().toISOString().split('T')[0]}.csv"`,
            'Access-Control-Allow-Origin': origin || '*',
          }
        });
      }

      // Export transport orders as CSV (admin only)
      if (path === '/api/export/transport-orders.csv' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const endDate = new Date().toISOString();
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        
        const orders = await repos.reports.getTransportOrdersForExport(startDate, endDate);
        
        // Generate CSV
        const headers = ['ID', 'Created At', 'Status', 'Customer Name', 'Customer Email', 'Customer Phone', 'Price', 'Origin', 'Destination', 'Driver', 'Delivered At'];
        const rows = orders.map(o => [
          o.id,
          o.created_at,
          o.status,
          o.customer_name || '',
          o.customer_email || '',
          o.customer_phone || '',
          o.price,
          o.origin_airport || '',
          o.destination_airport || '',
          o.driver || '',
          o.delivered_at || ''
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
        
        await pool.end();
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="transport-orders-${new Date().toISOString().split('T')[0]}.csv"`,
            'Access-Control-Allow-Origin': origin || '*',
          }
        });
      }

      // Export storage orders as JSON (for XLSX generation) (admin only)
      if (path === '/api/export/storage-orders.json' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const endDate = new Date().toISOString();
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        
        const orders = await repos.reports.getStorageOrdersForExport(startDate, endDate);
        
        // Format for export
        const formattedOrders = orders.map(o => ({
          'ID': o.id,
          'Created At': o.created_at,
          'Status': o.status,
          'Customer Name': o.customer_name || '',
          'Customer Email': o.customer_email || '',
          'Customer Phone': o.customer_phone || '',
          'Price': parseFloat(o.price || 0),
          'Storage Days': o.storage_days,
          'Total Bags': o.total_bags,
          'Pickup Driver': o.pickup_driver || '',
          'Picked Up At': o.picked_up_at || ''
        }));
        
        await pool.end();
        return jsonResponse({ success: true, data: formattedOrders, count: formattedOrders.length }, 200, true, origin);
      }

      // Export transport orders as JSON (for XLSX generation) (admin only)
      if (path === '/api/export/transport-orders.json' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        const days = parseInt(url.searchParams.get('days') || '30', 10);
        const endDate = new Date().toISOString();
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        
        const orders = await repos.reports.getTransportOrdersForExport(startDate, endDate);
        
        // Format for export
        const formattedOrders = orders.map(o => ({
          'ID': o.id,
          'Created At': o.created_at,
          'Status': o.status,
          'Customer Name': o.customer_name || '',
          'Customer Email': o.customer_email || '',
          'Customer Phone': o.customer_phone || '',
          'Price': parseFloat(o.price || 0),
          'Origin': o.origin_airport || '',
          'Destination': o.destination_airport || '',
          'Driver': o.driver || '',
          'Delivered At': o.delivered_at || ''
        }));
        
        await pool.end();
        return jsonResponse({ success: true, data: formattedOrders, count: formattedOrders.length }, 200, true, origin);
      }

      // Legacy query endpoint (admin only)
      if (path === '/api/neon-query' && method === 'POST') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }

        const body = await request.json() as { query: string; params?: unknown[] };
        
        if (!body.query) {
          await pool.end();
          return errorResponse('Query required', 'MISSING_QUERY', 400);
        }

        const normalizedQuery = body.query.trim().toUpperCase();
        if (!normalizedQuery.startsWith('SELECT') && !normalizedQuery.startsWith('UPDATE')) {
          await pool.end();
          return errorResponse('Only SELECT/UPDATE allowed', 'INVALID_QUERY', 400);
        }

        const client = await pool.connect();
        try {
          const result = await client.query(body.query, body.params || []);
          await pool.end();
          return jsonResponse({ 
            success: true, 
            data: { rows: result.rows, rowCount: result.rowCount }
          }, 200, true, origin);
        } finally {
          client.release();
        }
      }

      // HTML Routes
      if (path === '/login' && method === 'GET') {
        // Check if JWT_SECRET is configured before trying to verify tokens
        if (env.JWT_SECRET) {
          const token = extractJWT(request);
          if (token) {
            try {
              const payload = await verifyJWT(token, env);
              if (payload) {
                // Redirect based on role
                let redirectPath = '/';
                if (payload.role === 'transport') redirectPath = '/';
                if (payload.role === 'storage') redirectPath = '/storage';
                await pool.end();
                return new Response(null, { status: 302, headers: { Location: redirectPath } });
              }
            } catch (error) {
              // If JWT verification fails, just show login page
              if (error instanceof Error) {
                console.log('JWT verification failed, showing login page:', error.message);
              } else {
                console.log('JWT verification failed, showing login page:', String(error));
              }
            }
          }
        }
        await pool.end(); // Close pool after request
        return htmlResponse(LOGIN_HTML);
      }

      if (path === '/' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'transport']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        await pool.end(); // Close pool after request
        return htmlResponse(DASHBOARD_HTML);
      }

      if (path === '/drivers' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        await pool.end(); // Close pool after request
        return htmlResponse(DRIVER_STATS_HTML);
      }

      // Storage page
      if (path === '/storage' && method === 'GET') {
        const roleCheck = requireRole(request, ['admin', 'storage']);
        if (roleCheck) { await pool.end(); return roleCheck; }
        
        await pool.end(); // Close pool after request
        return htmlResponse(STORAGE_HTML);
      }

      if (path === '/loading' && method === 'GET') {
        await pool.end(); // Close pool after request
        return htmlResponse(LOADING_HTML);
      }

      await pool.end(); // Close pool for 404 responses
      return errorResponse('Not Found', 'NOT_FOUND', 404);

    } catch (error) {
      console.error('Request error:', error);
      const message = error instanceof Error ? error.message : 'Internal error';
      // Ensure pool is closed on error
      if (pool) {
        await pool.end().catch(e => console.error('Failed to close pool:', e));
      }
      return errorResponse(message, 'INTERNAL_ERROR', 500);
    }
  },
};

export default worker;
