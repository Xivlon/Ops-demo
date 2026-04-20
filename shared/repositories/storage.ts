import type { Pool } from '@neondatabase/serverless';
import type { Storage, StorageStatus, ListStorageParams, StorageStats } from '../types';
import { BaseRepository } from './base';

export class StorageRepository extends BaseRepository {
  constructor(pool: Pool) {
    super(pool);
  }

  async findById(id: string): Promise<Storage | null> {
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

  // Validate and sanitize days parameter
  private sanitizeDays(days: number): number {
    const parsed = Math.max(1, Math.min(365, Math.floor(days))); // Clamp between 1-365 days
    return parsed;
  }

  // Validate and sanitize limit parameter
  private sanitizeLimit(limit: number): number {
    const parsed = Math.max(1, Math.min(1000, Math.floor(limit))); // Clamp between 1-1000
    return parsed;
  }

  async list(params: ListStorageParams = {}): Promise<Storage[]> {
    const { status } = params;
    const limit = this.sanitizeLimit(params.limit ?? 100);
    const days = this.sanitizeDays(params.days ?? 30);
    
    // Use parameterized interval to prevent SQL injection
    // (days || ' days')::INTERVAL safely constructs the interval from parameter
    let sql = `
      SELECT s.*, 
        CONCAT(pd.first_name, ' ', pd.last_name) as pickup_driver_name,
        CONCAT(dd.first_name, ' ', dd.last_name) as delivery_driver_name
      FROM storage s
      LEFT JOIN driver_profiles pd ON s.pickup_driver_id = pd.id
      LEFT JOIN driver_profiles dd ON s.delivery_driver_id = dd.id
      WHERE s.created_at > NOW() - ($1 || ' days')::INTERVAL
    `;
    
    const queryParams: (string | number)[] = [days.toString()];
    let paramIndex = 2;

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

  async assignPickupDriver(storageId: string, driverId: string): Promise<boolean> {
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
    const result = await this.query<{ id: string }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async assignDeliveryDriver(storageId: string, driverId: string): Promise<boolean> {
    // Use LOWER() to handle case-insensitive status matching
    const sql = `
      UPDATE storage 
      SET delivery_driver_id = $1, 
          updated_at = NOW()
      WHERE id = $2 
        AND LOWER(status::text) IN ('in_storage', 'instorage', 'ready_for_delivery', 'readyfordelivery', 'ready')
      RETURNING id
    `;
    const result = await this.query<{ id: string }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async updateStatus(id: string, status: StorageStatus | string): Promise<boolean> {
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
        const result = await this.query<{ id: string }>(sql, [value, id]);
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
      const result = await this.query<{ id: string }>(findEnumSql, [status, id]);
      return result.length > 0;
    } catch (e) {
      return false;
    }
  }

  async getStorageStats(days = 30): Promise<StorageStats> {
    const sanitizedDays = this.sanitizeDays(days);
    
    try {
      // Use parameterized interval to prevent SQL injection
      const statusCountsSql = `
        SELECT 
          status::text as status,
          COUNT(*) as count
        FROM storage 
        WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
        GROUP BY status
      `;
      const statusRows = await this.query<{ status: string; count: string }>(statusCountsSql, [sanitizedDays.toString()]);
      
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
      
      // Map returned statuses to our stats object (using actual database enum values)
      for (const row of statusRows) {
        // Null status counts as cancelled
        if (!row.status) {
          stats.cancelled += parseInt(row.count, 10);
          continue;
        }
        
        const status = row.status.toUpperCase();
        const count = parseInt(row.count, 10);
        
        // Simplified workflow: Pending Dropoff -> Pending Pickup -> Pickup Confirmed
        switch (status) {
          case 'PENDING_DROPOFF':
            stats.pending += count;
            break;
          case 'PENDING_PICKUP':
            stats.in_storage += count; // Bags are in storage waiting for pickup
            break;
          case 'PICKUP_CONFIRMED':
          case 'DELIVERED':
            stats.delivered += count;
            break;
          default:
            // Unknown status - count as cancelled
            stats.cancelled += count;
        }
      }
      
      // Get total bags and revenue in separate queries
      const bagsSql = `
        SELECT COALESCE(SUM(
          COALESCE(bag_count_large, 0) + 
          COALESCE(bag_count_carryon, 0) + 
          COALESCE(bag_count_backpack, 0)
        ), 0) as total_bags
        FROM storage 
        WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
      `;
      const bagsResult = await this.queryOne<{ total_bags: string }>(bagsSql, [sanitizedDays.toString()]);
      stats.total_bags = parseInt(bagsResult?.total_bags || '0', 10);
      
      // Get revenue from price_cents (only count when drop-off is confirmed - not pending dropoff)
      const revenueSql = `
        SELECT COALESCE(SUM(price_cents), 0) / 100.0 as total_revenue
        FROM storage 
        WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
          AND status != 'PENDING_DROPOFF'
      `;
      const revenueResult = await this.queryOne<{ total_revenue: string }>(revenueSql, [sanitizedDays.toString()]);
      stats.total_revenue = parseFloat(revenueResult?.total_revenue || '0');
      
      return stats;
    } catch (error) {
      console.error('Storage stats query failed:', error);
      throw error;
    }
  }

  async confirmDropoff(storageId: string): Promise<boolean> {
    // Customer has dropped off bags - move directly to PENDING_PICKUP (in storage waiting for pickup)
    const sql = `
      UPDATE storage 
      SET status = 'PENDING_PICKUP',
          updated_at = NOW()
      WHERE id = $1
        AND status = 'PENDING_DROPOFF'
      RETURNING id
    `;
    
    const result = await this.query<{ id: string }>(sql, [storageId]);
    return result.length > 0;
  }

  async confirmPickup(storageId: string): Promise<boolean> {
    // Driver has picked up bags - move to PICKUP_CONFIRMED status
    const sql = `
      UPDATE storage 
      SET status = 'PICKUP_CONFIRMED',
          picked_up_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND status = 'PENDING_PICKUP'
      RETURNING id
    `;
    
    const result = await this.query<{ id: string }>(sql, [storageId]);
    return result.length > 0;
  }

  async cancel(storageId: string): Promise<boolean> {
    // Check if there's a cancelled status in the enum, otherwise use null with a flag
    const checkEnumSql = `
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = 'storage_status'::regtype 
      AND LOWER(enumlabel) LIKE '%cancel%'
      LIMIT 1
    `;
    const enumResult = await this.query<{ enumlabel: string }>(checkEnumSql);
    const cancelStatus = enumResult[0]?.enumlabel;
    
    if (cancelStatus) {
      // Use the actual cancelled status from enum
      const sql = `
        UPDATE storage 
        SET status = $2,
            updated_at = NOW()
        WHERE id = $1
          AND status NOT IN ('PICKUP_CONFIRMED')
        RETURNING id
      `;
      const result = await this.query<{ id: string }>(sql, [storageId, cancelStatus]);
      return result.length > 0;
    } else {
      // No cancelled status in enum - just set status to null as cancelled
      const sql = `
        UPDATE storage 
        SET status = null,
            updated_at = NOW()
        WHERE id = $1
          AND status NOT IN ('PICKUP_CONFIRMED')
        RETURNING id
      `;
      const result = await this.query<{ id: string }>(sql, [storageId]);
      return result.length > 0;
    }
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

  /**
   * Update a storage order. Only allowed when status is PENDING_DROPOFF.
   * Returns true if the order was found and updated.
   */
  async updateOrder(
    id: string,
    updates: Partial<Pick<Storage,
      | 'customer_name' | 'customer_email' | 'customer_phone'
      | 'pickup_contact_name' | 'pickup_contact_phone'
      | 'delivery_contact_name' | 'delivery_contact_phone'
      | 'storage_days' | 'storage_start_date' | 'storage_end_date'
      | 'bag_count_large' | 'bag_count_carryon' | 'bag_count_backpack'
      | 'luggage_description' | 'special_instructions' | 'notes'
    >>
  ): Promise<boolean> {
    // Build dynamic SET clause from allowed fields
    const allowedFields: Record<string, string> = {
      customer_name: 'customer_name',
      customer_email: 'customer_email',
      customer_phone: 'customer_phone',
      pickup_contact_name: 'pickup_contact_name',
      pickup_contact_phone: 'pickup_contact_phone',
      delivery_contact_name: 'delivery_contact_name',
      delivery_contact_phone: 'delivery_contact_phone',
      storage_days: 'storage_days',
      storage_start_date: 'storage_start_date',
      storage_end_date: 'storage_end_date',
      bag_count_large: 'bag_count_large',
      bag_count_carryon: 'bag_count_carryon',
      bag_count_backpack: 'bag_count_backpack',
      luggage_description: 'luggage_description',
      special_instructions: 'special_instructions',
      notes: 'notes',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, dbColumn] of Object.entries(allowedFields)) {
      if (key in updates && updates[key as keyof typeof updates] !== undefined) {
        setClauses.push(`${dbColumn} = $${paramIndex}`);
        values.push(updates[key as keyof typeof updates]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return false;
    }

    // Add updated_at and id
    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const sql = `
      UPDATE storage
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
        AND status = 'PENDING_DROPOFF'
      RETURNING id
    `;

    const result = await this.query<{ id: string }>(sql, values);
    return result.length > 0;
  }
}
