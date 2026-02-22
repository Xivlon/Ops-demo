import { Pool } from '@neondatabase/serverless';
import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env, LoginRequest } from './types';
import { createRepositories } from './repositories';
import { authMiddleware } from './middleware/auth';
import { createJWT, verifyJWT, extractJWT } from './utils/jwt';
import {
  jsonResponse,
  htmlResponse,
  errorResponse,
  unauthorizedResponse,
  corsPreflightResponse,
  clearJWTCookie,
} from './utils/response';
import {
  DASHBOARD_HTML,
  DRIVER_STATS_HTML,
  LOGIN_HTML,
} from './generated/html-templates';

// Connection pool instance (singleton per worker)
let pool: Pool | null = null;

function getPool(env: Env): Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ 
      connectionString: env.DATABASE_URL,
    });
  }
  return pool;
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');

    // Simple ping endpoint - no auth, no DB
    if (path === '/ping' && method === 'GET') {
      return jsonResponse({ success: true, data: { message: 'pong', timestamp: new Date().toISOString() } }, 200, true, origin);
    }

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return corsPreflightResponse(origin);
    }

    // Auth middleware
    const authResponse = await authMiddleware(request, env);
    if (authResponse) return authResponse;

    // Check database URL
    if (!env.DATABASE_URL) {
      return errorResponse('DATABASE_URL not configured', 'DB_CONFIG_ERROR', 500);
    }

    // Initialize repositories
    let repos;
    try {
      const pool = getPool(env);
      repos = createRepositories(pool);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Database connection failed';
      console.error('Pool init error:', error);
      return errorResponse('Database connection failed: ' + error, 'DB_CONNECTION_ERROR', 500);
    }

    try {
      // Health check
      if (path === '/test' && method === 'GET') {
        const start = Date.now();
        const result = await repos.shipments.getDashboardStats(1);
        return jsonResponse({
          success: true,
          data: { connected: true, latencyMs: Date.now() - start, stats: result },
        }, 200, true, origin);
      }

      // Login
      if (path === '/api/login' && method === 'POST') {
        const body = await request.json() as LoginRequest;
        
        if (!body.pin || body.pin !== env.ADMIN_PIN) {
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
        return response;
      }

      // Dashboard stats
      if (path === '/api/dashboard/stats' && method === 'GET') {
        const stats = await repos.shipments.getDashboardStats();
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
        return jsonResponse({ success: true, data: shipments }, 200, true, origin);
      }

      // Assign driver
      const assignMatch = path.match(/^\/api\/shipments\/([^/]+)\/assign$/);
      if (assignMatch && method === 'POST') {
        const shipmentId = assignMatch[1];
        const body = await request.json() as { driverId: string };
        
        if (!body.driverId) {
          return errorResponse('driverId is required', 'MISSING_DRIVER_ID', 400);
        }

        const success = await repos.shipments.assignDriver(shipmentId, body.driverId);
        
        if (!success) {
          return errorResponse('Failed to assign driver', 'ASSIGN_FAILED', 400);
        }

        return jsonResponse({ success: true, data: { message: 'Driver assigned' } }, 200, true, origin);
      }

      // Drivers
      if (path === '/api/drivers' && method === 'GET') {
        const drivers = await repos.drivers.listAll();
        return jsonResponse({ success: true, data: drivers }, 200, true, origin);
      }

      if (path === '/api/drivers/online' && method === 'GET') {
        const drivers = await repos.drivers.listOnline();
        return jsonResponse({ success: true, data: drivers }, 200, true, origin);
      }

      // Driver stats (live only)
      if (path === '/api/drivers/stats' && method === 'GET') {
        const stats = await repos.drivers.getLiveStats();
        return jsonResponse({ 
          success: true, 
          data: stats,
          meta: { source: 'live', timestamp: new Date().toISOString() }
        }, 200, true, origin);
      }

      // Legacy query endpoint
      if (path === '/api/neon-query' && method === 'POST') {
        const pin = url.searchParams.get('pin');
        if (pin !== env.ADMIN_PIN) {
          return unauthorizedResponse();
        }

        const body = await request.json() as { query: string; params?: unknown[] };
        
        if (!body.query) {
          return errorResponse('Query required', 'MISSING_QUERY', 400);
        }

        const normalizedQuery = body.query.trim().toUpperCase();
        if (!normalizedQuery.startsWith('SELECT') && !normalizedQuery.startsWith('UPDATE')) {
          return errorResponse('Only SELECT/UPDATE allowed', 'INVALID_QUERY', 400);
        }

        const client = await getPool(env).connect();
        try {
          const result = await client.query(body.query, body.params || []);
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
        const token = extractJWT(request);
        if (token) {
          const payload = await verifyJWT(token, env);
          if (payload) {
            return new Response(null, { status: 302, headers: { Location: '/' } });
          }
        }
        return htmlResponse(LOGIN_HTML);
      }

      if (path === '/' && method === 'GET') {
        return htmlResponse(DASHBOARD_HTML);
      }

      if (path === '/drivers' && method === 'GET') {
        return htmlResponse(DRIVER_STATS_HTML);
      }

      return errorResponse('Not Found', 'NOT_FOUND', 404);

    } catch (error) {
      console.error('Request error:', error);
      const message = error instanceof Error ? error.message : 'Internal error';
      const stack = error instanceof Error ? error.stack : '';
      console.error('Stack:', stack);
      return errorResponse(message + ' - ' + stack?.substring(0, 200), 'INTERNAL_ERROR', 500);
    }
    } catch (error) {
      console.error('Worker error:', error);
      const message = error instanceof Error ? error.message : 'Worker crashed';
      return errorResponse('Worker error: ' + message, 'WORKER_ERROR', 500);
    }
  },
};

export default worker;
