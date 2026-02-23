import { Pool } from '@neondatabase/serverless';
import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env } from './types';
import { createRepositories } from './repositories';

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

// Initialize repositories for a single request
async function initializeRepositories(env: Env): Promise<ReturnType<typeof createRepositories>> {
  const pool = createPool(env);
  
  try {
    // Test connection with timeout
    const isConnected = await Promise.race([
      testConnection(pool),
      new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 8000)
      )
    ]);
    
    if (!isConnected) {
      throw new Error('Database connection failed');
    }
    
    return createRepositories(pool);
  } catch (error) {
    // Ensure pool is closed on error
    await pool.end();
    throw error;
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Simple ping endpoint
    if (path === '/ping' && method === 'GET') {
      return new Response(JSON.stringify({ 
        success: true, 
        data: { 
          message: 'pong', 
          worker: 'driver-stats',
          timestamp: new Date().toISOString() 
        } 
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }

    // Health check endpoint
    if (path === '/health' && method === 'GET') {
      try {
        const pool = createPool(env);
        const isConnected = await testConnection(pool);
        await pool.end(); // Close pool after health check
        
        return new Response(JSON.stringify({ 
          success: true, 
          data: { 
            connected: isConnected,
            message: 'Database connection OK',
            worker: 'driver-stats'
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Database connection failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
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
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Database connection failed',
        details: error
      }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }

    try {
      // Live driver stats (no caching)
      if (path === '/api/drivers/stats/live' && method === 'GET') {
        const stats = await repos.drivers.getLiveStats();
        await pool.end(); // Close pool after request
        
        return new Response(JSON.stringify({
          success: true,
          data: stats,
          meta: { 
            source: 'driver-stats-worker', 
            timestamp: new Date().toISOString() 
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      // Driver list with stats
      if (path === '/api/drivers' && method === 'GET') {
        const drivers = await repos.drivers.listAll();
        await pool.end(); // Close pool after request
        
        return new Response(JSON.stringify({
          success: true,
          data: drivers,
          count: drivers.length,
          meta: { 
            source: 'driver-stats-worker', 
            timestamp: new Date().toISOString() 
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      // Online drivers only
      if (path === '/api/drivers/online' && method === 'GET') {
        const drivers = await repos.drivers.listOnline();
        await pool.end(); // Close pool after request
        
        return new Response(JSON.stringify({
          success: true,
          data: drivers,
          count: drivers.length,
          meta: { 
            source: 'driver-stats-worker', 
            timestamp: new Date().toISOString() 
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      // Enhanced driver stats with more details
      if (path === '/api/drivers/stats/enhanced' && method === 'GET') {
        const [totalDrivers, onlineDrivers, topDriver] = await Promise.all([
          repos.drivers.listAll(),
          repos.drivers.listOnline(),
          (async () => {
            const allDrivers = await repos.drivers.listAll();
            return allDrivers.reduce((max, driver) => 
              (driver.total_deliveries || 0) > (max.total_deliveries || 0) ? driver : max
            , allDrivers[0] || null);
          })()
        ]);

        await pool.end(); // Close pool after request
        
        const stats = {
          total: totalDrivers.length,
          online: onlineDrivers.length,
          offline: totalDrivers.length - onlineDrivers.length,
          topDriver: topDriver ? {
            id: topDriver.id,
            name: `${topDriver.first_name} ${topDriver.last_name}`,
            deliveries: topDriver.total_deliveries || 0,
            rating: topDriver.rating,
            vehicle: topDriver.vehicle_type
          } : null,
          vehicleBreakdown: totalDrivers.reduce((acc, driver) => {
            const type = driver.vehicle_type || 'unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          averageRating: totalDrivers.length > 0 
            ? totalDrivers.reduce((sum, driver) => sum + (driver.rating || 0), 0) / totalDrivers.length
            : 0
        };
        
        return new Response(JSON.stringify({
          success: true,
          data: stats,
          meta: { 
            source: 'driver-stats-worker', 
            timestamp: new Date().toISOString() 
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      await pool.end(); // Close pool for 404 responses
      
      return new Response(JSON.stringify({
        success: false,
        error: 'Not Found',
        code: 'NOT_FOUND'
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });

    } catch (error) {
      console.error('Request error:', error);
      const message = error instanceof Error ? error.message : 'Internal error';
      
      // Ensure pool is closed on error
      if (pool) {
        await pool.end().catch(e => console.error('Failed to close pool:', e));
      }
      
      return new Response(JSON.stringify({
        success: false,
        error: message,
        code: 'INTERNAL_ERROR'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }
  },
};

export default worker;