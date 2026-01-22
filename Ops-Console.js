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
    if ((path === "/" || path === "/drivers") && url.searchParams.get("pin") !== adminPin) {
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
      return await handleNeonQuery(request, env);
    }

    // 3. Handle driver stats API
    if (path === "/api/driver-stats" && request.method === "POST") {
      return await handleNeonQuery(request, env);
    }

    // 4. Handle driver timeline API
    if (path.startsWith("/api/driver-timeline/") && request.method === "POST") {
      return await handleNeonQuery(request, env);
    }

    // 5. Test endpoint
    if (path === "/test") {
      return await testConnection(env);
    }

    // 6. Serve the driver stats page
    if (path === "/drivers") {
      return serveDriverStats(url.searchParams.get("pin"));
    }

    // 7. Serve the dashboard
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
    
    // Use ONLY the connection string
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
    
    // For security, only allow SELECT and UPDATE queries
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

    // Connect to Neon DB using serverless driver
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

// Fixed: Using the official Neon serverless driver
async function executeNeonQuery(connectionString, query, params) {
  try {
    console.log('Executing query via Neon serverless driver...');

    // The neon() function returns an async SQL helper
    const sql = neon(connectionString);
    
    // Execute the query. The driver handles parameterization safely.
    const rows = await sql(query, params);
    
    console.log('Query successful, rows returned:', rows.length);

    return {
      rows: rows,
      rowCount: rows.length
    };

  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
}

// Test endpoint
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
    
    // Test with a simple query
    const testQuery = "SELECT 1 as test_value, NOW() as current_time";
    
    console.log('Testing Neon connection...');
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

// Function to serve the dashboard HTML
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
    
    /* Table Styles */
    th { cursor: pointer; user-select: none; transition: color 0.2s; }
    th:hover { color: #4ade80; } /* Green hover */
    
    .sort-indicator { display: inline-block; margin-left: 4px; width: 10px; }

    .address-truncate { 
        max-width: 160px; 
        white-space: nowrap; 
        overflow: hidden; 
        text-overflow: ellipsis; 
        display: inline-block;
        vertical-align: middle;
    }

    /* Custom Scrollbar */
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
        <button onclick="refreshData()" class="group bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2">
            <i data-lucide="refresh-cw" class="w-4 h-4 group-hover:rotate-180 transition-transform duration-500"></i>
            Refresh Data
        </button>
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
                <option value="PICKED_UP">Picked Up</option>
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
    
    // Global State
    let allShipments = [];
    let allDrivers = [];
    let sortOrder = { 1: 'desc' }; // Default sort by Created Date (Newest first)
    let currentSortedCol = 1;

    async function refreshData() {
        await loadDrivers();
        await Promise.all([loadStats(), loadShipments()]);
    }

    async function loadStats() {
        try {
            const res = await fetch('/api/neon-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: \`SELECT 
                      COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
                      COUNT(*) FILTER (WHERE status = 'ASSIGNED') as assigned,
                      COUNT(*) FILTER (WHERE status = 'PICKED_UP') as picked_up,
                      COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
                      COALESCE(SUM(price_cents), 0) / 100.0 as total_revenue,
                      (SELECT COUNT(*) FROM driver_profiles WHERE is_online = true) as online_drivers,
                      (SELECT COUNT(*) FROM driver_profiles) as total_drivers
                    FROM shipments
                    WHERE created_at > NOW() - INTERVAL '30 days'\`
                })
            });
            
            const data = await res.json();
            
            const makeCard = (label, val, color, clickable = false) => {
                const cursor = clickable ? 'cursor-pointer' : '';
                const onclick = clickable ? \`onclick="window.location.href='/drivers?pin=${new URLSearchParams(window.location.search).get('pin')}'" \` : '';
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

            // Update status indicator
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
            const res = await fetch('/api/neon-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: \`SELECT 
                      id,
                      email,
                      CONCAT(first_name, ' ', last_name) as name,
                      is_online
                    FROM driver_profiles
                    WHERE user_type = 'driver'
                    ORDER BY is_online DESC, first_name ASC\`
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
            const res = await fetch('/api/neon-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: \`SELECT 
                      s.id,
                      s.created_at,
                      s.status,
                      s.driver_id,
                      s.origin_airport,
                      s.destination_airport,
                      s.pickup_address,
                      s.dropoff_address,
                      s.pickup_photo_url,
                      s.delivery_photo_url,
                      s.price_cents,
                      s.customer_name,
                      s.customer_email,
                      s.customer_phone,
                      s.luggage_description,
                      s.special_instructions,
                      CONCAT(dp.first_name, ' ', dp.last_name) as driver_name
                    FROM shipments s
                    LEFT JOIN driver_profiles dp ON s.driver_id = dp.id
                    WHERE s.created_at > NOW() - INTERVAL '30 days'
                    ORDER BY s.created_at DESC
                    LIMIT 100\`
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

    // --- HTML ESCAPE FUNCTION ---
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- SMART LOCATION FORMATTER ---
    function fmtLoc(s, type) {
        const code = type === 'pickup' ? s.origin_airport : s.destination_airport;
        const addr = type === 'pickup' ? s.pickup_address : s.dropoff_address;

        // 1. Airport Code Badge
        if (code && code.length >= 3) {
            return '<span class="font-black text-white bg-slate-700 px-1.5 rounded text-[10px] tracking-wide" title="' + (addr || '') + '">' + code + '</span>';
        }
        
        // 2. Full Address Text
        if (addr && addr.length > 2) {
            return '<span class="address-truncate text-slate-400" title="' + addr + '">' + addr + '</span>';
        }

        return '<span class="text-slate-600 text-[10px] italic">N/A</span>';
    }

    function renderTable() {
        const tbody = document.getElementById('table-body');
        const filter = document.getElementById('statusFilter').value;
        
        // 1. Filter
        let list = filter ? allShipments.filter(s => s.status === filter) : [...allShipments];

        // 2. Sort
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
            // Status Logic
            const stMap = {
                'PENDING': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
                'ASSIGNED': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                'PICKED_UP': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                'DELIVERED': 'bg-green-500/10 text-green-400 border-green-500/20'
            };
            const badgeClass = stMap[s.status] || 'bg-slate-700 text-slate-400';

            // Driver Logic
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
                        '<button onclick="assignDriver(\\'' + s.id + '\\')" class="bg-green-600 hover:bg-green-500 text-white p-1 rounded transition-colors" title="Confirm Assignment">' +
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

            // Customer Info Logic
            let customerInfoParts = [];
            const custName = escapeHtml(s.customer_name) || 'Customer';
            const custEmail = escapeHtml(s.customer_email);
            const custPhone = escapeHtml(s.customer_phone);
            
            customerInfoParts.push('<div class="text-sm font-medium text-slate-300">' + custName + '</div>');
            if (custEmail) customerInfoParts.push('<div class="text-xs text-slate-400">' + custEmail + '</div>');
            if (custPhone) customerInfoParts.push('<div class="text-xs text-slate-400">' + custPhone + '</div>');
            
            const customerInfoHtml = '<div class="flex flex-col gap-0.5">' + customerInfoParts.join('') + '</div>';

            // Date Formatting
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

        // Update Icons
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
            const res = await fetch('/api/neon-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: \`UPDATE shipments 
                            SET status = 'ASSIGNED', driver_id = \$1, claimed_at = NOW() 
                            WHERE id = \$2 
                            RETURNING id\`,
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

    // Init
    refreshData();
    setInterval(refreshData, 30000); // Poll every 30s
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

// Function to serve the driver stats HTML
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
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; }
    
    /* Custom Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
    
    .driver-card { transition: all 0.3s ease; }
    .driver-card:hover { transform: translateY(-2px); }
    
    .performance-high { border-color: #22c55e; }
    .performance-average { border-color: #eab308; }
    .performance-low { border-color: #ef4444; }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans selection:bg-green-500 selection:text-white">
  
  <nav class="bg-slate-800 border-b border-slate-700 px-6 py-4 sticky top-0 z-50 shadow-md">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
        <div class="flex items-center gap-3">
            <div class="bg-purple-600 text-white p-2.5 rounded-lg shadow-inner shadow-green-400/20">
                <i data-lucide="users" class="w-7 h-7"></i>
            </div>
            <div>
                <h1 class="text-xl font-bold tracking-tight">Driver Performance</h1>
                <div class="flex items-center gap-2">
                    <span id="status-indicator" class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                    <p id="status-text" class="text-xs text-slate-400 font-medium">Loading...</p>
                </div>
            </div>
        </div>
        <button onclick="window.location.href='/?pin=${pin}'" class="group bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2">
            <i data-lucide="arrow-left" class="w-4 h-4"></i>
            Back to Dashboard
        </button>
    </div>
  </nav>

  <div class="max-w-7xl mx-auto p-6 space-y-6">
    
    <div id="toast-container" class="fixed top-24 right-6 z-50 pointer-events-none"></div>

    <!-- Sort and Filter Controls -->
    <div class="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-wrap gap-4 items-center">
      <div class="flex items-center gap-2">
        <i data-lucide="arrow-up-down" class="w-4 h-4 text-slate-400"></i>
        <label class="text-sm font-semibold text-slate-400">Sort By:</label>
        <select id="sortBy" onchange="applySortAndFilter()" class="bg-slate-900 border border-slate-600 text-slate-300 text-sm rounded-lg px-3 py-2 focus:border-green-500 outline-none cursor-pointer hover:bg-slate-900/80">
          <option value="deliveries-desc">Total Deliveries (High to Low)</option>
          <option value="deliveries-asc">Total Deliveries (Low to High)</option>
          <option value="revenue-desc">Revenue (High to Low)</option>
          <option value="revenue-asc">Revenue (Low to High)</option>
          <option value="rating-desc">Rating (High to Low)</option>
          <option value="rating-asc">Rating (Low to High)</option>
          <option value="success-desc">Success Rate (High to Low)</option>
          <option value="success-asc">Success Rate (Low to High)</option>
          <option value="active-recent">Last Active (Most Recent)</option>
          <option value="active-oldest">Last Active (Oldest)</option>
        </select>
      </div>
      
      <div class="flex items-center gap-2">
        <i data-lucide="filter" class="w-4 h-4 text-slate-400"></i>
        <label class="text-sm font-semibold text-slate-400">Online Status:</label>
        <select id="filterOnline" onchange="applySortAndFilter()" class="bg-slate-900 border border-slate-600 text-slate-300 text-sm rounded-lg px-3 py-2 focus:border-green-500 outline-none cursor-pointer hover:bg-slate-900/80">
          <option value="all">All</option>
          <option value="online">Online Only</option>
          <option value="offline">Offline Only</option>
        </select>
      </div>
      
      <div class="flex items-center gap-2">
        <label class="text-sm font-semibold text-slate-400">Performance:</label>
        <select id="filterPerformance" onchange="applySortAndFilter()" class="bg-slate-900 border border-slate-600 text-slate-300 text-sm rounded-lg px-3 py-2 focus:border-green-500 outline-none cursor-pointer hover:bg-slate-900/80">
          <option value="all">All</option>
          <option value="high">High Performers</option>
          <option value="attention">Needs Attention</option>
        </select>
      </div>
      
      <button onclick="refreshData()" class="ml-auto group bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2">
        <i data-lucide="refresh-cw" class="w-4 h-4 group-hover:rotate-180 transition-transform duration-500"></i>
        Refresh
      </button>
    </div>

    <!-- Driver Cards Grid -->
    <div id="drivers-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Loading state -->
      <div class="bg-slate-800 h-96 rounded-xl animate-pulse"></div>
      <div class="bg-slate-800 h-96 rounded-xl animate-pulse"></div>
    </div>
    
    <div class="text-center text-slate-500 text-sm">
      <span id="last-updated">Last updated: Loading...</span>
    </div>
  </div>

  <script>
    lucide.createIcons();
    
    // Global State
    let allDrivers = [];
    let charts = {};

    async function refreshData() {
      await loadDriverStats();
      document.getElementById('last-updated').innerText = 'Last updated: ' + new Date().toLocaleTimeString();
    }

    async function loadDriverStats() {
      try {
        const res = await fetch('/api/driver-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: \`SELECT 
              dp.id,
              dp.first_name,
              dp.last_name,
              dp.email,
              dp.is_online,
              dp.profile_photo_url,
              
              COUNT(*) FILTER (WHERE s.status = 'DELIVERED') as total_completed,
              COUNT(*) FILTER (WHERE s.status IN ('CANCELLED', 'FAILED')) as total_failed,
              COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND s.delivered_at > NOW() - INTERVAL '7 days') as week_completed,
              
              COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED'), 0) / 100.0 as total_revenue,
              MAX(GREATEST(s.delivered_at, dp.updated_at)) as last_active,
              
              CASE 
                WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED', 'FAILED')) > 0
                THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED')::float / 
                      COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED', 'FAILED'))::float * 100)
                ELSE 100
              END as success_rate,
              
              COALESCE(AVG(s.rating), 0) as avg_rating

            FROM driver_profiles dp
            LEFT JOIN shipments s ON s.driver_id = dp.id
            WHERE dp.user_type = 'driver'
            GROUP BY dp.id, dp.first_name, dp.last_name, dp.email, dp.is_online, dp.profile_photo_url
            ORDER BY total_completed DESC\`
          })
        });
        
        const data = await res.json();
        allDrivers = data.rows || [];
        
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-green-500";
        document.getElementById('status-text').innerText = "Connected - " + allDrivers.length + " drivers";
        
        applySortAndFilter();
        
      } catch (e) { 
        console.error("Driver stats error", e);
        document.getElementById('status-indicator').className = "w-2 h-2 rounded-full bg-red-500";
        document.getElementById('status-text').innerText = "Connection Error";
        showToast("Failed to load driver statistics", "red");
      }
    }

    function applySortAndFilter() {
      let filtered = [...allDrivers];
      
      // Apply filters
      const onlineFilter = document.getElementById('filterOnline').value;
      if (onlineFilter === 'online') {
        filtered = filtered.filter(d => d.is_online);
      } else if (onlineFilter === 'offline') {
        filtered = filtered.filter(d => !d.is_online);
      }
      
      const perfFilter = document.getElementById('filterPerformance').value;
      if (perfFilter === 'high') {
        filtered = filtered.filter(d => d.success_rate >= 90 && d.week_completed >= 20);
      } else if (perfFilter === 'attention') {
        filtered = filtered.filter(d => d.success_rate < 70 || d.week_completed < 5);
      }
      
      // Apply sort
      const sortBy = document.getElementById('sortBy').value;
      filtered.sort((a, b) => {
        switch(sortBy) {
          case 'deliveries-desc': return (b.total_completed || 0) - (a.total_completed || 0);
          case 'deliveries-asc': return (a.total_completed || 0) - (b.total_completed || 0);
          case 'revenue-desc': return (b.total_revenue || 0) - (a.total_revenue || 0);
          case 'revenue-asc': return (a.total_revenue || 0) - (b.total_revenue || 0);
          case 'rating-desc': return (b.avg_rating || 0) - (a.avg_rating || 0);
          case 'rating-asc': return (a.avg_rating || 0) - (b.avg_rating || 0);
          case 'success-desc': return (b.success_rate || 0) - (a.success_rate || 0);
          case 'success-asc': return (a.success_rate || 0) - (b.success_rate || 0);
          case 'active-recent': 
            return new Date(b.last_active || 0) - new Date(a.last_active || 0);
          case 'active-oldest': 
            return new Date(a.last_active || 0) - new Date(b.last_active || 0);
          default: return 0;
        }
      });
      
      renderDriverCards(filtered);
    }

    function renderDriverCards(drivers) {
      const grid = document.getElementById('drivers-grid');
      
      if (drivers.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12">No drivers found matching filters</div>';
        return;
      }
      
      grid.innerHTML = drivers.map(driver => {
        const name = \`\${driver.first_name || ''} \${driver.last_name || ''}\`.trim() || 'Unknown Driver';
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        const onlineStatus = driver.is_online ? 
          '<span class="flex items-center gap-1 text-xs text-green-400"><span class="w-2 h-2 bg-green-500 rounded-full"></span>Online</span>' :
          '<span class="flex items-center gap-1 text-xs text-slate-500"><span class="w-2 h-2 bg-slate-500 rounded-full"></span>Offline</span>';
        
        const successRate = driver.success_rate || 100;
        const weekCompleted = driver.week_completed || 0;
        
        let performanceClass = 'performance-average';
        let performanceBadge = '<span class="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Average</span>';
        
        if (successRate >= 90 && weekCompleted >= 20) {
          performanceClass = 'performance-high';
          performanceBadge = '<span class="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">High Performer</span>';
        } else if (successRate < 70 || weekCompleted < 5) {
          performanceClass = 'performance-low';
          performanceBadge = '<span class="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">Needs Attention</span>';
        }
        
        const rating = driver.avg_rating || 0;
        const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
        
        const lastActive = driver.last_active ? new Date(driver.last_active).toLocaleString() : 'Never';
        
        return \`
          <div class="driver-card bg-slate-800 rounded-xl p-6 border-2 \${performanceClass} shadow-lg">
            <!-- Header -->
            <div class="flex items-start gap-4 mb-4">
              <div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                \${initials}
              </div>
              <div class="flex-1">
                <h3 class="text-lg font-bold text-slate-100">\${name}</h3>
                <p class="text-xs text-slate-400">\${driver.email || 'No email'}</p>
                <div class="flex items-center gap-3 mt-1">
                  \${onlineStatus}
                  \${performanceBadge}
                </div>
              </div>
            </div>
            
            <!-- Metrics Grid -->
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div class="text-xs text-slate-400 mb-1">Rating</div>
                <div class="text-yellow-400 text-lg">\${stars}</div>
                <div class="text-xs text-slate-500">\${rating.toFixed(1)}/5.0</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div class="text-xs text-slate-400 mb-1">Total Deliveries</div>
                <div class="text-2xl font-bold text-green-400">\${driver.total_completed || 0}</div>
                <div class="text-xs text-slate-500">Past week: \${weekCompleted}</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div class="text-xs text-slate-400 mb-1">Success Rate</div>
                <div class="text-2xl font-bold text-blue-400">\${successRate.toFixed(1)}%</div>
                <div class="text-xs text-slate-500">\${driver.total_failed || 0} failed</div>
              </div>
              
              <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div class="text-xs text-slate-400 mb-1">Revenue</div>
                <div class="text-2xl font-bold text-emerald-400">$\${(driver.total_revenue || 0).toFixed(2)}</div>
                <div class="text-xs text-slate-500">All-time</div>
              </div>
            </div>
            
            <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700 mb-4">
              <div class="text-xs text-slate-400 mb-1">Last Active</div>
              <div class="text-sm text-slate-300">\${lastActive}</div>
            </div>
            
            <!-- Performance Chart -->
            <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
              <div class="text-xs text-slate-400 mb-2">30-Day Performance</div>
              <canvas id="chart-\${driver.id}" class="w-full" height="120"></canvas>
            </div>
          </div>
        \`;
      }).join('');
      
      // Render charts for each driver
      lucide.createIcons();
      drivers.forEach(driver => {
        loadDriverTimeline(driver.id);
      });
    }

    async function loadDriverTimeline(driverId) {
      try {
        const res = await fetch(\`/api/driver-timeline/\${driverId}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: \`SELECT 
              DATE(delivered_at) as delivery_date,
              COUNT(*) as deliveries_count
            FROM shipments
            WHERE driver_id = \$1 
              AND status = 'DELIVERED'
              AND delivered_at > NOW() - INTERVAL '30 days'
            GROUP BY DATE(delivered_at)
            ORDER BY delivery_date ASC\`,
            params: [driverId]
          })
        });
        
        const data = await res.json();
        const timelineData = data.rows || [];
        
        renderChart(driverId, timelineData);
        
      } catch (e) {
        console.error('Timeline error for driver', driverId, e);
      }
    }

    function renderChart(driverId, timelineData) {
      const canvas = document.getElementById(\`chart-\${driverId}\`);
      if (!canvas) return;
      
      // Destroy existing chart if present
      if (charts[driverId]) {
        charts[driverId].destroy();
      }
      
      // Prepare data - fill in missing days
      const labels = [];
      const data = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        const dayData = timelineData.find(d => d.delivery_date && d.delivery_date.startsWith(dateStr));
        data.push(dayData ? parseInt(dayData.deliveries_count) : 0);
      }
      
      const ctx = canvas.getContext('2d');
      charts[driverId] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Deliveries',
            data: data,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 2,
            pointHoverRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#e2e8f0',
              bodyColor: '#cbd5e1',
              borderColor: '#334155',
              borderWidth: 1
            }
          },
          scales: {
            x: {
              ticks: { 
                color: '#64748b',
                maxRotation: 45,
                minRotation: 45,
                font: { size: 9 }
              },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { 
                color: '#64748b',
                stepSize: 1,
                font: { size: 10 }
              },
              grid: { color: '#334155' }
            }
          }
        }
      });
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

    // Init
    refreshData();
    setInterval(refreshData, 60000); // Poll every 60s
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
