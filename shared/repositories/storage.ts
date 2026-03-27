import type { Pool } from '@neondatabase/serverless';
import type { Storage, StorageStatus, ListStorageParams, StorageStats } from '../types';
import { BaseRepository } from './base';

export class StorageRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: number): Promise<Storage | null> {
    const sql = `
      SELECT s.*, 
        CONCAT(pd.first_name, ' ', pd.last_name) as pickup_driver_name,
        CONCAT(dd.first_name, ' ', dd.last_name) as delivery_driver_name
      FROM storage s
      LEFT JOIN driver_profiles pd ON s.pickup_driver_id = pd.id
      LEFT JOIN driver_profiles dd ON s.delivery_driver_id = dd.id
      WHERE s.id = $1
    `;
    return this.queryOne<Storage>(sql, [id]);
  }

  async list(params: ListStorageParams = {}): Promise<Storage[]> {
    const { status, limit = 100, days = 30 } = params;
    
    let sql = `
      SELECT s.*, 
        CONCAT(pd.first_name, ' ', pd.last_name) as pickup_driver_name,
        CONCAT(dd.first_name, ' ', dd.last_name) as delivery_driver_name
      FROM storage s
      LEFT JOIN driver_profiles pd ON s.pickup_driver_id = pd.id
      LEFT JOIN driver_profiles dd ON s.delivery_driver_id = dd.id
      WHERE s.created_at > NOW() - INTERVAL '${days} days'
    `;
    
    const queryParams: (string | number)[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND s.status = $${paramIndex}`;
      queryParams.push(status);
      paramIndex++;
    }

    // Sort by pickup time (soonest first), then by creation date
    sql += ` ORDER BY s.pickup_at ASC NULLS LAST, s.created_at DESC LIMIT $${paramIndex}`;
    queryParams.push(limit);

    return this.query<Storage>(sql, queryParams);
  }

  async assignPickupDriver(storageId: number, driverId: string): Promise<boolean> {
    // Use LOWER() to handle case-insensitive status matching
    // Allow assignment for pending, pending_pickup, picked_up statuses
    const sql = `
      UPDATE storage 
      SET pickup_driver_id = $1, 
          updated_at = NOW()
      WHERE id = $2 
        AND LOWER(status::text) IN ('pending', 'pending_pickup', 'picked_up', 'pickedup')
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async assignDeliveryDriver(storageId: number, driverId: string): Promise<boolean> {
    // Use LOWER() to handle case-insensitive status matching
    const sql = `
      UPDATE storage 
      SET delivery_driver_id = $1, 
          updated_at = NOW()
      WHERE id = $2 
        AND LOWER(status::text) IN ('in_storage', 'instorage', 'ready_for_delivery', 'readyfordelivery', 'ready')
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async updateStatus(id: number, status: StorageStatus | string): Promise<boolean> {
    // Map common frontend status values to possible database enum values
    const statusMap: Record<string, string[]> = {
      'pending': ['pending', 'PENDING', 'Pending', 'pending_pickup', 'PENDING_PICKUP'],
      'picked_up': ['picked_up', 'PICKED_UP', 'Picked_Up', 'pickedup', 'PICKEDUP'],
      'in_storage': ['in_storage', 'IN_STORAGE', 'In_Storage', 'instorage', 'INSTORAGE'],
      'ready_for_delivery': ['ready_for_delivery', 'READY_FOR_DELIVERY', 'Ready_For_Delivery', 'readyfordelivery', 'READY'],
      'delivered': ['delivered', 'DELIVERED', 'Delivered', 'completed', 'COMPLETED'],
      'cancelled': ['cancelled', 'CANCELLED', 'Cancelled', 'canceled', 'CANCELED']
    };
    
    const possibleValues = statusMap[status.toLowerCase()] || [status];
    
    // Try each possible value
    for (const value of possibleValues) {
      try {
        const sql = `
          UPDATE storage 
          SET status = $1::text::storage_status, 
              updated_at = NOW()
          WHERE id = $2
          RETURNING id
        `;
        const result = await this.query<{ id: number }>(sql, [value, id]);
        if (result.length > 0) return true;
      } catch (e) {
        // Try next variant
        continue;
      }
    }
    
    // If all fail, try pg_enum lookup
    try {
      const findEnumSql = `
        UPDATE storage 
        SET status = (
          SELECT enumlabel::storage_status 
          FROM pg_enum 
          WHERE enumtypid = 'storage_status'::regtype 
          AND LOWER(enumlabel) = LOWER($1)
          LIMIT 1
        ),
        updated_at = NOW()
        WHERE id = $2
        RETURNING id
      `;
      const result = await this.query<{ id: number }>(findEnumSql, [status, id]);
      return result.length > 0;
    } catch (e) {
      return false;
    }
  }

  async getStorageStats(days = 30): Promise<StorageStats> {
    try {
      // First, get status counts using GROUP BY to avoid hardcoding enum values
      const statusCountsSql = `
        SELECT 
          status,
          COUNT(*) as count
        FROM storage 
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY status
      `;
      const statusRows = await this.query<{ status: string; count: string }>(statusCountsSql);
      
      // Initialize all stats to 0
      const stats: StorageStats = {
        pending: 0,
        picked_up: 0,
        in_storage: 0,
        ready_for_delivery: 0,
        delivered: 0,
        cancelled: 0,
        total_bags: 0,
        total_revenue: 0
      };
      
      // Map returned statuses to our stats object (normalize to lowercase)
      for (const row of statusRows) {
        // Skip null/undefined statuses
        if (!row.status) continue;
        
        const status = row.status.toLowerCase();
        const count = parseInt(row.count, 10);
        
        // Map various possible status names to our canonical names
        // pending_pickup counts as pending
        if (status === 'pending' || status === 'pending_pickup') stats.pending += count;
        else if (status === 'picked_up' || status === 'pickedup') stats.picked_up += count;
        else if (status === 'in_storage' || status === 'instorage') stats.in_storage += count;
        else if (status === 'ready_for_delivery' || status === 'readyfordelivery' || status === 'ready') stats.ready_for_delivery += count;
        else if (status === 'delivered' || status === 'completed') stats.delivered += count;
        else if (status === 'cancelled' || status === 'canceled') stats.cancelled += count;
      }
      
      // Get total bags and revenue in separate queries
      const bagsSql = `
        SELECT COALESCE(SUM(
          COALESCE(bag_count_large, 0) + 
          COALESCE(bag_count_carryon, 0) + 
          COALESCE(bag_count_backpack, 0)
        ), 0) as total_bags
        FROM storage 
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `;
      const bagsResult = await this.queryOne<{ total_bags: string }>(bagsSql);
      stats.total_bags = parseInt(bagsResult?.total_bags || '0', 10);
      
      // Get revenue from delivered orders only
      const revenueSql = `
        SELECT COALESCE(SUM(total_price_cents), 0) / 100.0 as total_revenue
        FROM storage 
        WHERE created_at > NOW() - INTERVAL '${days} days'
          AND LOWER(status::text) IN ('delivered', 'completed')
      `;
      const revenueResult = await this.queryOne<{ total_revenue: string }>(revenueSql);
      stats.total_revenue = parseFloat(revenueResult?.total_revenue || '0');
      
      return stats;
    } catch (error) {
      console.error('Storage stats query failed:', error);
      throw error;
    }
  }

  async confirmPickup(storageId: number): Promise<boolean> {
    // First check current status
    const checkSql = `SELECT status::text as status FROM storage WHERE id = $1`;
    const current = await this.queryOne<{ status: string }>(checkSql, [storageId]);
    
    if (!current) return false;
    const currentStatus = current.status.toLowerCase();
    // Accept pending, pending_pickup, or similar pre-pickup statuses
    if (!['pending', 'pending_pickup', 'booked', 'scheduled'].includes(currentStatus)) {
      return false;
    }
    
    // Update status to picked_up
    const sql = `
      UPDATE storage 
      SET status = (
        SELECT enumlabel::storage_status 
        FROM pg_enum 
        WHERE enumtypid = 'storage_status'::regtype 
        AND LOWER(enumlabel) = 'picked_up'
        LIMIT 1
      ),
          picked_up_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND LOWER(status::text) IN ('pending', 'pending_pickup', 'booked', 'scheduled')
      RETURNING id
    `;
    
    try {
      const result = await this.query<{ id: number }>(sql, [storageId]);
      return result.length > 0;
    } catch (e) {
      // Fallback: try direct update with cast
      const fallbackSql = `
        UPDATE storage 
        SET status = 'picked_up'::text::storage_status,
            picked_up_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
          AND LOWER(status::text) IN ('pending', 'pending_pickup', 'booked', 'scheduled')
        RETURNING id
      `;
      const result = await this.query<{ id: number }>(fallbackSql, [storageId]);
      return result.length > 0;
    }
  }

  async confirmStorage(storageId: number): Promise<boolean> {
    // First check current status
    const checkSql = `SELECT status::text as status FROM storage WHERE id = $1`;
    const current = await this.queryOne<{ status: string }>(checkSql, [storageId]);
    
    if (!current) return false;
    const currentStatus = current.status.toLowerCase();
    if (!['picked_up', 'pickedup', 'collected'].includes(currentStatus)) {
      return false;
    }
    
    // Update status to in_storage
    const sql = `
      UPDATE storage 
      SET status = (
        SELECT enumlabel::storage_status 
        FROM pg_enum 
        WHERE enumtypid = 'storage_status'::regtype 
        AND LOWER(enumlabel) = 'in_storage'
        LIMIT 1
      ),
          updated_at = NOW()
      WHERE id = $1
        AND LOWER(status::text) IN ('picked_up', 'pickedup', 'collected')
      RETURNING id
    `;
    
    try {
      const result = await this.query<{ id: number }>(sql, [storageId]);
      return result.length > 0;
    } catch (e) {
      // Fallback: try direct update with cast
      const fallbackSql = `
        UPDATE storage 
        SET status = 'in_storage'::text::storage_status,
            updated_at = NOW()
        WHERE id = $1
          AND LOWER(status::text) IN ('picked_up', 'pickedup', 'collected')
        RETURNING id
      `;
      const result = await this.query<{ id: number }>(fallbackSql, [storageId]);
      return result.length > 0;
    }
  }

  async cancel(storageId: number): Promise<boolean> {
    // First check current status by querying
    const checkSql = `SELECT status::text as status FROM storage WHERE id = $1`;
    const current = await this.queryOne<{ status: string }>(checkSql, [storageId]);
    
    // Don't cancel if already delivered or cancelled
    if (!current) return false;
    const currentStatus = current.status.toLowerCase();
    if (currentStatus === 'delivered' || currentStatus === 'completed' || currentStatus === 'cancelled' || currentStatus === 'canceled') {
      return false;
    }
    
    // Try to update - we'll construct a dynamic SQL that casts the string to the enum
    // This works because PostgreSQL will try to cast the string to the enum type
    const sql = `
      UPDATE storage 
      SET status = $2::text::storage_status,
          updated_at = NOW()
      WHERE id = $1
        AND LOWER(status::text) NOT IN ('delivered', 'completed', 'cancelled', 'canceled')
      RETURNING id
    `;
    
    // Try common variants of 'cancelled'
    const cancelVariants = ['cancelled', 'canceled', 'CANCELLED', 'CANCELED'];
    for (const variant of cancelVariants) {
      try {
        const result = await this.query<{ id: number }>(sql, [storageId, variant]);
        if (result.length > 0) return true;
      } catch (e) {
        // Try next variant
        continue;
      }
    }
    return false;
  }

  // Get total bag count for a storage order
  getBagCount(storage: Storage): number {
    return (storage.bag_count_large || 0) + 
           (storage.bag_count_carryon || 0) + 
           (storage.bag_count_backpack || 0);
  }

  // Format bag counts for display
  formatBagCounts(storage: Storage): string {
    const parts: string[] = [];
    if (storage.bag_count_large) parts.push(`${storage.bag_count_large}L`);
    if (storage.bag_count_carryon) parts.push(`${storage.bag_count_carryon}C`);
    if (storage.bag_count_backpack) parts.push(`${storage.bag_count_backpack}B`);
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  }
}
