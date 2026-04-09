import type { Pool } from '@neondatabase/serverless';
import { BaseRepository } from './base';

export interface RevenueReport {
  period: string;
  startDate: string;
  endDate: string;
  storageRevenue: number;
  transportRevenue: number;
  totalRevenue: number;
  storageOrders: number;
  transportOrders: number;
  totalOrders: number;
}

export interface DriverEarnings {
  driverId: string;
  driverName: string;
  email: string;
  storageEarnings: number;
  transportEarnings: number;
  totalEarnings: number;
  completedOrders: number;
}

export class ReportsRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  // Get revenue report for a date range
  async getRevenueReport(startDate: string, endDate: string): Promise<RevenueReport> {
    // Storage revenue (price_cents from storage orders where dropoff confirmed)
    const storageSql = `
      SELECT 
        COALESCE(SUM(price_cents), 0) / 100.0 as revenue,
        COUNT(*) as order_count
      FROM storage 
      WHERE created_at >= $1 
        AND created_at < $2
        AND status != 'PENDING_DROPOFF'
    `;
    
    // Transport revenue (price_cents from shipments - delivered)
    const transportSql = `
      SELECT 
        COALESCE(SUM(price_cents), 0) / 100.0 as revenue,
        COUNT(*) as order_count
      FROM shipments 
      WHERE created_at >= $1 
        AND created_at < $2
        AND status = 'DELIVERED'
    `;

    const [storageResult, transportResult] = await Promise.all([
      this.queryOne<{ revenue: string; order_count: string }>(storageSql, [startDate, endDate]),
      this.queryOne<{ revenue: string; order_count: string }>(transportSql, [startDate, endDate])
    ]);

    const storageRevenue = parseFloat(storageResult?.revenue || '0');
    const transportRevenue = parseFloat(transportResult?.revenue || '0');
    const storageOrders = parseInt(storageResult?.order_count || '0', 10);
    const transportOrders = parseInt(transportResult?.order_count || '0', 10);

    return {
      period: `${startDate} to ${endDate}`,
      startDate,
      endDate,
      storageRevenue,
      transportRevenue,
      totalRevenue: storageRevenue + transportRevenue,
      storageOrders,
      transportOrders,
      totalOrders: storageOrders + transportOrders
    };
  }

  // Get driver earnings for a date range
  async getDriverEarnings(startDate: string, endDate: string): Promise<DriverEarnings[]> {
    const sql = `
      SELECT 
        dp.id as driver_id,
        CONCAT(dp.first_name, ' ', dp.last_name) as driver_name,
        dp.email,
        COALESCE(storage_earnings.earnings, 0) as storage_earnings,
        COALESCE(transport_earnings.earnings, 0) as transport_earnings,
        COALESCE(storage_earnings.completed_orders, 0) + COALESCE(transport_earnings.completed_orders, 0) as completed_orders
      FROM driver_profiles dp
      LEFT JOIN (
        SELECT 
          pickup_driver_id as driver_id,
          COALESCE(SUM(price_cents), 0) / 100.0 as earnings,
          COUNT(*) as completed_orders
        FROM storage
        WHERE created_at >= $1 
          AND created_at < $2
          AND status IN ('PICKUP_CONFIRMED', 'DELIVERED')
        GROUP BY pickup_driver_id
      ) storage_earnings ON storage_earnings.driver_id = dp.id
      LEFT JOIN (
        SELECT 
          driver_id,
          COALESCE(SUM(price_cents), 0) / 100.0 as earnings,
          COUNT(*) as completed_orders
        FROM shipments
        WHERE created_at >= $1 
          AND created_at < $2
          AND status = 'DELIVERED'
        GROUP BY driver_id
      ) transport_earnings ON transport_earnings.driver_id = dp.id
      WHERE storage_earnings.earnings > 0 OR transport_earnings.earnings > 0
      ORDER BY (COALESCE(storage_earnings.earnings, 0) + COALESCE(transport_earnings.earnings, 0)) DESC
    `;

    const rows = await this.query<{
      driver_id: string;
      driver_name: string;
      email: string;
      storage_earnings: string;
      transport_earnings: string;
      completed_orders: string;
    }>(sql, [startDate, endDate]);

    return rows.map(row => ({
      driverId: row.driver_id,
      driverName: row.driver_name,
      email: row.email,
      storageEarnings: parseFloat(row.storage_earnings),
      transportEarnings: parseFloat(row.transport_earnings),
      totalEarnings: parseFloat(row.storage_earnings) + parseFloat(row.transport_earnings),
      completedOrders: parseInt(row.completed_orders, 10)
    }));
  }

  // Get weekly revenue breakdown
  async getWeeklyReport(): Promise<RevenueReport> {
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.getRevenueReport(startDate, endDate);
  }

  // Get monthly revenue breakdown
  async getMonthlyReport(): Promise<RevenueReport> {
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return this.getRevenueReport(startDate, endDate);
  }

  // Get quarterly revenue breakdown
  async getQuarterlyReport(): Promise<RevenueReport> {
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    return this.getRevenueReport(startDate, endDate);
  }

  // Get annual revenue breakdown
  async getAnnualReport(): Promise<RevenueReport> {
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    return this.getRevenueReport(startDate, endDate);
  }

  // Get detailed storage orders for export
  async getStorageOrdersForExport(startDate: string, endDate: string): Promise<any[]> {
    const sql = `
      SELECT 
        s.id,
        s.created_at,
        s.status,
        s.customer_name,
        s.customer_email,
        s.customer_phone,
        s.price_cents / 100.0 as price,
        s.storage_days,
        s.bag_count_large + s.bag_count_carryon + s.bag_count_backpack as total_bags,
        CONCAT(pd.first_name, ' ', pd.last_name) as pickup_driver,
        s.picked_up_at
      FROM storage s
      LEFT JOIN driver_profiles pd ON s.pickup_driver_id = pd.id
      WHERE s.created_at >= $1 
        AND s.created_at < $2
      ORDER BY s.created_at DESC
    `;
    return this.query(sql, [startDate, endDate]);
  }

  // Get detailed transport orders for export
  async getTransportOrdersForExport(startDate: string, endDate: string): Promise<any[]> {
    const sql = `
      SELECT 
        s.id,
        s.created_at,
        s.status,
        s.customer_name,
        s.customer_email,
        s.customer_phone,
        s.price_cents / 100.0 as price,
        s.origin_airport,
        s.destination_airport,
        CONCAT(d.first_name, ' ', d.last_name) as driver,
        s.delivered_at
      FROM shipments s
      LEFT JOIN driver_profiles d ON s.driver_id = d.id
      WHERE s.created_at >= $1 
        AND s.created_at < $2
      ORDER BY s.created_at DESC
    `;
    return this.query(sql, [startDate, endDate]);
  }
}
