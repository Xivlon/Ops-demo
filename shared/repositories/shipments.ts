import type { Pool } from '@neondatabase/serverless';
import type { Shipment, ShipmentStatus, ListShipmentsParams, DashboardStats } from '../types';
import { BaseRepository } from './base';
import { calculatePickupUrgency } from '../utils/urgency';

export class ShipmentRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: string): Promise<Shipment | null> {
    const sql = `
      SELECT s.*, CONCAT(d.first_name, ' ', d.last_name) as driver_name
      FROM shipments s
      LEFT JOIN driver_profiles d ON s.driver_id = d.id
      WHERE s.id = $1
    `;
    return this.queryOne<Shipment>(sql, [id]);
  }

  // Validate and sanitize days parameter
  private sanitizeDays(days: number): number {
    return Math.max(1, Math.min(365, Math.floor(days)));
  }

  // Validate and sanitize limit parameter  
  private sanitizeLimit(limit: number): number {
    return Math.max(1, Math.min(1000, Math.floor(limit)));
  }

  async list(params: ListShipmentsParams = {}): Promise<Shipment[]> {
    const { status } = params;
    const limit = this.sanitizeLimit(params.limit ?? 100);
    const days = this.sanitizeDays(params.days ?? 30);
    
    // Use parameterized interval to prevent SQL injection
    let sql = `
      SELECT s.*, CONCAT(d.first_name, ' ', d.last_name) as driver_name
      FROM shipments s
      LEFT JOIN driver_profiles d ON s.driver_id = d.id
      WHERE s.created_at > NOW() - ($1 || ' days')::INTERVAL
    `;
    
    const queryParams: (string | number)[] = [days.toString()];
    let paramIndex = 2;

    if (status) {
      sql += ` AND s.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Sort by pickup time urgency (soonest first), then by creation date
    sql += ` ORDER BY s.pickup_at ASC NULLS LAST, s.created_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limit);

    const rows = await this.query<Shipment>(sql, queryParams);
    
    // Calculate urgency for each shipment (using both pickup and dropoff times)
    return rows.map(row => ({
      ...row,
      urgency: calculatePickupUrgency(row.pickup_at, row.dropoff_by)
    }));
  }

  async assignDriver(shipmentId: string, driverId: string): Promise<boolean> {
    const sql = `
      UPDATE shipments 
      SET status = 'ASSIGNED', 
          driver_id = $1, 
          claimed_at = NOW() 
      WHERE id = $2 
        AND status = 'PENDING'
      RETURNING id
    `;
    const result = await this.query<{ id: string }>(sql, [driverId, shipmentId]);
    return result.length > 0;
  }

  async updateStatus(id: string, status: ShipmentStatus): Promise<boolean> {
    const sql = `
      UPDATE shipments 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `;
    const result = await this.query<{ id: string }>(sql, [status, id]);
    return result.length > 0;
  }

  async getDashboardStats(days = 30): Promise<DashboardStats> {
    try {
      const sanitizedDays = this.sanitizeDays(days);
      const sql = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
          COUNT(*) FILTER (WHERE status = 'ASSIGNED') as assigned,
          COUNT(*) FILTER (WHERE status = 'IN_TRANSIT') as picked_up,
          COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
          COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled,
          COALESCE(SUM(price_cents) FILTER (WHERE status = 'DELIVERED'), 0) / 100.0 as total_revenue,
          (SELECT COUNT(*) FROM driver_profiles WHERE is_online = true) as online_drivers,
          (SELECT COUNT(*) FROM driver_profiles) as total_drivers
        FROM shipments 
        WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
      `;
      return this.queryOne<DashboardStats>(sql, [sanitizedDays.toString()]) as Promise<DashboardStats>;
    } catch (error) {
      console.error('Dashboard stats query failed:', error);
      throw error;
    }
  }

  async countByStatus(status: ShipmentStatus, days = 30): Promise<number> {
    const sanitizedDays = this.sanitizeDays(days);
    const sql = `
      SELECT COUNT(*) as count
      FROM shipments
      WHERE status = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
    `;
    const result = await this.query<{ count: string }>(sql, [status, sanitizedDays.toString()]);
    return parseInt(result[0]?.count || '0', 10);
  }

  async cancel(shipmentId: string): Promise<boolean> {
    const sql = `
      UPDATE shipments 
      SET status = 'CANCELLED', 
          bknd = true,
          updated_at = NOW()
      WHERE id = $1 
        AND status NOT IN ('DELIVERED', 'CANCELLED')
      RETURNING id
    `;
    const result = await this.query<{ id: string }>(sql, [shipmentId]);
    return result.length > 0;
  }
}
