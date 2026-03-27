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
    const sql = `
      UPDATE storage 
      SET pickup_driver_id = $1, 
          updated_at = NOW()
      WHERE id = $2 
        AND status IN ('pending', 'picked_up')
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async assignDeliveryDriver(storageId: number, driverId: string): Promise<boolean> {
    const sql = `
      UPDATE storage 
      SET delivery_driver_id = $1, 
          updated_at = NOW()
      WHERE id = $2 
        AND status IN ('in_storage', 'ready_for_delivery')
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [driverId, storageId]);
    return result.length > 0;
  }

  async updateStatus(id: number, status: StorageStatus): Promise<boolean> {
    const sql = `
      UPDATE storage 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [status, id]);
    return result.length > 0;
  }

  async getStorageStats(days = 30): Promise<StorageStats> {
    try {
      const sql = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'picked_up') as picked_up,
          COUNT(*) FILTER (WHERE status = 'in_storage') as in_storage,
          COUNT(*) FILTER (WHERE status = 'ready_for_delivery') as ready_for_delivery,
          COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
          COALESCE(SUM(
            COALESCE(bag_count_large, 0) + 
            COALESCE(bag_count_carryon, 0) + 
            COALESCE(bag_count_backpack, 0)
          ), 0) as total_bags,
          COALESCE(SUM(total_price_cents) FILTER (WHERE status = 'delivered'), 0) / 100.0 as total_revenue
        FROM storage 
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `;
      return this.queryOne<StorageStats>(sql) as Promise<StorageStats>;
    } catch (error) {
      console.error('Storage stats query failed:', error);
      throw error;
    }
  }

  async cancel(storageId: number): Promise<boolean> {
    const sql = `
      UPDATE storage 
      SET status = 'cancelled', 
          updated_at = NOW()
      WHERE id = $1 
        AND status NOT IN ('delivered', 'cancelled')
      RETURNING id
    `;
    const result = await this.query<{ id: number }>(sql, [storageId]);
    return result.length > 0;
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
