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
    if (path === "/" && url.searchParams.get("pin") !== adminPin) {
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

    // 3. Test endpoint
    if (path === "/test") {
      return await testConnection(env);
    }

    // 4. Serve the dashboard
    if (path === "/") {
      return serveDashboard();
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

// Function to serve the dashboard HTML (keep your existing HTML)
function serveDashboard() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LuggageLink Ops</title>
  <script src="https://cdn.tailwindcss.com"></script>
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
              <th class="px-6 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">
                Actions
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
    const BACKEND_URL = ""; // Same origin
    
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
                      (SELECT COUNT(*) FROM users WHERE is_online = true) as online_drivers,
                      (SELECT COUNT(*) FROM users) as total_drivers
                    FROM shipments
                    WHERE created_at > NOW() - INTERVAL '30 days'\`
                })
            });
            
            const data = await res.json();
            
            const makeCard = (label, val, color) => {
                return '<div class="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden group hover:border-' + color + '-500/50 transition-colors">' +
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
                makeCard('Active Drivers', (data.rows?.[0]?.online_drivers || 0) + '/' + (data.rows?.[0]?.total_drivers || 0), 'orange');

        } catch (e) { 
            console.warn("Stats error", e);
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
                      dp.user_id as id,
                      u.email,
                      CONCAT(u.first_name, ' ', u.last_name) as name,
                      dp.is_online
                    FROM driver_profiles dp
                    JOIN users u ON dp.user_id = u.id
                    WHERE u.user_type = 'driver'
                    ORDER BY dp.is_online DESC, u.first_name ASC\`
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
                      CONCAT(u.first_name, ' ', u.last_name) as customer_name,
                      CONCAT(dpu.first_name, ' ', dpu.last_name) as driver_name
                    FROM shipments s
                    JOIN users u ON s.customer_id = u.id
                    LEFT JOIN driver_profiles dp ON s.driver_id = dp.user_id
                    LEFT JOIN users dpu ON dp.user_id = dpu.id
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
                const dName = s.driver_name || 'ID: ' + dId.slice(0,5);
                driverHtml = 
                    '<div class="flex items-center gap-1.5 text-indigo-400">' +
                        '<i data-lucide="user" class="w-3 h-3"></i>' +
                        '<span class="font-mono text-xs font-bold">' + dName + '</span>' +
                    '</div>';
            } else {
                driverHtml = '<span class="text-slate-600 text-xs italic">Unassigned</span>';
            }

            // Proof Logic
            let proofs = [];
            const pickUrl = s.pickup_photo_url;
            const dropUrl = s.delivery_photo_url;
            
            if (pickUrl) proofs.push('<a href="' + pickUrl + '" target="_blank" class="p-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-white transition-colors" title="Pickup"><i data-lucide="camera" class="w-4 h-4"></i></a>');
            if (dropUrl) proofs.push('<a href="' + dropUrl + '" target="_blank" class="p-1 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:text-white transition-colors" title="Delivery"><i data-lucide="check-square" class="w-4 h-4"></i></a>');
            const proofHtml = proofs.length ? '<div class="flex gap-2 justify-end">' + proofs.join('') + '</div>' : '<span class="text-slate-700 text-xs">--</span>';

            // Date Formatting
            const d = new Date(s.created_at);
            const dateStr = d.toLocaleDateString([], {month:'short', day:'numeric'});
            const timeStr = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

            return \`
                <tr class="hover:bg-slate-800 transition-colors border-b border-slate-700/50 group">
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="font-mono text-xs text-slate-500 group-hover:text-slate-300 transition-colors">#\${s.id.slice(0,8)}</div>
                    </td>
                    
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="text-sm font-medium text-slate-300">\${dateStr}</div>
                        <div class="text-[10px] text-slate-500">\${timeStr}</div>
                    </td>

                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border \${badgeClass}">
                            \${s.status}
                        </span>
                    </td>

                    <td class="px-6 py-4 whitespace-nowrap">
                        \${driverHtml}
                    </td>

                    <td class="px-6 py-4 whitespace-nowrap text-xs text-slate-300">
                        <div class="flex items-center gap-2">
                            \${fmtLoc(s, 'pickup')}
                            <i data-lucide="arrow-right" class="w-3 h-3 text-slate-600"></i>
                            \${fmtLoc(s, 'dropoff')}
                        </div>
                    </td>

                    <td class="px-6 py-4 whitespace-nowrap text-right">
                        \${proofHtml}
                    </td>
                </tr>
            \`;
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
