import { neon } from '@neondatabase/serverless';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const adminPin = env.ADMIN_PIN || "1234";
    const pinParam = url.searchParams.get("pin");
    
    if ((path === "/" || path === "/drivers") && pinParam !== adminPin) {
      return new Response("Unauthorized Access", { 
        status: 401,
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

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
      
      // Check if mode is specified in request body
      const body = await request.json();
      const { mode = 'cached', query, params = [] } = body;
      
      if (mode === 'live') {
        return await handleLiveDriverStats(env);
      } else {
        // Handle cached query directly with parsed body
        return await handleNeonQueryWithBody(env, query, params);
      }
    }

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

    if (path === "/test") {
      return await testConnection(env);
    }

    if (path === "/drivers") {
      return serveDriverStats(url.searchParams.get("pin"));
    }

    if (path === "/") {
      return serveDashboard(url.searchParams.get("pin"));
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function handleNeonQuery(request, env) {
  try {
    const { query, params = [] } = await request.json();
    return await handleNeonQueryWithBody(env, query, params);
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

async function handleNeonQueryWithBody(env, query, params = []) {
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
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LuggageLink Ops</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            slate: {
              50: '#f8fafc',
              100: '#f1f5f9',
              200: '#e2e8f0',
              300: '#cbd5e1',
              400: '#94a3b8',
              500: '#64748b',
              600: '#475569',
              700: '#334155',
              800: '#1e293b',
              900: '#0f172a',
              950: '#020617',
            }
          }
        }
      }
    }
  </script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body { font-family: sans-serif; }
    
    th { cursor: pointer; user-select: none; transition: color 0.2s; }
    th:hover { color: #4ade80; }
    
    .sort-indicator { display: inline-block; margin-left: 4px; width: 10px; }

    .address-truncate { 
        max-width: 160px; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        display: inline-block;
        vertical-align: middle;
    }

    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans selection:bg-green-500 selection:text-white">
  
  <nav class="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-50 shadow-md">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="bg-purple-600 text-white p-2.5 rounded-lg shadow-inner shadow-green-400/20">
                <i data-lucide="tower-control" class="w-7 h-7"></i>
            </div>
            <div>
                <h1 class="text-xl font-bold tracking-tight">LuggageLink Ops</h1>
                <div class="flex items-center gap-2">
                    <span id="status-indicator" class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                    <p id="status-text" class="text-xs text-slate-400 font-medium">Connecting...</p>
                </div>
            </div>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="window.location.href='/drivers?pin=${pin}'" class="group bg-orange-700 hover:bg-orange-600 border border-orange-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2">
            <i data-lucide="users" class="w-4 h-4"></i>
            Driver Stats
          </button>
          <button onclick="refreshData()" class="group bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2">
            <i data-lucide="refresh-cw" class="w-4 h-4 group-hover:rotate-180 transition-transform duration-500"></i>
            Refresh Data
          </button>
        </div>
    </div>
  </nav>

  <div class="max-w-7xl mx-auto p-6 space-y-6">
    
    <div id="toast-container" class="fixed top-24 right-6 z-50 pointer-events-none"></div>

    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" id="stats-grid">
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
        <div class="bg-slate-800 h-24 rounded-xl animate-pulse"></div>
    </div>

    <div class="bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden flex flex-col h-[70vh]">
      
      <div class="px-6 py-4 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center backdrop-blur">
         <div class="flex items-center gap-4">
             <h2 class="font-bold text-slate-200 text-lg flex items-center gap-2">
                <i data-lucide="package" class="w-5 h-5 text-green-500"></i> Active Shipments
             </h2>
             <span id="count-badge" class="bg-slate-700 text-slate-300 px-2.5 py-0.5 rounded-full text-xs font-bold border border-slate-600">0</span>
         </div>
         
         <div class="flex items-center gap-3">
             <select id="statusFilter" onchange="renderTable()" class="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded-lg px-3 py-2 focus:border-green-500 outline-none cursor-pointer hover:bg-slate-900/80">
                <option value="">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="PICKED_UP">In-Transit</option>
                <option value="DELIVERED">Delivered</option>
             </select>
         </div>
      </div>

      <div class="overflow-auto flex-1 custom-scrollbar">
        <table class="min-w-full divide-y divide-slate-700">
          <thead class="bg-slate-900/80 sticky top-0 z-10 backdrop-blur-sm">
            <tr>
              <th onclick="sortTable(0)" class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                ID <span class="sort-indicator text-green-400" data-sort-key="0"></span>
              </th>
              <th onclick="sortTable(1)" class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                Created <span class="sort-indicator text-green-400" data-sort-key="1">▼</span>
              </th>
              <th onclick="sortTable(2)" class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                Status <span class="sort-indicator text-green-400" data-sort-key="2"></span>
              </th>
              <th onclick="sortTable(3)" class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                Driver <span class="sort-indicator text-green-400" data-sort-key="3"></span>
              </th>
              <th onclick="sortTable(4)" class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                Route <span class="sort-indicator text-green-400" data-sort-key="4"></span>
              </th>
              <th class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                Customer Info
              </th>
            </tr>
          </thead>
          <tbody id="table-body" class="bg-slate-800 divide-y divide-slate-700 text-sm">
            <tr>
                <td colspan="6" class="px-6 py-12 text-center text-slate-500">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <i data-lucide="loader-2" class="animate-spin w-8 h-8 text-green-500"></i>
                        <span>Loading live data...</span>
                    </div>
                </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div class="bg-slate-900 px-6 py-2 border-t border-slate-700 text-[10px] text-slate-500 flex justify-between items-center">
        <span>SECURE OPS ENVIRONMENT</span>
        <span id="last-updated">Updating...</span>
      </div>
    </div>
  </div>

  <script>
    lucide.createIcons();
    
    let allShipments = [];
    let allDrivers = [];
    let sortOrder = { 1: 'desc' };
    let currentSortedCol = 1;

    async function refreshData() {
        await loadDrivers();
        await Promise.all([loadStats(), loadShipments()]);
    }

    async function loadStats() {
        try {
            const res = await fetch('/api/neon-query?pin=${pin}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: 'SELECT COUNT(*) FILTER (WHERE status = \\'PENDING\\') as pending, COUNT(*) FILTER (WHERE status = \\'ASSIGNED\\') as assigned, COUNT(*) FILTER (WHERE status = \\'PICKED_UP\\') as picked_up, COUNT(*) FILTER (WHERE status = \\'DELIVERED\\') as delivered, COALESCE(SUM(price_cents), 0) / 100.0 as total_revenue, (SELECT COUNT(*) FROM driver_profiles WHERE is_online = true AND user_type = \\'driver\\') as online_drivers, (SELECT COUNT(*) FROM driver_profiles WHERE user_type = \\'driver\\') as total_drivers FROM shipments WHERE created_at > NOW() - INTERVAL \\'30 days\\''
                })
            });
            
            const data = await res.json();
            
            const makeCard = (label, val, color, clickable = false) => {
                const cursor = clickable ? 'cursor-pointer' : '';
                const onclick = clickable ? "onclick=\\"window.location.href='/drivers?pin=${pin}'\\" " : '';
                return '<div ' + onclick + 'class="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden group hover:border-' + color + '-500/50 transition-colors ' + cursor + '">' +
                       '<div class="absolute top-0 right-0 w-16 h-16 bg-' + color + '-500/10 rounded-bl-full -mr-2 -mt-2 transition-transform group-hover:scale-110"></div>' +
                       '<div class="text-slate-400 text-[10px] font-bold uppercase tracking-wider mb-1">' + label + '</div>' +
                       '<div class="text-2xl font-black text-' + color + '-400 relative z-10">' + (val || 0) + '</div>' +
                       '</div>';
            };

            const grid = document.getElementById('stats-grid');
            grid.innerHTML = 
                makeCard('Pending', data.rows?.[0]?.pending, 'yellow') +
                makeCard('Assigned', data.rows?.[0]?.assigned, 'blue') +
                makeCard('In Transit', data.rows?.[0]?.picked_up, 'purple') +
                makeCard('Completed', data.rows?.[0]?.delivered, 'green') +
                makeCard('Revenue', '$' + parseFloat(data.rows?.[0]?.total_revenue || 0).toFixed(2), 'emerald') +
                makeCard('Active Drivers', (data.rows?.[0]?.online_drivers || 0) + '/' + (data.rows?.[0]?.total_drivers || 0), 'orange', true);

            document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-green-500";
            document.getElementById('status-text').innerText = "Connected";

        } catch (e) { 
            console.warn("Stats error", e);
            document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-red-500";
            document.getElementById('status-text').innerText = "Connection Error";
            showToast("Failed to load statistics", "red");
        }
    }

    async function loadDrivers() {
        try {
            const res = await fetch('/api/neon-query?pin=${pin}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: "SELECT id, email, CONCAT(first_name, ' ', last_name) as name, is_online FROM driver_profiles WHERE user_type = 'driver' ORDER BY is_online DESC, first_name ASC"
                })
            });
            
            const data = await res.json();
            allDrivers = data.rows || [];
        } catch (e) { 
            console.error("Driver load failed", e);
            showToast("Failed to load drivers", "red");
        }
    }

    async function loadShipments() {
        const tbody = document.getElementById('table-body');
        try {
            const res = await fetch('/api/neon-query?pin=${pin}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: "SELECT s.id, s.created_at, s.status, s.driver_id, s.origin_airport, s.destination_airport, s.pickup_address, s.dropoff_address, s.pickup_photo_url, s.delivery_photo_url, s.price_cents, s.customer_name, s.customer_email, s.customer_phone, s.luggage_description, s.special_instructions, CONCAT(dp.first_name, ' ', dp.last_name) as driver_name FROM shipments s LEFT JOIN driver_profiles dp ON s.driver_id = dp.id WHERE s.created_at > NOW() - INTERVAL '30 days' ORDER BY s.created_at DESC LIMIT 100"
                })
            });
            
            const data = await res.json();
            allShipments = data.rows || [];
            
            document.getElementById('count-badge').innerText = allShipments.length;
            document.getElementById('last-updated').innerText = "Synced: " + new Date().toLocaleTimeString();

            renderTable();

        } catch (e) { 
            console.error("Shipment load failed", e); 
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-red-400">Connection Error: ' + e.message + '</td></tr>';
            showToast("Failed to load shipments", "red");
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function fmtLoc(s, type) {
        const code = type === 'pickup' ? s.origin_airport : s.destination_airport;
        const addr = type === 'pickup' ? s.pickup_address : s.dropoff_address;

        if (code && code.length >= 3) {
            return '<span class="font-black text-white bg-slate-700 px-1.5 rounded text-[10px] tracking-wide" title="' + (addr || '') + '">' + code + '</span>';
        }
        
        if (addr && addr.length > 2) {
            return '<span class="address-truncate text-slate-400" title="' + addr + '">' + addr + '</span>';
        }

        return '<span class="text-slate-600 text-[10px] italic">N/A</span>';
    }

    function renderTable() {
        const tbody = document.getElementById('table-body');
        const filter = document.getElementById('statusFilter').value;
        
        let list = filter ? allShipments.filter(s => s.status === filter) : [...allShipments];

        list.sort((a, b) => {
            const colKey = currentSortedCol;
            let valA, valB;

            switch(colKey) {
                case 0: valA = a.id; valB = b.id; break;
                case 1: valA = a.created_at; valB = b.created_at; break;
                case 2: valA = a.status; valB = b.status; break;
                case 3: valA = a.driver_name || ''; valB = b.driver_name || ''; break;
                case 4: valA = a.origin_airport || ''; valB = b.origin_airport || ''; break;
                default: return 0;
            }

            if (valA < valB) return sortOrder[colKey] === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder[colKey] === 'asc' ? 1 : -1;
            return 0;
        });

        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-slate-500 italic">No shipments found.</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(s => {
            const stMap = {
                'PENDING': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
                'ASSIGNED': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                'PICKED_UP': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                'DELIVERED': 'bg-green-500/10 text-green-400 border-green-500/20'
            };
            const badgeClass = stMap[s.status] || 'bg-slate-700 text-slate-400';

            let driverHtml = '';
            const dId = s.driver_id;

            if (s.status === 'PENDING') {
                const options = allDrivers
                    .filter(d => d.is_online)
                    .map(d => '<option value="' + d.id + '">' + (d.name || d.email) + '</option>')
                    .join('');
                
                if(options) {
                    driverHtml = 
                    '<div class="flex items-center gap-2" onclick="event.stopPropagation()">' +
                        '<select id="assign-' + s.id + '" class="bg-slate-900 border border-slate-600 text-xs rounded px-2 py-1 text-slate-300 w-28 focus:border-green-500 outline-none">' +
                            '<option value="">Assign...</option>' +
                            options +
                        '</select>' +
                        '<button onclick="assignDriver(\\''+s.id+'\\')" class="bg-green-600 hover:bg-green-500 text-white p-1 rounded transition-colors" title="Confirm Assignment">' +
                            '<i data-lucide="check" class="w-3 h-3"></i>' +
                        '</button>' +
                    '</div>';
                } else {
                    driverHtml = '<span class="text-red-400 text-xs italic opacity-75">No Drivers Online</span>';
                }
            } else if (dId) {
                const dName = s.driver_name || 'ID: ' + (dId?.slice(0,5) || 'N/A');
                driverHtml = 
                    '<div class="flex items-center gap-1.5 text-indigo-400">' +
                        '<i data-lucide="user" class="w-3 h-3"></i>' +
                        '<span class="font-mono text-xs font-bold">' + dName + '</span>' +
                    '</div>';
            } else {
                driverHtml = '<span class="text-slate-600 text-xs italic">Unassigned</span>';
            }

            let customerInfoParts = [];
            const custName = escapeHtml(s.customer_name) || 'Customer';
            const custEmail = escapeHtml(s.customer_email);
            const custPhone = escapeHtml(s.customer_phone);
            
            customerInfoParts.push('<div class="text-sm font-medium text-slate-300">' + custName + '</div>');
            if (custEmail) customerInfoParts.push('<div class="text-xs text-slate-400">' + custEmail + '</div>');
            if (custPhone) customerInfoParts.push('<div class="text-xs text-slate-400">' + custPhone + '</div>');
            
            const customerInfoHtml = '<div class="flex flex-col gap-0.5">' + customerInfoParts.join('') + '</div>';

            const d = new Date(s.created_at);
            const dateStr = d.toLocaleDateString([], {month:'short', day:'numeric'});
            const timeStr = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

        return '<tr class="hover:bg-slate-800 transition-colors border-b border-slate-700/50 group">' +
                 '<td class="px-6 py-4 whitespace-nowrap">' +
                 '<div class="font-mono text-xs text-slate-500 group-hover:text-slate-300 transition-colors">#' + (s.id?.slice(0,8) || 'N/A') + '</div>' +
                 '</td>' +
                 '<td class="px-6 py-4 whitespace-nowrap">' +
                 '<div class="text-sm font-medium text-slate-300">' + dateStr + '</div>' +
                 '<div class="text-[10px] text-slate-500">' + timeStr + '</div>' +
                 '</td>' +
                 '<td class="px-6 py-4 whitespace-nowrap">' +
                 '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ' + badgeClass + '">' +
                 s.status +
                 '</span>' +
                 '</td>' +
                 '<td class="px-6 py-4 whitespace-nowrap">' +
                 driverHtml +
                 '</td>' +
                 '<td class="px-6 py-4 whitespace-nowrap text-xs text-slate-300">' +
                 '<div class="flex items-center gap-2">' +
                 fmtLoc(s, 'pickup') +
                 '<i data-lucide="arrow-right" class="w-3 h-3 text-slate-600"></i>' +
                 fmtLoc(s, 'dropoff') +
                 '</div>' +
                 '</td>' +
                 '<td class="px-6 py-4 whitespace-nowrap">' +
                 customerInfoHtml +
                 '</td>' +
                 '</tr>';
            }).join('');
        
        lucide.createIcons();
    }

    function sortTable(colIndex) {
        const isAsc = sortOrder[colIndex] === 'asc';
        sortOrder[colIndex] = isAsc ? 'desc' : 'asc';
        currentSortedCol = colIndex;

        document.querySelectorAll('.sort-indicator').forEach(el => el.innerHTML = '');
        const headerIcon = document.querySelector('[data-sort-key="' + colIndex + '"]');
        if(headerIcon) headerIcon.innerHTML = isAsc ? '▲' : '▼'; 

        renderTable();
    }

    async function assignDriver(shipmentId) {
        const select = document.getElementById('assign-' + shipmentId);
        const driverId = select.value;
        if(!driverId) return;

        try {
            select.disabled = true;
            const res = await fetch('/api/neon-query?pin=${pin}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: 'UPDATE shipments SET status = \\'ASSIGNED\\', driver_id = $1, claimed_at = NOW() WHERE id = $2 RETURNING id',
                    params: [driverId, shipmentId]
                })
            });

            if (res.ok) {
                showToast("Driver assigned successfully", "green");
                await refreshData();
            } else {
                const err = await res.json();
                showToast(err.error || "Failed to assign", "red");
                select.disabled = false;
            }
        } catch (e) {
            console.error(e);
            showToast("Network Error", "red");
            select.disabled = false;
        }
    }

    function showToast(msg, color) {
        const container = document.getElementById('toast-container');
        const div = document.createElement('div');
        const bg = color === 'green' ? 'bg-green-600' : 'bg-red-600';
        div.className = bg + " text-white px-4 py-2 rounded shadow-lg mb-2 text-sm font-bold animate-bounce pointer-events-auto";
        div.innerText = msg;
        container.appendChild(div);
        setTimeout(() => div.remove(), 3000);
    }

    refreshData();
    setInterval(refreshData, 30000);
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
function serveDriverStats(pin) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Driver Performance</title>
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
  <style>
    body { font-family: sans-serif; }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
    .driver-card { transition: all 0.3s ease; }
    .driver-card:hover { transform: translateY(-2px); }
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
      <div class="flex gap-3 items-center">
        <div class="flex items-center gap-2 bg-slate-900 rounded-lg border border-slate-600 p-1">
          <button id="btn-cached" onclick="setDataSource('cached')" class="flex items-center gap-1.5 bg-purple-700 px-3 py-2 rounded text-sm font-medium">
            <i data-lucide="database" class="w-4 h-4"></i>
            Cached
          </button>
          <button id="btn-live" onclick="setDataSource('live')" class="flex items-center gap-1.5 bg-transparent px-3 py-2 rounded text-sm font-medium text-slate-400 hover:text-white">
            <i data-lucide="zap" class="w-4 h-4"></i>
            Live
          </button>
        </div>
        <button onclick="window.location.href='/?pin=${pin}'" class="bg-slate-700 px-4 py-2 rounded text-sm hover:bg-slate-600">Back</button>
      </div>
    </div>
  </nav>

  <div class="max-w-7xl mx-auto p-6 space-y-6">
    <div id="toast-container" class="fixed top-24 right-6 z-50"></div>
    
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
      <div class="flex flex-wrap gap-4 items-center">
        <button onclick="refreshData()" class="flex items-center gap-2 bg-slate-700 px-4 py-2 rounded text-sm hover:bg-slate-600">
          <i data-lucide="refresh-cw" class="w-4 h-4"></i>
          Refresh
        </button>
        <button onclick="recalculateStats()" class="flex items-center gap-2 bg-purple-700 px-4 py-2 rounded text-sm hover:bg-purple-600">
          <i data-lucide="database" class="w-4 h-4"></i>
          Update Cache
        </button>
        <button onclick="toggleAutoRefresh()" id="btn-auto-refresh" class="flex items-center gap-2 bg-emerald-700 px-4 py-2 rounded text-sm hover:bg-emerald-600">
          <i data-lucide="play" class="w-4 h-4"></i>
          Auto-Refresh: <span id="auto-refresh-status">On</span>
        </button>
        <div class="flex items-center gap-2 text-xs text-slate-400 ml-auto">
          <i data-lucide="clock" class="w-4 h-4"></i>
          <span id="cache-freshness">Cache age: calculating...</span>
        </div>
      </div>
      
      <div class="flex flex-wrap gap-4 items-center">
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-400">Sort by:</label>
          <select id="sort-select" onchange="applySortAndFilter()" class="bg-slate-700 text-white px-3 py-2 rounded text-sm border border-slate-600 focus:outline-none focus:border-purple-500">
            <option value="deliveries-desc">Most Deliveries</option>
            <option value="deliveries-asc">Least Deliveries</option>
            <option value="revenue-desc">Highest Revenue</option>
            <option value="revenue-asc">Lowest Revenue</option>
            <option value="success-desc">Highest Success Rate</option>
            <option value="success-asc">Lowest Success Rate</option>
            <option value="cancel-desc">Highest Cancel Rate</option>
            <option value="cancel-asc">Lowest Cancel Rate</option>
            <option value="active-recent">Most Recently Active</option>
            <option value="active-oldest">Least Recently Active</option>
          </select>
        </div>
        
        <div class="flex items-center gap-2">
          <label class="text-sm text-slate-400">Filter:</label>
          <select id="filter-select" onchange="applySortAndFilter()" class="bg-slate-700 text-white px-3 py-2 rounded text-sm border border-slate-600 focus:outline-none focus:border-purple-500">
            <option value="all">All Drivers</option>
            <option value="high-performers">High Performers</option>
            <option value="needs-attention">Needs Attention</option>
          </select>
        </div>
      </div>
    </div>

    <div id="drivers-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-slate-800 h-96 rounded animate-pulse"></div>
      <div class="bg-slate-800 h-96 rounded animate-pulse"></div>
    </div>
    
    <div class="text-center text-slate-500 text-sm">
      <span id="last-updated">Loading...</span>
    </div>
  </div>

  <script>
    lucide.createIcons();
    
    let allDrivers = [];
    let currentDataSource = 'cached';
    let dataFreshness = null;
    let autoRefreshEnabled = true;
    let autoRefreshInterval = null;
    let freshnessUpdateInterval = null;
    
    function setDataSource(source) {
      currentDataSource = source;
      updateDataSourceUI();
      refreshData();
    }
    
    function updateDataSourceUI() {
      const btnCached = document.getElementById('btn-cached');
      const btnLive = document.getElementById('btn-live');
      
      if (currentDataSource === 'cached') {
        btnCached.className = 'flex items-center gap-1.5 bg-purple-700 px-3 py-2 rounded text-sm font-medium';
        btnLive.className = 'flex items-center gap-1.5 bg-transparent px-3 py-2 rounded text-sm font-medium text-slate-400 hover:text-white';
      } else {
        btnCached.className = 'flex items-center gap-1.5 bg-transparent px-3 py-2 rounded text-sm font-medium text-slate-400 hover:text-white';
        btnLive.className = 'flex items-center gap-1.5 bg-emerald-600 px-3 py-2 rounded text-sm font-medium';
      }
      
      lucide.createIcons();
    }
    
    function toggleAutoRefresh() {
      autoRefreshEnabled = !autoRefreshEnabled;
      const btn = document.getElementById('btn-auto-refresh');
      const status = document.getElementById('auto-refresh-status');
      
      if (autoRefreshEnabled) {
        btn.className = 'flex items-center gap-2 bg-emerald-700 px-4 py-2 rounded text-sm hover:bg-emerald-600';
        status.innerText = 'On';
        startAutoRefresh();
      } else {
        btn.className = 'flex items-center gap-2 bg-slate-700 px-4 py-2 rounded text-sm hover:bg-slate-600';
        status.innerText = 'Off';
        stopAutoRefresh();
      }
      
      lucide.createIcons();
    }
    
    function startAutoRefresh() {
      if (autoRefreshInterval) clearInterval(autoRefreshInterval);
      autoRefreshInterval = setInterval(() => {
        if (autoRefreshEnabled) {
          refreshData();
        }
      }, 30000); // Refresh every 30 seconds
    }
    
    function stopAutoRefresh() {
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
      }
    }
    
    function updateCacheFreshness() {
      if (!dataFreshness) return;
      
      const now = new Date();
      const diff = now - dataFreshness;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      let freshnessText = '';
      if (hours > 0) {
        freshnessText = hours + 'h ' + (minutes % 60) + 'm ago';
      } else if (minutes > 0) {
        freshnessText = minutes + 'm ago';
      } else {
        freshnessText = seconds + 's ago';
      }
      
      document.getElementById('cache-freshness').innerText = currentDataSource === 'cached' 
        ? 'Cache age: ' + freshnessText
        : 'Live data';
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
        const res = await fetch('/api/refresh-driver-stats?pin=${pin}', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
          showToast('Cache updated: ' + data.driversUpdated + ' drivers', "green");
          currentDataSource = 'cached';
          setDataSource('cached');
          dataFreshness = new Date();
          updateCacheFreshness();
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
          res = await fetch('/api/live-driver-stats?pin=${pin}', { method: 'POST' });
        } else {
          res = await fetch('/api/driver-stats?pin=${pin}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'SELECT * FROM driver_stats ORDER BY total_completed DESC' })
          });
        }
        
        const data = await res.json();
        allDrivers = data.rows || [];
        
        if (data.timestamp) {
          dataFreshness = new Date(data.timestamp);
        } else if (allDrivers.length > 0 && allDrivers[0].stats_updated_at) {
          dataFreshness = new Date(allDrivers[0].stats_updated_at);
        } else {
          dataFreshness = new Date();
        }
        
        updateCacheFreshness();
        
        // Clear existing freshness update interval before creating a new one
        if (freshnessUpdateInterval) {
          clearInterval(freshnessUpdateInterval);
        }
        freshnessUpdateInterval = setInterval(updateCacheFreshness, 10000); // Update freshness every 10 seconds
        
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-green-500";
        document.getElementById('status-text').innerText = 'Connected - ' + allDrivers.length + ' drivers (' + currentDataSource + ')';
        
        applySortAndFilter();
        
      } catch (e) { 
        console.error("Error:", e);
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-red-500";
        document.getElementById('status-text').innerText = "Error";
        showToast("Failed to load data", "red");
      }
    }
    
    function applySortAndFilter() {
      let filtered = [...allDrivers];
      
      // Apply filter
      const filterValue = document.getElementById('filter-select').value;
      if (filterValue === 'high-performers') {
        filtered = filtered.filter(d => {
          // Only include drivers with valid success rate data
          if (d.success_rate === null || d.success_rate === undefined) return false;
          const successRate = parseFloat(d.success_rate);
          const weekCompleted = parseInt(d.week_completed) || 0;
          return !isNaN(successRate) && successRate >= 90 && weekCompleted >= 20;
        });
      } else if (filterValue === 'needs-attention') {
        filtered = filtered.filter(d => {
          // Include drivers with no data
          if (d.success_rate === null || d.success_rate === undefined) return true;
          const successRate = parseFloat(d.success_rate);
          const weekCompleted = parseInt(d.week_completed) || 0;
          // Include drivers with poor performance
          return isNaN(successRate) || successRate < 70 || weekCompleted < 5;
        });
      }
      
      // Apply sort
      const sortValue = document.getElementById('sort-select').value;
      filtered.sort((a, b) => {
        switch(sortValue) {
          case 'deliveries-desc':
            return (b.total_completed || 0) - (a.total_completed || 0);
          case 'deliveries-asc':
            return (a.total_completed || 0) - (b.total_completed || 0);
          case 'revenue-desc':
            return (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0);
          case 'revenue-asc':
            return (parseFloat(a.total_revenue) || 0) - (parseFloat(b.total_revenue) || 0);
          case 'success-desc':
            return (parseFloat(b.success_rate) || 0) - (parseFloat(a.success_rate) || 0);
          case 'success-asc':
            return (parseFloat(a.success_rate) || 0) - (parseFloat(b.success_rate) || 0);
          case 'cancel-desc':
            return (parseFloat(b.cancel_rate) || 0) - (parseFloat(a.cancel_rate) || 0);
          case 'cancel-asc':
            return (parseFloat(a.cancel_rate) || 0) - (parseFloat(b.cancel_rate) || 0);
          case 'active-recent':
            return new Date(b.last_active || 0) - new Date(a.last_active || 0);
          case 'active-oldest':
            return new Date(a.last_active || 0) - new Date(b.last_active || 0);
          default:
            return 0;
        }
      });
      
      renderDriverCards(filtered);
    }

    function renderDriverCards(drivers) {
      const grid = document.getElementById('drivers-grid');
      
      if (drivers.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12">No drivers found</div>';
        return;
      }
      
      grid.innerHTML = drivers.map(driver => {
        const name = (driver.first_name || '') + ' ' + (driver.last_name || '');
        const initials = name.trim().split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '??';
        
        // Success rates with color coding
        const successRate = driver.success_rate !== null ? parseFloat(driver.success_rate).toFixed(1) : null;
        const successRateDisplay = successRate !== null ? successRate + '%' : 'N/A';
        const successRateColor = successRate !== null && successRate >= 90 ? 'green' : 
                                  successRate !== null && successRate >= 70 ? 'yellow' : 'red';
        
        const monthSuccessRate = driver.month_success_rate !== null ? parseFloat(driver.month_success_rate).toFixed(1) : null;
        const monthSuccessRateDisplay = monthSuccessRate !== null ? monthSuccessRate + '%' : 'N/A';
        const monthSuccessRateColor = monthSuccessRate !== null && monthSuccessRate >= 90 ? 'green' : 
                                       monthSuccessRate !== null && monthSuccessRate >= 70 ? 'yellow' : 'red';
        
        const weekSuccessRate = driver.week_success_rate !== null ? parseFloat(driver.week_success_rate).toFixed(1) : null;
        const weekSuccessRateDisplay = weekSuccessRate !== null ? weekSuccessRate + '%' : 'N/A';
        
        // Cancel rates with warning threshold
        const cancelRate = driver.cancel_rate !== null ? parseFloat(driver.cancel_rate).toFixed(1) + '%' : 'N/A';
        const monthCancelRate = driver.month_cancel_rate !== null ? parseFloat(driver.month_cancel_rate).toFixed(1) : null;
        const monthCancelRateDisplay = monthCancelRate !== null ? monthCancelRate + '%' : 'N/A';
        const monthCancelRateColor = monthCancelRate !== null && monthCancelRate > 10 ? 'red' : 'slate';
        
        // Revenues
        const totalRevenue = (parseFloat(driver.total_revenue) || 0).toFixed(2);
        const monthRevenue = (parseFloat(driver.month_revenue) || 0).toFixed(2);
        const weekRevenue = (parseFloat(driver.week_revenue) || 0).toFixed(2);
        
        // Activity info
        const lastActive = driver.last_active ? new Date(driver.last_active).toLocaleDateString() : 'N/A';
        const driverSince = driver.driver_joined ? new Date(driver.driver_joined).toLocaleDateString() : 'N/A';
        
        const dataSourceClass = 'data-source-' + currentDataSource;
        
        return '<div class="driver-card ' + dataSourceClass + ' bg-slate-800 rounded-xl p-6 border-2 border-slate-700">' +
          '<!-- Header -->' +
          '<div class="flex items-start gap-4 mb-4">' +
            '<div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-xl">' +
              initials +
            '</div>' +
            '<div class="flex-1">' +
              '<h3 class="text-lg font-bold">' + name + '</h3>' +
              '<p class="text-xs text-slate-400">' + (driver.email || 'No email') + '</p>' +
              '<span class="text-xs text-' + (driver.is_online ? 'green' : 'slate') + '-400">' +
                (driver.is_online ? '● Online' : '● Offline') +
              '</span>' +
            '</div>' +
          '</div>' +
          
          '<!-- Current Activity Status -->' +
          '<div class="flex gap-2 mb-4 text-xs">' +
            '<span class="bg-blue-900/30 text-blue-400 px-2 py-1 rounded">Assigned: ' + (driver.assigned_count || 0) + '</span>' +
            '<span class="bg-purple-900/30 text-purple-400 px-2 py-1 rounded">In Transit: ' + (driver.in_transit_count || 0) + '</span>' +
            '<span class="bg-slate-700 text-slate-300 px-2 py-1 rounded">Pending: ' + (driver.pending_count || 0) + '</span>' +
          '</div>' +
          
          '<!-- Main Metrics Grid -->' +
          '<div class="grid grid-cols-2 gap-3 mb-3">' +
            '<div class="bg-slate-900/50 rounded-lg p-3">' +
              '<div class="text-xs text-slate-400">Total Assigned</div>' +
              '<div class="text-xl font-bold">' + (driver.total_assigned || 0) + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-3">' +
              '<div class="text-xs text-slate-400">All-Time Success</div>' +
              '<div class="text-xl font-bold text-' + successRateColor + '-400">' + successRateDisplay + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-3">' +
              '<div class="text-xs text-slate-400">All-Time Cancel</div>' +
              '<div class="text-xl font-bold text-slate-400">' + cancelRate + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-3">' +
              '<div class="text-xs text-slate-400">Rating</div>' +
              '<div class="text-xl font-bold text-slate-400">' + (driver.avg_rating || 0).toFixed(1) + ' ★</div>' +
            '</div>' +
          '</div>' +
          
          '<!-- Revenue Stats -->' +
          '<div class="grid grid-cols-3 gap-2 mb-3">' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">Total Revenue</div>' +
              '<div class="text-lg font-bold text-emerald-400">$' + totalRevenue + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">30-Day Revenue</div>' +
              '<div class="text-lg font-bold text-emerald-400">$' + monthRevenue + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">Weekly Revenue</div>' +
              '<div class="text-lg font-bold text-emerald-400">$' + weekRevenue + '</div>' +
            '</div>' +
          '</div>' +
          
          '<!-- 30-Day Performance -->' +
          '<div class="grid grid-cols-2 gap-3 mb-3">' +
            '<div class="bg-slate-900/50 rounded-lg p-3 border border-' + monthSuccessRateColor + '-500/30">' +
              '<div class="text-xs text-slate-400">30-Day Success Rate</div>' +
              '<div class="text-xl font-bold text-' + monthSuccessRateColor + '-400">' + monthSuccessRateDisplay + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-3 border border-' + monthCancelRateColor + '-500/30">' +
              '<div class="text-xs text-slate-400">30-Day Cancel Rate</div>' +
              '<div class="text-xl font-bold text-' + monthCancelRateColor + '-400">' + monthCancelRateDisplay + '</div>' +
            '</div>' +
          '</div>' +
          
          '<!-- Weekly Performance -->' +
          '<div class="grid grid-cols-3 gap-2 mb-3">' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">Weekly Completed</div>' +
              '<div class="text-lg font-bold">' + (driver.week_completed || 0) + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">Monthly Completed</div>' +
              '<div class="text-lg font-bold">' + (driver.month_completed || 0) + '</div>' +
            '</div>' +
            '<div class="bg-slate-900/50 rounded-lg p-2">' +
              '<div class="text-xs text-slate-400">Weekly Success</div>' +
              '<div class="text-lg font-bold text-blue-400">' + weekSuccessRateDisplay + '</div>' +
            '</div>' +
          '</div>' +
          
          '<!-- Activity Info -->' +
          '<div class="flex justify-between text-xs text-slate-500 pt-3 border-t border-slate-700">' +
            '<span>Last Active: ' + lastActive + '</span>' +
            '<span>Driver Since: ' + driverSince + '</span>' +
          '</div>' +
        '</div>';
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

    // Initialize
    refreshData();
    startAutoRefresh();
  </script>
</body>
</html>`, { 
    headers: { 
      "Content-Type": "text/html",
      "X-Content-Type-Options": "nosniff"
    } 
  });
}
