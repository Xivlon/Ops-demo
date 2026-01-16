export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
          'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization'
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
    
    // Use ONLY the connection string for API key
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

    // Connect to Neon DB using REST API
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

// UPDATED: Use Neon's REST API (Supabase-compatible)
async function executeNeonQuery(connectionString, query, params) {
  try {
    console.log('Starting Neon REST API query...');
    
    // Parse connection string to get API key
    const url = new URL(connectionString);
    const apiKey = url.password; // This is your Neon API key
    
    if (!apiKey) {
      throw new Error('No API key found in connection string');
    }
    
    // Use the REST API endpoint you provided
    const restApiUrl = "https://ep-proud-cake-a4m2vdkf.apirest.us-east-1.aws.neon.tech/neondb/rest/v1";
    
    console.log('Using REST API endpoint:', restApiUrl);
    console.log('Query type:', query.trim().split(' ')[0]);
    
    // Check if it's a SELECT query
    if (query.trim().toUpperCase().startsWith('SELECT')) {
      return await executeSelectQuery(restApiUrl, apiKey, query, params);
    } 
    // Check if it's an UPDATE query
    else if (query.trim().toUpperCase().startsWith('UPDATE')) {
      return await executeUpdateQuery(restApiUrl, apiKey, query, params);
    }
    else {
      throw new Error('Only SELECT and UPDATE queries are supported');
    }
    
  } catch (error) {
    console.error('REST API query failed:', error);
    throw error;
  }
}

// Execute SELECT queries using REST API
async function executeSelectQuery(restApiUrl, apiKey, query, params) {
  try {
    // For REST API, we need to use /rpc endpoint for custom queries
    const rpcEndpoint = `${restApiUrl}/rpc/execute_sql`;
    
    console.log('Calling RPC endpoint for SELECT query');
    
    const response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        query: query,
        params: params || []
      })
    });
    
    console.log('RPC response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('RPC error:', errorText);
      throw new Error(`REST API error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('RPC result:', result);
    
    // The REST API might return data in a different format
    // Try to extract rows from the response
    let rows = [];
    if (Array.isArray(result)) {
      rows = result;
    } else if (result.rows) {
      rows = result.rows;
    } else if (result.data) {
      rows = result.data;
    }
    
    return {
      rows: rows,
      rowCount: rows.length
    };
    
  } catch (error) {
    console.error('SELECT query failed:', error);
    // Fallback to direct table query if RPC doesn't work
    return await tryDirectTableQuery(restApiUrl, apiKey, query, params);
  }
}

// Try direct table query for simple SELECTs
async function tryDirectTableQuery(restApiUrl, apiKey, query, params) {
  try {
    console.log('Trying direct table query...');
    
    // Parse the query to extract table name and columns
    // This is a simplified parser for basic SELECT queries
    const queryUpper = query.toUpperCase();
    const fromIndex = queryUpper.indexOf('FROM');
    const whereIndex = queryUpper.indexOf('WHERE');
    
    if (fromIndex === -1) {
      throw new Error('Could not parse query');
    }
    
    let tablePart = query.substring(fromIndex + 4, whereIndex !== -1 ? whereIndex : query.length);
    const tableName = tablePart.trim().split(' ')[0].replace(/"/g, '');
    
    console.log('Extracted table name:', tableName);
    
    // Build REST API URL for the table
    const tableEndpoint = `${restApiUrl}/${tableName}`;
    
    // Add query parameters for filtering
    const url = new URL(tableEndpoint);
    
    // Simple WHERE clause parsing (basic support)
    if (whereIndex !== -1) {
      const whereClause = query.substring(whereIndex + 5).trim();
      // Very basic parsing - for production you'd want a proper SQL parser
      const conditions = whereClause.split('AND').map(c => c.trim());
      
      conditions.forEach(condition => {
        const [column, ...valueParts] = condition.split('=').map(p => p.trim());
        if (column && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/'/g, '');
          url.searchParams.append(column, `eq.${value}`);
        }
      });
    }
    
    // Add select parameter for columns
    const selectIndex = queryUpper.indexOf('SELECT');
    const selectPart = query.substring(selectIndex + 6, fromIndex);
    const columns = selectPart.split(',').map(c => c.trim().split(' ')[0].replace(/"/g, ''));
    
    if (columns.length > 0 && columns[0] !== '*') {
      url.searchParams.append('select', columns.join(','));
    }
    
    console.log('Direct table URL:', url.toString());
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Direct table query error: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    return {
      rows: result,
      rowCount: result.length
    };
    
  } catch (error) {
    console.error('Direct table query also failed:', error);
    throw new Error(`All query methods failed: ${error.message}`);
  }
}

// Execute UPDATE queries
async function executeUpdateQuery(restApiUrl, apiKey, query, params) {
  try {
    console.log('Executing UPDATE query via REST API...');
    
    // Parse UPDATE query
    const queryUpper = query.toUpperCase();
    const setIndex = queryUpper.indexOf('SET');
    const whereIndex = queryUpper.indexOf('WHERE');
    
    if (setIndex === -1) {
      throw new Error('Invalid UPDATE query');
    }
    
    // Extract table name
    const tableName = query.substring(6, setIndex).trim().replace(/"/g, '');
    
    // Extract SET values
    const setClause = query.substring(setIndex + 3, whereIndex !== -1 ? whereIndex : query.length);
    const setPairs = setClause.split(',').map(pair => {
      const [column, value] = pair.split('=').map(p => p.trim());
      return { column: column.replace(/"/g, ''), value: value.replace(/'/g, '') };
    });
    
    // Build update data
    const updateData = {};
    setPairs.forEach(pair => {
      updateData[pair.column] = pair.value;
    });
    
    // Build URL with WHERE conditions
    const endpoint = `${restApiUrl}/${tableName}`;
    const url = new URL(endpoint);
    
    if (whereIndex !== -1) {
      const whereClause = query.substring(whereIndex + 5).trim();
      const conditions = whereClause.split('AND').map(c => c.trim());
      
      conditions.forEach(condition => {
        const [column, ...valueParts] = condition.split('=').map(p => p.trim());
        if (column && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/'/g, '');
          url.searchParams.append(column, `eq.${value}`);
        }
      });
    }
    
    console.log('UPDATE URL:', url.toString());
    console.log('UPDATE data:', updateData);
    
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updateData)
    });
    
    console.log('UPDATE response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('UPDATE error:', errorText);
      throw new Error(`UPDATE failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    return {
      rows: result,
      rowCount: result.length
    };
    
  } catch (error) {
    console.error('UPDATE query failed:', error);
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
    
    // Test with a simple query using REST API
    const restApiUrl = "https://ep-proud-cake-a4m2vdkf.apirest.us-east-1.aws.neon.tech/neondb/rest/v1";
    const url = new URL(connectionString);
    const apiKey = url.password;
    
    if (!apiKey) {
      throw new Error('No API key found in connection string');
    }
    
    // Test 1: Try to query shipments table directly
    console.log('Testing REST API connection...');
    
    const testUrl = `${restApiUrl}/shipments?select=id,status&limit=1`;
    
    const response = await fetch(testUrl, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Test response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Test error:', errorText);
      throw new Error(`REST API test failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    return new Response(JSON.stringify({
      success: true,
      data: result,
      connectionInfo: {
        restApiUrl: restApiUrl,
        hasApiKey: true,
        apiKeyLength: apiKey.length,
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
  // ... [KEEP YOUR EXISTING HTML CODE EXACTLY AS IS]
  // The HTML remains unchanged
