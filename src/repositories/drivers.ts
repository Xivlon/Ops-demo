import type { Pool } from '@neondatabase/serverless';
import type { Driver, DriverStats } from '../types';
import { BaseRepository } from './base';

export class DriverRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: string): Promise<Driver | null> {
    const sql = `
      SELECT * FROM driver_profiles
      WHERE id = $1 AND user_type = 'driver'
    `;
    return this.queryOne<Driver>(sql, [id]);
  }

  async listOnline(): Promise<Driver[]> {
    const sql = `
      SELECT id, email, CONCAT(first_name, ' ', last_name) as name, is_online
      FROM driver_profiles 
      WHERE user_type = 'driver' 
      ORDER BY is_online DESC, first_name ASC
    `;
    return this.query<Driver>(sql);
  }

  async listAll(): Promise<Driver[]> {
    const sql = `
      SELECT * FROM driver_profiles
      WHERE user_type = 'driver'
      ORDER BY first_name, last_name
    `;
    return this.query<Driver>(sql);
  }

  async countOnline(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM driver_profiles 
      WHERE is_online = true AND user_type = 'driver'
    `;
    const result = await this.query<{ count: string }>(sql);
    return parseInt(result[0]?.count || '0', 10);
  }

  async countTotal(): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM driver_profiles 
      WHERE user_type = 'driver'
    `;
    const result = await this.query<{ count: string }>(sql);
    return parseInt(result[0]?.count || '0', 10);
  }

  // Driver Stats methods
  async getLiveStats(): Promise<DriverStats[]> {
    const sql = `
      SELECT 
        dp.id,
        dp.first_name,
        dp.last_name,
        dp.email,
        dp.is_online,
        dp.account_created_at as driver_joined,
        
        COUNT(s.id) as total_assigned,
        
        COUNT(*) FILTER (WHERE s.status = 'PENDING') as pending_count,
        COUNT(*) FILTER (WHERE s.status = 'ASSIGNED') as assigned_count,
        COUNT(*) FILTER (WHERE s.status = 'PICKED_UP') as in_transit_count,
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED') as total_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as cancelled_count,
        0 as failed_count,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED') as total_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') as week_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '7 days') as week_failed,
        
        COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') as month_completed,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '30 days') as month_failed,
        
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED'), 0) / 100.0 as total_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days'), 0) / 100.0 as week_revenue,
        COALESCE(SUM(s.price_cents) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days'), 0) / 100.0 as month_revenue,
        
        MAX(COALESCE(GREATEST(s.delivered_at, dp.account_updated_at), dp.account_updated_at)) as last_active,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED')) > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED'))::float * 100)
          ELSE NULL
        END as cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND s.updated_at > NOW() - INTERVAL '7 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '7 days')::float * 100)
          ELSE NULL
        END as week_cancel_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'DELIVERED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_success_rate,
        
        CASE 
          WHEN COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days') > 0
          THEN (COUNT(*) FILTER (WHERE s.status = 'CANCELLED' AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float / 
                COUNT(*) FILTER (WHERE s.status IN ('DELIVERED', 'CANCELLED') AND COALESCE(s.delivered_at, s.updated_at) > NOW() - INTERVAL '30 days')::float * 100)
          ELSE NULL
        END as month_cancel_rate,
        
        0 as avg_rating,
        0 as rating_count,
        NOW() as stats_updated_at

      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      WHERE dp.user_type = 'driver'
      GROUP BY dp.id, dp.first_name, dp.last_name, dp.email, dp.is_online, dp.account_created_at
      ORDER BY COUNT(*) FILTER (WHERE s.status = 'DELIVERED') DESC
    `;
    return this.query<DriverStats>(sql);
  }

}
