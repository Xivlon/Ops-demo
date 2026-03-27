import { Pool } from '@neondatabase/serverless';
import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env, LoginRequest, ApiResponse } from '../../../shared/types';
import { createRepositories } from '../../../shared/repositories';
import { authMiddleware } from '../../../shared/utils/auth';
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
const DRIVER_STATS_WORKER_URL = 'https://driver-stats.constance-api.workers.dev';
const USE_DRIVER_STATS_WORKER = true; // Set to false to use direct queries
const DRIVER_STATS_TIMEOUT_MS = 10000; // 10 second timeout for proxy requests

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
async function proxyToDriverStatsWorker(endpoint: string, origin: string | null): Promise<Response> {
  if (!USE_DRIVER_STATS_WORKER) {
    throw new Error('Driver stats worker not enabled');
  }

  try {
    const url = `${DRIVER_STATS_WORKER_URL}${endpoint}`;
    console.log(`Proxying to driver stats worker: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DRIVER_STATS_TIMEOUT_MS);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      }
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
            driverStatsWorkerUrl: DRIVER_STATS_WORKER_URL
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

      // Login
      if (path === '/api/login' && method === 'POST') {
        const body = await request.json() as LoginRequest;
        
        if (!body.pin || body.pin !== env.ADMIN_PIN) {
          await pool.end();
          return errorResponse('Invalid PIN', 'INVALID_PIN', 401);
        }

        const jwt = await createJWT(env);
        
        const response = jsonResponse(
          { success: true, data: { message: 'Login successful' } },
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

      // Dashboard stats
      if (path === '/api/dashboard/stats' && method === 'GET') {
        const stats = await repos.shipments.getDashboardStats();
        await pool.end(); // Close pool after request
        return jsonResponse({ success: true, data: stats }, 200, true, origin);
      }

      // Shipments list
      if (path === '/api/shipments' && method === 'GET') {
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

      // Assign driver
      const assignMatch = path.match(/^\/api\/shipments\/([^/]+)\/assign$/);
      if (assignMatch && method === 'POST') {
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

      // Cancel shipment
      const cancelMatch = path.match(/^\/api\/shipments\/([^/]+)\/cancel$/);
      if (cancelMatch && method === 'POST') {
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
      
      // Drivers list - try proxy first, fallback to direct
      if (path === '/api/drivers' && method === 'GET') {
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers', origin);
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

      // Online drivers - try proxy first, fallback to direct
      if (path === '/api/drivers/online' && method === 'GET') {
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers/online', origin);
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

      // Get driver stats from driver_stats table only (no calculations)
      if (path === '/api/drivers/stats' && method === 'GET') {
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

      // Get total revenue from shipments table (calculated from price_cents)
      if (path === '/api/drivers/revenue' && method === 'GET') {
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

      // Enhanced driver stats endpoint (only available via worker)
      if (path === '/api/drivers/stats/enhanced' && method === 'GET') {
        if (USE_DRIVER_STATS_WORKER) {
          try {
            const response = await proxyToDriverStatsWorker('/api/drivers/stats/enhanced', origin);
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
        return jsonResponse({ success: true, data: storage }, 200, true, origin);
      }

      // Storage stats
      if (path === '/api/storage/stats' && method === 'GET') {
        const stats = await repos.storage.getStorageStats();
        await pool.end();
        return jsonResponse({ success: true, data: stats }, 200, true, origin);
      }

      // Assign pickup driver
      const assignPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-pickup$/);
      if (assignPickupMatch && method === 'POST') {
        const storageId = parseInt(assignPickupMatch[1], 10);
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        const success = await repos.storage.assignPickupDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign pickup driver', 'ASSIGN_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Pickup driver assigned' } }, 200, true, origin);
      }

      // Assign delivery driver
      const assignDeliveryMatch = path.match(/^\/api\/storage\/([^/]+)\/assign-delivery$/);
      if (assignDeliveryMatch && method === 'POST') {
        const storageId = parseInt(assignDeliveryMatch[1], 10);
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          await pool.end();
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        const success = await repos.storage.assignDeliveryDriver(storageId, body.driverId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to assign delivery driver', 'ASSIGN_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Delivery driver assigned' } }, 200, true, origin);
      }

      // Confirm pickup - mark as picked_up
      const confirmPickupMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-pickup$/);
      if (confirmPickupMatch && method === 'POST') {
        const storageId = parseInt(confirmPickupMatch[1], 10);
        
        const success = await repos.storage.confirmPickup(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm pickup - order may not be in pending status', 'CONFIRM_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Pickup confirmed' } }, 200, true, origin);
      }

      // Confirm storage - mark as in_storage
      const confirmStorageMatch = path.match(/^\/api\/storage\/([^/]+)\/confirm-storage$/);
      if (confirmStorageMatch && method === 'POST') {
        const storageId = parseInt(confirmStorageMatch[1], 10);
        
        const success = await repos.storage.confirmStorage(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to confirm storage - order may not be in picked_up status', 'CONFIRM_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Storage confirmed' } }, 200, true, origin);
      }

      // Cancel storage order
      const cancelStorageMatch = path.match(/^\/api\/storage\/([^/]+)\/cancel$/);
      if (cancelStorageMatch && method === 'POST') {
        const storageId = parseInt(cancelStorageMatch[1], 10);
        
        const success = await repos.storage.cancel(storageId);
        
        if (!success) {
          await pool.end();
          return errorResponse('Failed to cancel storage order - may already be delivered, cancelled, or not found', 'CANCEL_FAILED', 400);
        }

        await pool.end();
        return jsonResponse({ success: true, data: { message: 'Storage order cancelled' } }, 200, true, origin);
      }

      // Legacy query endpoint
      if (path === '/api/neon-query' && method === 'POST') {
        const pin = url.searchParams.get('pin');
        if (pin !== env.ADMIN_PIN) {
          await pool.end();
          return unauthorizedResponse();
        }

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
                await pool.end();
                return new Response(null, { status: 302, headers: { Location: '/' } });
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
        await pool.end(); // Close pool after request
        return htmlResponse(DASHBOARD_HTML);
      }

      if (path === '/drivers' && method === 'GET') {
        await pool.end(); // Close pool after request
        return htmlResponse(DRIVER_STATS_HTML);
      }

      // Storage page
      if (path === '/storage' && method === 'GET') {
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
