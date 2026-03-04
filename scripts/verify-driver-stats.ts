import { Pool } from '@neondatabase/serverless';

// Compare driver_stats with actual shipment data
async function verifyStats() {
  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL 
  });
  
  try {
    // Get a sample driver's stats from driver_stats table
    console.log('=== DRIVER_STATS TABLE ===');
    const statsResult = await pool.query(`
      SELECT 
        ds.id,
        ds.first_name,
        ds.last_name,
        ds.total_assigned,
        ds.total_completed,
        ds.cancelled_count,
        ds.total_revenue,
        ds.month_completed,
        ds.week_completed,
        ds.stats_updated_at
      FROM driver_stats ds
      LIMIT 3
    `);
    console.log(JSON.stringify(statsResult.rows, null, 2));
    
    // Now calculate from actual shipments for comparison
    console.log('\n=== ACTUAL SHIPMENT COUNTS ===');
    const actualResult = await pool.query(`
      SELECT 
        dp.id,
        dp.first_name,
        dp.last_name,
        COUNT(DISTINCT s.id) as total_assigned,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' THEN s.id END) as total_completed,
        COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' THEN s.id END) as cancelled_count,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' THEN s.price_cents ELSE 0 END), 0) / 100.0 as total_revenue,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.id END) as month_completed,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.id END) as week_completed
      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      WHERE dp.id IN (SELECT id FROM driver_stats LIMIT 3)
      GROUP BY dp.id, dp.first_name, dp.last_name
    `);
    console.log(JSON.stringify(actualResult.rows, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

verifyStats();
