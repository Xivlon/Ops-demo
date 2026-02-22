import type { Pool } from '@neondatabase/serverless';
import type { Driver, DriverStats } from '../types';
import { BaseRepository } from './base';

export class DriverRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: string): Promise<Driver | null> {
    const sql = `SELECT * FROM driver_profiles WHERE id = $1`;
    return this.queryOne<Driver>(sql, [id]);
  }

  async listOnline(): Promise<Driver[]> {
    const sql = `
      SELECT id, email, first_name, last_name, is_online, phone
      FROM driver_profiles 
      WHERE is_online = true
      ORDER BY first_name ASC
    `;
    return this.query<Driver>(sql);
  }

  async listAll(): Promise<Driver[]> {
    const sql = `
      SELECT * FROM driver_profiles
      ORDER BY first_name, last_name
    `;
    return this.query<Driver>(sql);
  }

  async countOnline(): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM driver_profiles WHERE is_online = true`;
    const result = await this.query<{ count: string }>(sql);
    return parseInt(result[0]?.count || '0', 10);
  }

  async countTotal(): Promise<number> {
    const sql = `SELECT COUNT(*) as count FROM driver_profiles`;
    const result = await this.query<{ count: string }>(sql);
    return parseInt(result[0]?.count || '0', 10);
  }

  // Live driver stats query
  async getLiveStats(): Promise<DriverStats[]> {
    const sql = `
      SELECT 
        d.id,
        d.email,
        d.first_name,
        d.last_name,
        d.is_online,
        d.phone,
        d.account_created_at,
        d.rating as avg_rating,
        
        COUNT(s.id) as total_assigned,
        
        COUNT(*) FILTER (WHERE s.status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE s.status = 'ASSIGNED') as assigned_count,
        COUNT(*) FILTER (WHERE s.status = 'PICKED_UP') as in_transit_count,
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED') as total_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_count,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') as week_completed,
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') as month_completed,
        
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED'), 0) / 100.0 as total_revenue,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as success_rate

      FROM driver_profiles d
      LEFT JOIN shipments s ON s.driver_id = d.id
      GROUP BY d.id, d.email, d.first_name, d.last_name, d.is_online, d.phone, d.account_created_at, d.rating
      ORDER BY COUNT(*) FILTER (WHERE s.status = 'DELIVERED') DESC
    `;
    return this.query<DriverStats>(sql);
  }
}
