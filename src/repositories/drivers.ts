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

  async getCachedStats(): Promise<DriverStats[]> {
    const sql = `SELECT * FROM driver_stats ORDER BY total_completed DESC`;
    return this.query<DriverStats>(sql);
  }

  async refreshStatsCache(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Create table if not exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS driver_stats (
          id UUID PRIMARY KEY,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          email VARCHAR(255),
          is_online BOOLEAN,
          driver_joined TIMESTAMP,
          total_assigned INTEGER DEFAULT 0,
          pending_count INTEGER DEFAULT 0,
          assigned_count INTEGER DEFAULT 0,
          in_transit_count INTEGER DEFAULT 0,
          total_completed INTEGER DEFAULT 0,
          cancelled_count INTEGER DEFAULT 0,
          failed_count INTEGER DEFAULT 0,
          total_failed INTEGER DEFAULT 0,
          week_completed INTEGER DEFAULT 0,
          week_failed INTEGER DEFAULT 0,
          month_completed INTEGER DEFAULT 0,
          month_failed INTEGER DEFAULT 0,
          total_revenue DECIMAL(10, 2) DEFAULT 0,
          week_revenue DECIMAL(10, 2) DEFAULT 0,
          month_revenue DECIMAL(10, 2) DEFAULT 0,
          last_active TIMESTAMP,
          success_rate DECIMAL(5, 2),
          cancel_rate DECIMAL(5, 2),
          week_success_rate DECIMAL(5, 2),
          week_cancel_rate DECIMAL(5, 2),
          month_success_rate DECIMAL(5, 2),
          month_cancel_rate DECIMAL(5, 2),
          avg_rating DECIMAL(3, 2) DEFAULT 0,
          rating_count INTEGER DEFAULT 0,
          stats_updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Truncate existing data
      await client.query('TRUNCATE TABLE driver_stats');

      // Insert fresh data
      await client.query(`
        INSERT INTO driver_stats (
          id, first_name, last_name, email, is_online, driver_joined,
          total_assigned, pending_count, assigned_count, in_transit_count, total_completed,
          cancelled_count, failed_count, total_failed, week_completed, week_failed,
          month_completed, month_failed, total_revenue, week_revenue, month_revenue,
          last_active, success_rate, cancel_rate,
          week_success_rate, week_cancel_rate, month_success_rate, month_cancel_rate,
          avg_rating, rating_count, stats_updated_at
        )
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
      `);

      const countResult = await client.query('SELECT COUNT(*) as count FROM driver_stats');
      const count = parseInt(countResult.rows[0].count, 10);
      
      await client.query('COMMIT');
      return count;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
