import type { Pool } from '@neondatabase/serverless';
import type { Shipment, ShipmentStatus, ListShipmentsParams, DashboardStats } from '../types';
import { BaseRepository } from './base';

export class ShipmentRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: string): Promise<Shipment | null> {
    const sql = `
      SELECT s.*, CONCAT(dp.first_name, ' ', dp.last_name) as driver_name
      FROM shipments s
      LEFT JOIN driver_profiles dp ON s.driver_id = dp.id
      WHERE s.id = $1
    `;
    return this.queryOne<Shipment>(sql, [id]);
  }

  async list(params: ListShipmentsParams = {}): Promise<Shipment[]> {
    const { status, limit = 100, days = 30 } = params;
    
    let sql = `
      SELECT s.*, CONCAT(dp.first_name, ' ', dp.last_name) as driver_name
      FROM shipments s
      LEFT JOIN driver_profiles dp ON s.driver_id = dp.id
      WHERE s.created_at > NOW() - INTERVAL '${days} days'
    `;
    
    const queryParams: (string | number)[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND s.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    sql += ` ORDER BY s.created_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limit);

    return this.query<Shipment>(sql, queryParams);
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
    const sql = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'ASSIGNED') as assigned,
        COUNT(*) FILTER (WHERE status = 'PICKED_UP') as picked_up,
        COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
        COALESCE(SUM(price_cents), 0) / 100.0 as total_revenue,
        (SELECT COUNT(*) FROM driver_profiles WHERE is_online = true AND user_type = 'driver') as online_drivers,
        (SELECT COUNT(*) FROM driver_profiles WHERE user_type = 'driver') as total_drivers
      FROM shipments 
      WHERE created_at > NOW() - INTERVAL '${days} days'
    `;
    return this.queryOne<DashboardStats>(sql) as Promise<DashboardStats>;
  }

  async countByStatus(status: ShipmentStatus, days = 30): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM shipments
      WHERE status = $1 AND created_at > NOW() - INTERVAL '${days} days'
    `;
    const result = await this.query<{ count: string }>(sql, [status]);
    return parseInt(result[0]?.count || '0', 10);
  }
}
