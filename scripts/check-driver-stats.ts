import { Pool } from '@neondatabase/serverless';

// Check what's in the driver_stats table
async function checkDriverStats() {
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL 
  });
  
  try {
    // Check if table exists and has data
    const countResult = await pool.query('SELECT COUNT(*) as count FROM driver_stats');
    console.log('Total rows in driver_stats:', countResult.rows[0].count);
    
    // Check column names
    const columnsResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'driver_stats'
      ORDER BY ordinal_position
    `);
    console.log('\nColumns:');
    columnsResult.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Sample a few records
    const sampleResult = await pool.query(`
      SELECT 
        id, 
        first_name, 
        last_name, 
        is_online,
        total_completed,
        total_revenue,
        stats_updated_at
      FROM driver_stats 
      LIMIT 3
    `);
    console.log('\nSample records:');
    console.log(JSON.stringify(sampleResult.rows, null, 2));
    
    // Check for recent updates (last hour)
    const recentResult = await pool.query(`
      SELECT COUNT(*) as recent_updates
      FROM driver_stats
      WHERE stats_updated_at > NOW() - INTERVAL '1 hour'
    `);
    console.log('\nRecords updated in last hour:', recentResult.rows[0].recent_updates);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkDriverStats();
