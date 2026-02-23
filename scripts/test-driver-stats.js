#!/usr/bin/env node

/**
 * Test script to verify driver stats worker setup
 * Run this after starting both workers locally
 */

const mainWorkerUrl = 'http://localhost:8787';
const statsWorkerUrl = 'http://localhost:8788';

async function testEndpoint(url, endpoint, description) {
  console.log(`\nTesting ${description}:`);
  console.log(`  URL: ${url}${endpoint}`);
  
  try {
    const response = await fetch(`${url}${endpoint}`);
    const data = await response.json();
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Success: ${data.success}`);
    
    if (data.success) {
      console.log(`  Data source: ${data.meta?.source || 'unknown'}`);
      if (data.data) {
        if (Array.isArray(data.data)) {
          console.log(`  Items: ${data.data.length}`);
        } else if (typeof data.data === 'object') {
          console.log(`  Keys: ${Object.keys(data.data).join(', ')}`);
        }
      }
    } else {
      console.log(`  Error: ${data.error}`);
    }
    
    return { success: response.ok && data.success, data };
  } catch (error) {
    console.log(`  Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Testing Driver Stats Worker Setup\n');
  console.log('='.repeat(60));
  
  // Test main worker health
  await testEndpoint(mainWorkerUrl, '/health', 'Main Worker Health');
  
  // Test stats worker health (direct)
  await testEndpoint(statsWorkerUrl, '/health', 'Stats Worker Health (Direct)');
  
  // Test stats worker ping
  await testEndpoint(statsWorkerUrl, '/ping', 'Stats Worker Ping');
  
  // Test main worker proxy endpoints
  console.log('\n' + '='.repeat(60));
  console.log('Testing Main Worker Proxy Endpoints:');
  
  await testEndpoint(mainWorkerUrl, '/api/drivers/stats', 'Driver Stats (via Proxy)');
  await testEndpoint(mainWorkerUrl, '/api/drivers', 'Drivers List (via Proxy)');
  await testEndpoint(mainWorkerUrl, '/api/drivers/online', 'Online Drivers (via Proxy)');
  
  // Test stats worker directly
  console.log('\n' + '='.repeat(60));
  console.log('Testing Stats Worker Direct Endpoints:');
  
  await testEndpoint(statsWorkerUrl, '/api/drivers/stats/live', 'Driver Stats (Direct)');
  await testEndpoint(statsWorkerUrl, '/api/drivers', 'Drivers List (Direct)');
  await testEndpoint(statsWorkerUrl, '/api/drivers/online', 'Online Drivers (Direct)');
  await testEndpoint(statsWorkerUrl, '/api/drivers/stats/enhanced', 'Enhanced Stats (Direct)');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Tests completed!');
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/test-driver-stats.js [options]

Options:
  --main-url <url>    Main worker URL (default: http://localhost:8787)
  --stats-url <url>   Stats worker URL (default: http://localhost:8788)
  --help, -h         Show this help message
  `);
  process.exit(0);
}

// Parse custom URLs
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--main-url' && args[i + 1]) {
    mainWorkerUrl = args[i + 1];
    i++;
  } else if (args[i] === '--stats-url' && args[i + 1]) {
    statsWorkerUrl = args[i + 1];
    i++;
  }
}

// Run tests
runTests().catch(console.error);