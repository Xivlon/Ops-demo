import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 1. Security Check
    const adminPin = env.ADMIN_PIN || "1234";
    const pinParam = url.searchParams.get("pin");
    
    // Check PIN for page routes
    if ((path === "/" || path === "/drivers") && pinParam !== adminPin) {
      return new Response("Unauthorized Access", { 
        status: 401,
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 2. Handle API requests for Neon DB queries
    if (path === "/api/neon-query" && request.method === "POST") {
      if (pinParam !== adminPin) {
        return new Response(JSON.stringify({ error: "Unauthorized Access", code: "UNAUTHORIZED" }), { 
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      return await handleNeonQuery(request, env);
    }

    // 3. Handle driver stats API (cached)
    if (path === "/api/driver-stats" && request.method === "POST") {
      if (pinParam !== adminPin) {
        return new Response(JSON.stringify({ error: "Unauthorized Access", code: "UNAUTHORIZED" }), { 
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      return await handleNeonQuery(request, env);
    }

    // 4. Handle driver timeline API
    if (path.startsWith("/api/driver-timeline/") && request.method === "POST") {
      if (pinParam !== adminPin) {
        return new Response(JSON.stringify({ error: "Unauthorized Access", code: "UNAUTHORIZED" }), { 
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      const pathSegments = path.split("/");
      const driverIdFromPath = pathSegments[3] || null;
      
      if (!driverIdFromPath) {
        return new Response(JSON.stringify({ error: "Missing driverId in URL path" }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(driverIdFromPath)) {
        return new Response(JSON.stringify({ error: "Invalid driverId format" }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      return await handleNeonQuery(request, env);
    }

    // 5. Handle driver stats refresh API
    if (path === "/api/refresh-driver-stats" && request.method === "POST") {
      if (pinParam !== adminPin) {
        return new Response(JSON.stringify({ error: "Unauthorized Access", code: "UNAUTHORIZED" }), { 
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      return await handleRefreshDriverStats(env);
    }

    // 6. NEW: Handle live driver stats (real-time)
    if (path === "/api/live-driver-stats" && request.method === "POST") {
      if (pinParam !== adminPin) {
        return new Response(JSON.stringify({ error: "Unauthorized Access", code: "UNAUTHORIZED" }), { 
          status: 401,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      return await handleLiveDriverStats(env);
    }

    // 7. Test endpoint
    if (path === "/test") {
      return await testConnection(env);
    }

    // 8. Serve the driver stats page
    if (path === "/drivers") {
      return serveDriverStats(url.searchParams.get("pin"));
    }

    // 9. Serve the dashboard
    if (path === "/") {
      return serveDashboard(url.searchParams.get("pin"));
    }

    return new Response("Not Found", { status: 404 });
  }
};

// Function to handle Neon DB queries
async function handleNeonQuery(request, env) {
  try {
    const { query, params = [] } = await request.json();
    
    const connectionString = env.DATABASE_URL;    
    if (!connectionString) {
      return new Response(
        JSON.stringify({ 
          error: "Database configuration missing. Please set DATABASE_URL.",
          code: "NO_DB_CONFIG"
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }
    
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery.startsWith('SELECT') && !normalizedQuery.startsWith('UPDATE')) {
      return new Response(
        JSON.stringify({ 
          error: "Only SELECT and UPDATE queries are allowed",
          code: "INVALID_QUERY_TYPE"
        }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    const result = await executeNeonQuery(connectionString, query, params);
    
    return new Response(
      JSON.stringify(result),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );
    
  } catch (error) {
    console.error('Neon query error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        code: "QUERY_EXECUTION_ERROR"
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );
  }
}

// NEW: Function to handle live driver stats (real-time from shipments table)
async function handleLiveDriverStats(env) {
  try {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      return new Response(
        JSON.stringify({ 
          error: "Database configuration missing. Please set DATABASE_URL.",
          code: "NO_DB_CONFIG"
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    const sql = neon(connectionString);
    
    const rows = await sql`
      SELECT 
        dp.id,
        dp.first_name,
        dp.last_name,
        dp.email,
        dp.is_online,
        dp.account_created_at as driver_joined,
        
        COUNT(s.id) as total_assigned,
        
        COUNT(*) FILTER (WHERE s.status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE s.status = 'ASSIGNED') as assigned_count,
        COUNT(*) FILTER (WHERE s.status = 'PICKED_UP') as in_transit_count,
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED') as total_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_count,
        0 as failed_count,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as total_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') as week_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '7 days') as week_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') as month_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '30 days') as month_failed,
        
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED'), 0) / 100.0 as total_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days'), 0) / 100.0 as week_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days'), 0) / 100.0 as month_revenue,
        
        MAX(COALESCE(GREATEST(s.delivered_at, dp.account_updated_at), dp.account_updated_at)) as last_active,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_cancel_rate,
        
        0 as avg_rating,
        0 as rating_count,
        
        NOW() as stats_updated_at

      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      WHERE dp.user_type = 'driver'
      GROUP BY dp.id, dp.first_name, dp.last_name, dp.email, dp.is_online, dp.account_created_at
      ORDER BY COUNT(*) FILTER (WHERE s.status = 'DELIVERED') DESC
    `;

    return new Response(
      JSON.stringify({
        rows: rows,
        rowCount: rows.length,
        dataSource: 'live',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );

  } catch (error) {
    console.error('Live driver stats error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        code: "LIVE_STATS_ERROR",
        dataSource: 'live'
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );
  }
}

// Function to refresh driver stats - computes stats and stores in driver_stats table
async function handleRefreshDriverStats(env) {
  try {
    const connectionString = env.DATABASE_URL;
    if (!connectionString) {
      return new Response(
        JSON.stringify({ 
          error: "Database configuration missing. Please set DATABASE_URL.",
          code: "NO_DB_CONFIG"
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    const sql = neon(connectionString);

    try {
      await sql`
        CREATE TABLE IF NOT EXISTS driver_stats (
          id UUID PRIMARY KEY,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          email VARCHAR(255),
          is_online BOOLEAN,
          driver_joined TIMESTAMP,
          total_assigned INTEGER DEFAULT 0,
          pending_count INTEGER DEFAULT 0,
          assigned_count INTEGER DEFAULT 0,
          in_transit_count INTEGER DEFAULT 0,
          total_completed INTEGER DEFAULT 0,
          cancelled_count INTEGER DEFAULT 0,
          failed_count INTEGER DEFAULT 0,
          total_failed INTEGER DEFAULT 0,
          week_completed INTEGER DEFAULT 0,
          week_failed INTEGER DEFAULT 0,
          month_completed INTEGER DEFAULT 0,
          month_failed INTEGER DEFAULT 0,
          total_revenue DECIMAL(10, 2) DEFAULT 0,
          week_revenue DECIMAL(10, 2) DEFAULT 0,
          month_revenue DECIMAL(10, 2) DEFAULT 0,
          last_active TIMESTAMP,
          success_rate DECIMAL(5, 2),
          cancel_rate DECIMAL(5, 2),
          week_success_rate DECIMAL(5, 2),
          week_cancel_rate DECIMAL(5, 2),
          month_success_rate DECIMAL(5, 2),
          month_cancel_rate DECIMAL(5, 2),
          avg_rating DECIMAL(3, 2) DEFAULT 0,
          rating_count INTEGER DEFAULT 0,
          stats_updated_at TIMESTAMP DEFAULT NOW()
        )
      `;
    } catch (tableError) {
      console.error('Error creating driver_stats table:', tableError);
      return new Response(
        JSON.stringify({ 
          error: `Failed to initialize driver stats database.`,
          code: "TABLE_CREATION_ERROR"
        }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          } 
        }
      );
    }

    await sql`TRUNCATE TABLE driver_stats`;

    await sql`
      INSERT INTO driver_stats (
        id, first_name, last_name, email, is_online, driver_joined,
        total_assigned, pending_count, assigned_count, in_transit_count, total_completed,
        cancelled_count, failed_count, total_failed, week_completed, week_failed,
        month_completed, month_failed, total_revenue, week_revenue, month_revenue,
        last_active, success_rate, cancel_rate,
        week_success_rate, week_cancel_rate, month_success_rate, month_cancel_rate,
        avg_rating, rating_count, stats_updated_at
      )
      SELECT 
        dp.id,
        dp.first_name,
        dp.last_name,
        dp.email,
        dp.is_online,
        dp.account_created_at as driver_joined,
        
        COUNT(s.id) as total_assigned,
        
        COUNT(*) FILTER (WHERE s.status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE s.status = 'ASSIGNED') as assigned_count,
        COUNT(*) FILTER (WHERE s.status = 'PICKED_UP') as in_transit_count,
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED') as total_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_count,
        0 as failed_count,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as total_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') as week_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '7 days') as week_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') as month_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '30 days') as month_failed,
        
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED'), 0) / 100.0 as total_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days'), 0) / 100.0 as week_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days'), 0) / 100.0 as month_revenue,
        
        MAX(COALESCE(GREATEST(s.delivered_at, dp.account_updated_at), dp.account_updated_at)) as last_active,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_cancel_rate,
        
        0 as avg_rating,
        0 as rating_count,
        
        NOW() as stats_updated_at

      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      WHERE dp.user_type = 'driver'
      GROUP BY dp.id, dp.first_name, dp.last_name, dp.email, dp.is_online, dp.account_created_at
    `;

    const countResult = await sql`SELECT COUNT(*) as count FROM driver_stats`;
    const driverCount = countResult[0]?.count || 0;

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Driver stats refreshed successfully`,
        driversUpdated: parseInt(driverCount),
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );

  } catch (error) {
    console.error('Driver stats refresh error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        code: "STATS_REFRESH_ERROR"
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );
  }
}

async function executeNeonQuery(connectionString, query, params) {
  try {
    const sql = neon(connectionString);
    const rows = await sql(query, params);
    
    return {
      rows: rows,
      rowCount: rows.length
    };

  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
}

async function testConnection(env) {
  try {
    const connectionString = env.DATABASE_URL;
    
    if (!connectionString) {
      return new Response(JSON.stringify({
        success: false,
        error: "DATABASE_URL not set",
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const testQuery = "SELECT 1 as test_value, NOW() as current_time";
    const result = await executeNeonQuery(connectionString, testQuery, []);
    
    return new Response(JSON.stringify({
      success: true,
      data: result.rows,
      connectionInfo: {
        hasConnectionString: true,
        timestamp: new Date().toISOString()
      }
    }, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, null, 2), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

function serveDashboard(pin) {
  // Keep your existing serveDashboard function from the original code
  // It remains unchanged
  return new Response("Dashboard HTML here", { headers: { "Content-Type": "text/html" } });
}

function serveDriverStats(pin) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Driver Performance - LuggageLink Ops</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            slate: {
              50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
              400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
              800: '#1e293b', 900: '#0f172a', 950: '#020617',
            }
          }
        }
      }
    }
  </script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
    .driver-card { transition: all 0.3s ease; }
    .driver-card:hover { transform: translateY(-2px); }
    .performance-high { border-color: #22c55e; }
    .performance-average { border-color: #eab308; }
    .performance-low { border-color: #ef4444; }
    .data-source-cached { border-left-color: #8b5cf6; border-left-width: 4px; }
    .data-source-live { border-left-color: #10b981; border-left-width: 4px; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">
  
  <nav class="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center gap-3">
        <div class="bg-purple-600 p-2.5 rounded-lg">
          <i data-lucide="users" class="w-7 h-7"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold">Driver Performance</h1>
          <div class="flex items-center gap-2">
            <span id="status-indicator" class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
            <p id="status-text" class="text-xs text-slate-400">Loading...</p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <span id="data-source-badge" class="bg-slate-700 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1">
          <i data-lucide="database" class="w-3 h-3"></i>
          <span id="data-source-text">Cached</span>
        </span>
        <button onclick="window.location.href='/?pin=${pin}'" class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <i data-lucide="arrow-left" class="w-4 h-4"></i>
          Back
        </button>
      </div>
    </div>
  </nav>

  <div class="max-w-7xl mx-auto p-6 space-y-6">
    <div id="toast-container" class="fixed top-24 right-6 z-50"></div>

    <div class="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-wrap gap-4">
      <div class="flex items-center gap-2">
        <label class="text-sm font-semibold text-slate-400">Data Source:</label>
        <div class="flex bg-slate-900 rounded-lg border border-slate-600 overflow-hidden">
          <button id="btn-cached" onclick="setDataSource('cached')" class="px-3 py-2 text-sm font-semibold text-green-400 bg-slate-800">
            <i data-lucide="database" class="w-4 h-4 inline mr-1"></i>Cached
          </button>
          <button id="btn-live" onclick="setDataSource('live')" class="px-3 py-2 text-sm font-semibold text-slate-400">
            <i data-lucide="zap" class="w-4 h-4 inline mr-1"></i>Live
          </button>
        </div>
      </div>
      
      <button onclick="refreshData()" class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
        Refresh
      </button>
      
      <button onclick="recalculateStats()" class="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
        <i data-lucide="database" class="w-4 h-4"></i>
        Update Cache
      </button>
    </div>

    <div id="drivers-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-slate-800 h-96 rounded-xl animate-pulse"></div>
      <div class="bg-slate-800 h-96 rounded-xl animate-pulse"></div>
    </div>
    
    <div class="text-center text-slate-500 text-sm">
      <span id="last-updated">Loading...</span>
      <span id="data-freshness" class="ml-4"></span>
    </div>
  </div>

  <script>
    lucide.createIcons();
    
    let allDrivers = [];
    let currentDataSource = 'cached';
    
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function setDataSource(source) {
      currentDataSource = source;
      updateDataSourceUI();
      refreshData();
    }
    
    function updateDataSourceUI() {
      const btnCached = document.getElementById('btn-cached');
      const btnLive = document.getElementById('btn-live');
      const badge = document.getElementById('data-source-text');
      
      if (currentDataSource === 'cached') {
        btnCached.className = 'px-3 py-2 text-sm font-semibold text-green-400 bg-slate-800';
        btnLive.className = 'px-3 py-2 text-sm font-semibold text-slate-400';
        badge.innerText = 'Cached';
      } else {
        btnCached.className = 'px-3 py-2 text-sm font-semibold text-slate-400';
        btnLive.className = 'px-3 py-2 text-sm font-semibold text-emerald-400 bg-slate-800';
        badge.innerText = 'Live';
      }
      
      lucide.createIcons();
    }

    async function refreshData() {
      try {
        await loadDriverStats();
        document.getElementById('last-updated').innerText = 'Last updated: ' + new Date().toLocaleTimeString();
      } catch (error) {
        console.error('Error:', error);
        showToast('Failed to load data', 'red');
      }
    }
    
    async function recalculateStats() {
      try {
        showToast("Updating cache...", "blue");
        
        const res = await fetch(\`/api/refresh-driver-stats?pin=${pin}\`, {
          method: 'POST'
        });
        
        const data = await res.json();
        
        if (data.success) {
          showToast(\`Cache updated: \${data.driversUpdated} drivers\`, "green");
          currentDataSource = 'cached';
          updateDataSourceUI();
          await refreshData();
        } else {
          showToast("Failed to update cache", "red");
        }
      } catch (e) {
        showToast("Failed to update cache", "red");
      }
    }

    async function loadDriverStats() {
      try {
        let res;
        
        if (currentDataSource === 'live') {
          res = await fetch(\`/api/live-driver-stats?pin=${pin}\`, {
            method: 'POST'
          });
        } else {
          res = await fetch(\`/api/driver-stats?pin=${pin}\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              query: 'SELECT * FROM driver_stats ORDER BY total_completed DESC'
            })
          });
        }
        
        const data = await res.json();
        allDrivers = data.rows || [];
        
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-green-500";
        document.getElementById('status-text').innerText = \`Connected - \${allDrivers.length} drivers\`;
        
        renderDriverCards(allDrivers);
        
      } catch (e) { 
        console.error("Error:", e);
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-red-500";
        document.getElementById('status-text').innerText = "Error";
        showToast("Failed to load data", "red");
      }
    }

    function renderDriverCards(drivers) {
      const grid = document.getElementById('drivers-grid');
      
      if (drivers.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12">No drivers found</div>';
        return;
      }
      
      grid.innerHTML = drivers.map(driver => {
        const name = \`\${driver.first_name || ''} \${driver.last_name || ''}\`.trim() || 'Unknown';
        const initials = name.split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '??';
        
        const successRate = driver.success_rate !== null ? parseFloat(driver.success_rate).toFixed(1) + '%' : 'N/A';
        const dataSourceClass = currentDataSource === 'cached' ? 'data-source-cached' : 'data-source-live';
        
        return \`
          <div class="driver-card bg-slate-800 rounded-xl p-6 border-2 performance-average \${dataSourceClass}">
            <div class="flex items-start gap-4 mb-4">
              <div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-xl">
                \${initials}
              </div>
              <div class="flex-1">
                <h3 class="text-lg font-bold">\${escapeHtml(name)}</h3>
                <p class="text-xs text-slate-400">\${escapeHtml(driver.email || 'No email')}</p>
                <span class="text-xs text-\${driver.is_online ? 'green' : 'slate'}-400">
                  \${driver.is_online ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-slate-900/50 rounded-lg p-3">
                <div class="text-xs text-slate-400">Total Completed</div>
                <div class="text-2xl font-bold">\${driver.total_completed || 0}</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3">
                <div class="text-xs text-slate-400">Success Rate</div>
                <div class="text-2xl font-bold text-green-400">\${successRate}</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3">
                <div class="text-xs text-slate-400">Total Revenue</div>
                <div class="text-xl font-bold text-emerald-400">$\${(parseFloat(driver.total_revenue) || 0).toFixed(2)}</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3">
                <div class="text-xs text-slate-400">Week Completed</div>
                <div class="text-xl font-bold">\${driver.week_completed || 0}</div>
              </div>
            </div>
          </div>
        \`;
      }).join('');
      
      lucide.createIcons();
    }

    function showToast(msg, color) {
      const container = document.getElementById('toast-container');
      const div = document.createElement('div');
      const bg = color === 'green' ? 'bg-green-600' : color === 'blue' ? 'bg-blue-600' : 'bg-red-600';
      div.className = bg + " text-white px-4 py-2 rounded shadow-lg mb-2 text-sm font-bold";
      div.innerText = msg;
      container.appendChild(div);
      setTimeout(() => div.remove(), 3000);
    }

    // Init
    updateDataSourceUI();
    refreshData();
  </script>
</body>
</html>`;

  return new Response(html, { 
    headers: { 
      "Content-Type": "text/html",
      "X-Content-Type-Options": "nosniff"
    } 
  });
}
