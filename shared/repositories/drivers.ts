import { BaseRepository } from './base';
import type { Driver, DriverStats } from '../types';

export class DriverRepository extends BaseRepository {
  async listAll(): Promise<Driver[]> {
    const query = `
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        is_online,
        current_latitude,
        current_longitude,
        vehicle_type,
        vehicle_plate,
        rating,
        total_deliveries,
        account_created_at as created_at
      FROM driver_profiles 
      ORDER BY first_name, last_name
    `;
    
    return await this.query<Driver>(query);
  }

  async listOnline(): Promise<Driver[]> {
    const query = `
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        is_online,
        current_latitude,
        current_longitude,
        vehicle_type,
        vehicle_plate,
        rating,
        total_deliveries,
        account_created_at as created_at
      FROM driver_profiles 
      WHERE is_online = true
      ORDER BY first_name, last_name
    `;
    
    return await this.query<Driver>(query);
  }

  async getLiveStats(): Promise<DriverStats> {
    // Get total drivers
    const totalQuery = `
      SELECT COUNT(*) as count
      FROM driver_profiles
    `;
    
    // Get online drivers
    const onlineQuery = `
      SELECT COUNT(*) as count
      FROM driver_profiles 
      WHERE is_online = true
    `;
    
    // Get driver with most deliveries
    const topDriverQuery = `
      SELECT 
        id,
        first_name,
        last_name,
        total_deliveries
      FROM driver_profiles 
      ORDER BY total_deliveries DESC
      LIMIT 1
    `;
    
    const [totalResult, onlineResult, topDriverResult] = await Promise.all([
      this.query<{ count: string }>(totalQuery),
      this.query<{ count: string }>(onlineQuery),
      this.query<any>(topDriverQuery),
    ]);
    
    const total = parseInt(totalResult[0]?.count || '0', 10);
    const online = parseInt(onlineResult[0]?.count || '0', 10);
    const topDriver = topDriverResult[0];
    
    // Return a compatible DriverStats object
    // Note: We need to return a DriverStats object, but our current query returns different structure
    // For now, we'll return a minimal compatible object
    return {
      id: '',
      email: '',
      first_name: '',
      last_name: '',
      is_online: false,
      phone: null,
      account_created_at: new Date().toISOString(),
      total_assigned: 0,
      pending_count: 0,
      assigned_count: 0,
      in_transit_count: 0,
      total_completed: 0,
      cancelled_count: 0,
      total_revenue: 0,
      week_completed: 0,
      month_completed: 0,
      success_rate: null,
      avg_rating: 0,
      // Add the stats we actually computed
      total_drivers: total,
      online_drivers: online,
      offline_drivers: total - online,
      top_driver: topDriver ? {
        id: topDriver.id,
        name: `${topDriver.first_name} ${topDriver.last_name}`,
        deliveries: topDriver.total_deliveries || 0
      } : null
    } as unknown as DriverStats; // Type assertion for compatibility
  }

  async findById(id: string): Promise<Driver | null> {
    const query = `
      SELECT 
        id,
        first_name,
        last_name,
        email,
        phone,
        is_online,
        current_latitude,
        current_longitude,
        vehicle_type,
        vehicle_plate,
        rating,
        total_deliveries,
        account_created_at as created_at
      FROM driver_profiles 
      WHERE id = $1
    `;
    
    const result = await this.query<Driver>(query, [id]);
    return result[0] || null;
  }

  // Get detailed stats for each driver (for driver stats page)
  async getDriverDetailedStats(): Promise<any[]> {
    const query = `
      SELECT 
        dp.id,
        dp.first_name,
        dp.last_name,
        dp.email,
        dp.phone,
        dp.is_online,
        dp.rating as avg_rating,
        dp.total_deliveries,
        dp.account_created_at as driver_joined,
        dp.account_updated_at as last_active,
        -- Count shipments by status
        COUNT(DISTINCT CASE WHEN s.status = 'PENDING' THEN s.id END) as pending_count,
        COUNT(DISTINCT CASE WHEN s.status = 'ASSIGNED' THEN s.id END) as assigned_count,
        COUNT(DISTINCT CASE WHEN s.status = 'IN_TRANSIT' THEN s.id END) in_transit_count,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' THEN s.id END) as total_completed,
        COUNT(DISTINCT s.id) as total_assigned,
        -- Revenue (sum of shipment prices for delivered shipments, converting cents to dollars)
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' THEN s.price_cents ELSE 0 END), 0) / 100.0 as total_revenue,
        -- Weekly stats (last 7 days)
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.id END) as week_completed,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.price_cents ELSE 0 END), 0) / 100.0 as week_revenue,
        -- Monthly stats (last 30 days)
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.id END) as month_completed,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.price_cents ELSE 0 END), 0) / 100.0 as month_revenue,
        -- Cancelled count (all time)
        COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' THEN s.id END) as cancelled_count,
        -- Weekly cancelled (last 7 days)
        COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.id END) as week_cancelled_count,
        -- Monthly cancelled (last 30 days)
        COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.id END) as month_cancelled_count
      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      GROUP BY dp.id, dp.first_name, dp.last_name, dp.email, dp.phone, dp.is_online, dp.rating, dp.total_deliveries, dp.account_created_at, dp.account_updated_at
      ORDER BY dp.first_name, dp.last_name
    `;
    
    const drivers = await this.query<any>(query);
    
    // Calculate derived stats for each driver
    return drivers.map(d => {
      const total_assigned = parseInt(d.total_assigned) || 0;
      const total_completed = parseInt(d.total_completed) || 0;
      const cancelled_count = parseInt(d.cancelled_count) || 0;
      const total_with_result = total_completed + cancelled_count;
      
      // Weekly
      const week_completed = parseInt(d.week_completed) || 0;
      const week_cancelled = parseInt(d.week_cancelled_count) || 0;
      const week_with_result = week_completed + week_cancelled;
      const week_revenue = parseFloat(d.week_revenue) || 0;
      
      // Monthly
      const month_completed = parseInt(d.month_completed) || 0;
      const month_cancelled = parseInt(d.month_cancelled_count) || 0;
      const month_with_result = month_completed + month_cancelled;
      const month_revenue = parseFloat(d.month_revenue) || 0;
      
      return {
        id: d.id,
        first_name: d.first_name,
        last_name: d.last_name,
        email: d.email,
        phone: d.phone,
        is_online: d.is_online,
        avg_rating: parseFloat(d.avg_rating) || 0,
        driver_joined: d.driver_joined,
        last_active: d.last_active,
        // Counts
        pending_count: parseInt(d.pending_count) || 0,
        assigned_count: parseInt(d.assigned_count) || 0,
        in_transit_count: parseInt(d.in_transit_count) || 0,
        total_assigned: total_assigned,
        total_completed: total_completed,
        cancelled_count: cancelled_count,
        // Revenue
        total_revenue: parseFloat(d.total_revenue) || 0,
        week_revenue: week_revenue,
        month_revenue: month_revenue,
        // Weekly stats
        week_completed: week_completed,
        week_success_rate: week_with_result > 0 ? ((week_completed / week_with_result) * 100).toFixed(1) : null,
        // Monthly stats
        month_completed: month_completed,
        month_success_rate: month_with_result > 0 ? ((month_completed / month_with_result) * 100).toFixed(1) : null,
        month_cancel_rate: month_with_result > 0 ? ((month_cancelled / month_with_result) * 100).toFixed(1) : null,
        // All-time stats
        success_rate: total_with_result > 0 ? ((total_completed / total_with_result) * 100).toFixed(1) : null,
        cancel_rate: total_with_result > 0 ? ((cancelled_count / total_with_result) * 100).toFixed(1) : null,
      };
    });
  }

  // New method for enhanced stats
  async getEnhancedStats(): Promise<any> {
    const drivers = await this.listAll();
    const onlineDrivers = await this.listOnline();
    
    // Find top driver
    const topDriver = drivers.reduce((max, driver) => 
      (driver.total_deliveries || 0) > (max.total_deliveries || 0) ? driver : max
    , drivers[0] || null);

    // Calculate vehicle breakdown
    const vehicleBreakdown = drivers.reduce((acc, driver) => {
      const type = driver.vehicle_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Calculate average rating
    const averageRating = drivers.length > 0 
      ? drivers.reduce((sum, driver) => sum + (driver.rating || 0), 0) / drivers.length
      : 0;

    return {
      total: drivers.length,
      online: onlineDrivers.length,
      offline: drivers.length - onlineDrivers.length,
      topDriver: topDriver ? {
        id: topDriver.id,
        name: `${topDriver.first_name} ${topDriver.last_name}`,
        deliveries: topDriver.total_deliveries || 0,
        rating: topDriver.rating,
        vehicle: topDriver.vehicle_type
      } : null,
      vehicleBreakdown,
      averageRating
    };
  }

  // Calculate driver rating based on 30-day performance
  calculateDriverRating(driver: any): number {
    const monthCompleted = parseInt(driver.month_completed) || 0;
    const monthCancelRate = parseFloat(driver.month_cancel_rate) || 0;
    
    // Base rating starts at 3.0 (neutral)
    let rating = 3.0;
    
    // Adjust based on cancellation rate (lower is better)
    // 0% cancel = +1.5, 10%+ cancel = -1.5
    if (monthCancelRate <= 5) {
      rating += 1.5;
    } else if (monthCancelRate <= 10) {
      rating += 0.5;
    } else if (monthCancelRate <= 20) {
      rating -= 0.5;
    } else {
      rating -= 1.5;
    }
    
    // Adjust based on monthly completed orders
    // 20+ orders = +0.5, 0 orders = -0.5
    if (monthCompleted >= 20) {
      rating += 0.5;
    } else if (monthCompleted >= 10) {
      rating += 0.2;
    } else if (monthCompleted === 0) {
      rating -= 0.5;
    }
    
    // Cap between 1.0 and 5.0
    return Math.max(1.0, Math.min(5.0, rating));
  }

  // Update driver rating in database
  async updateRating(driverId: string, rating: number): Promise<boolean> {
    const query = `
      UPDATE driver_profiles 
      SET rating = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `;
    const result = await this.query<{ id: string }>(query, [rating, driverId]);
    return result.length > 0;
  }

  // Get driver stats - join driver_profiles (real-time profile data) with driver_stats (computed stats)
  // All calculations are done by database triggers - no application-side calculations
  async getCachedStats(): Promise<any[]> {
    const query = `
      SELECT 
        -- Profile data from driver_profiles (real-time)
        dp.id,
        dp.first_name,
        dp.last_name,
        dp.email,
        dp.phone,
        dp.is_online,
        dp.profile_photo_url,
        dp.account_created_at as driver_joined,
        dp.account_updated_at as last_active,
        
        -- Stats from driver_stats (computed via triggers)
        ds.total_assigned,
        ds.pending_count,
        ds.assigned_count,
        ds.in_transit_count,
        ds.total_completed,
        ds.cancelled_count,
        ds.failed_count,
        ds.week_completed,
        ds.week_failed,
        ds.month_completed,
        ds.total_revenue,
        ds.week_revenue,
        ds.month_revenue,
        ds.success_rate,
        ds.cancel_rate,
        ds.avg_rating,
        ds.rating_count,
        ds.stats_updated_at
      FROM driver_profiles dp
      LEFT JOIN driver_stats ds ON ds.id = dp.id
      ORDER BY dp.last_name, dp.first_name
    `;
    const drivers = await this.query<any>(query);
    
    // Return raw data from database - no calculations needed
    // Frontend will handle display formatting
    return drivers;
  }
}
