import { BaseRepository } from './base';
import type { Driver, DriverStats } from '../types';

export class DriverRepository {
  constructor(private baseRepo: BaseRepository) {}

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
    
    const result = await this.baseRepo.query<Driver>(query);
    return result.rows;
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
    
    const result = await this.baseRepo.query<Driver>(query);
    return result.rows;
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
      this.baseRepo.query<{ count: string }>(totalQuery),
      this.baseRepo.query<{ count: string }>(onlineQuery),
      this.baseRepo.query<any>(topDriverQuery),
    ]);
    
    const total = parseInt(totalResult.rows[0]?.count || '0', 10);
    const online = parseInt(onlineResult.rows[0]?.count || '0', 10);
    const topDriver = topDriverResult.rows[0];
    
    return {
      total,
      online,
      offline: total - online,
      topDriver: topDriver ? {
        id: topDriver.id,
        name: `${topDriver.first_name} ${topDriver.last_name}`,
        deliveries: topDriver.total_deliveries || 0
      } : null
    };
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
    
    const result = await this.baseRepo.query<Driver>(query, [id]);
    return result.rows[0] || null;
  }
}
