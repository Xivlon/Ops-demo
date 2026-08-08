// Mock repository implementations for demo mode (no database required)

import type {
  Shipment,
  ShipmentStatus,
  Driver,
  DriverStats,
  Storage,
  StorageStatus,
  ListShipmentsParams,
  ListStorageParams,
  DashboardStats,
  StorageStats,
} from '../types';
import type { RevenueReport, DriverEarnings } from './reports';
import { getMockDataStore } from './mock-data';
import { calculatePickupUrgency } from '../utils/urgency';

// Base mock repository that does not need a Pool.
abstract class MockBaseRepository {
  protected get store() {
    return getMockDataStore();
  }
}

export class MockShipmentRepository extends MockBaseRepository {
  async findById(id: string): Promise<Shipment | null> {
    return this.store.shipments.find(s => s.id === id) ?? null;
  }

  async list(params: ListShipmentsParams = {}): Promise<Shipment[]> {
    const { status, limit = 100, days = 30 } = params;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let rows = this.store.shipments
      .filter(s => new Date(s.created_at) > cutoff)
      .sort((a, b) => new Date(a.pickup_at).getTime() - new Date(b.pickup_at).getTime());

    if (status) {
      rows = rows.filter(s => s.status === status);
    }

    return rows.slice(0, limit).map(row => ({
      ...row,
      urgency: calculatePickupUrgency(row.pickup_at, row.dropoff_by),
    }));
  }

  async assignDriver(shipmentId: string, driverId: string): Promise<boolean> {
    const shipment = this.store.shipments.find(s => s.id === shipmentId);
    const driver = this.store.drivers.find(d => d.id === driverId);
    if (!shipment || !driver || shipment.status !== 'PENDING') return false;

    shipment.status = 'ASSIGNED';
    shipment.driver_id = driverId;
    shipment.driver_name = `${driver.first_name} ${driver.last_name}`;
    shipment.claimed_at = new Date().toISOString();
    shipment.updated_at = new Date().toISOString();
    return true;
  }

  async updateStatus(id: string, status: ShipmentStatus): Promise<boolean> {
    const shipment = this.store.shipments.find(s => s.id === id);
    if (!shipment) return false;
    shipment.status = status;
    shipment.updated_at = new Date().toISOString();
    if (status === 'IN_TRANSIT') shipment.picked_up_at = new Date().toISOString();
    if (status === 'DELIVERED') shipment.delivered_at = new Date().toISOString();
    return true;
  }

  async getDashboardStats(_days = 30): Promise<DashboardStats> {
    const delivered = this.store.shipments.filter(s => s.status === 'DELIVERED');
    const revenue = delivered.reduce((sum, s) => sum + s.price_cents, 0) / 100;
    return {
      pending: this.store.shipments.filter(s => s.status === 'PENDING').length,
      assigned: this.store.shipments.filter(s => s.status === 'ASSIGNED').length,
      picked_up: this.store.shipments.filter(s => s.status === 'IN_TRANSIT').length,
      delivered: delivered.length,
      cancelled: this.store.shipments.filter(s => s.status === 'CANCELLED').length,
      total_revenue: revenue,
      online_drivers: this.store.drivers.filter(d => d.is_online).length,
      total_drivers: this.store.drivers.length,
    };
  }

  async countByStatus(status: ShipmentStatus, days = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return this.store.shipments.filter(
      s => s.status === status && new Date(s.created_at) > cutoff
    ).length;
  }

  async cancel(shipmentId: string): Promise<boolean> {
    const shipment = this.store.shipments.find(s => s.id === shipmentId);
    if (!shipment || shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED') return false;
    shipment.status = 'CANCELLED';
    shipment.bknd = true;
    shipment.driver_id = null;
    shipment.driver_name = null;
    shipment.updated_at = new Date().toISOString();
    return true;
  }
}

export class MockDriverRepository extends MockBaseRepository {
  async listAll(): Promise<Driver[]> {
    return [...this.store.drivers].sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
    );
  }

  async listOnline(): Promise<Driver[]> {
    return (await this.listAll()).filter(d => d.is_online);
  }

  async getLiveStats(): Promise<DriverStats> {
    const drivers = this.store.drivers;
    const online = drivers.filter(d => d.is_online).length;
    const topDriver = drivers.reduce((max, d) =>
      (d.total_deliveries || 0) > (max?.total_deliveries || 0) ? d : max
    , drivers[0] || null);

    return {
      total_drivers: drivers.length,
      online_drivers: online,
      offline_drivers: drivers.length - online,
      top_driver: topDriver
        ? { id: topDriver.id, name: `${topDriver.first_name} ${topDriver.last_name}`, deliveries: topDriver.total_deliveries || 0 }
        : null,
    } as DriverStats;
  }

  async findById(id: string): Promise<Driver | null> {
    return this.store.drivers.find(d => d.id === id) ?? null;
  }

  async getDriverDetailedStats(): Promise<any[]> {
    return this.store.drivers.map(driver => {
      const assigned = this.store.shipments.filter(s => s.driver_id === driver.id);
      const completed = assigned.filter(s => s.status === 'DELIVERED');
      const cancelled = assigned.filter(s => s.status === 'CANCELLED');
      const totalWithResult = completed.length + cancelled.length;
      const revenue = completed.reduce((sum, s) => sum + s.price_cents, 0) / 100;

      return {
        id: driver.id,
        first_name: driver.first_name,
        last_name: driver.last_name,
        email: driver.email,
        phone: driver.phone,
        is_online: driver.is_online,
        avg_rating: driver.rating || 0,
        driver_joined: driver.account_created_at,
        last_active: driver.account_updated_at,
        pending_count: assigned.filter(s => s.status === 'PENDING').length,
        assigned_count: assigned.filter(s => s.status === 'ASSIGNED').length,
        in_transit_count: assigned.filter(s => s.status === 'IN_TRANSIT').length,
        total_assigned: assigned.length,
        total_completed: completed.length,
        cancelled_count: cancelled.length,
        total_revenue: revenue,
        week_revenue: revenue * 0.2,
        month_revenue: revenue * 0.5,
        week_completed: Math.floor(completed.length * 0.15),
        week_success_rate: null,
        month_completed: Math.floor(completed.length * 0.4),
        month_success_rate: null,
        month_cancel_rate: null,
        success_rate: totalWithResult > 0 ? ((completed.length / totalWithResult) * 100).toFixed(1) : null,
        cancel_rate: totalWithResult > 0 ? ((cancelled.length / totalWithResult) * 100).toFixed(1) : null,
      };
    });
  }

  async getEnhancedStats(): Promise<any> {
    const drivers = this.store.drivers;
    const online = drivers.filter(d => d.is_online).length;
    const topDriver = drivers.reduce((max, d) =>
      (d.total_deliveries || 0) > (max?.total_deliveries || 0) ? d : max
    , drivers[0] || null);

    const vehicleBreakdown = drivers.reduce((acc, d) => {
      const type = d.vehicle_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: drivers.length,
      online,
      offline: drivers.length - online,
      topDriver: topDriver
        ? { id: topDriver.id, name: `${topDriver.first_name} ${topDriver.last_name}`, deliveries: topDriver.total_deliveries || 0, rating: topDriver.rating, vehicle: topDriver.vehicle_type }
        : null,
      vehicleBreakdown,
      averageRating: drivers.length > 0 ? drivers.reduce((sum, d) => sum + (d.rating || 0), 0) / drivers.length : 0,
    };
  }

  calculateDriverRating(_driver: any): number {
    return parseFloat((3.5 + Math.random() * 1.5).toFixed(1));
  }

  async updateRating(_driverId: string, _rating: number): Promise<boolean> {
    return true;
  }

  async getCachedStats(): Promise<any[]> {
    return this.getDriverDetailedStats();
  }

  async getTotalRevenue(): Promise<number> {
    return this.store.shipments
      .filter(s => s.status === 'DELIVERED')
      .reduce((sum, s) => sum + s.price_cents, 0) / 100;
  }
}

export class MockStorageRepository extends MockBaseRepository {
  async findById(id: string): Promise<Storage | null> {
    return this.store.storage.find(s => s.id === id) ?? null;
  }

  private normalizeStorageStatus(status: string): string {
    return status?.toUpperCase().replace(/-/g, '_');
  }

  async list(params: ListStorageParams = {}): Promise<Storage[]> {
    const { status, limit = 100, days = 30 } = params;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let rows = this.store.storage
      .filter(s => new Date(s.created_at) > cutoff)
      .sort((a, b) => new Date(a.pickup_at).getTime() - new Date(b.pickup_at).getTime());

    if (status) {
      const normalized = this.normalizeStorageStatus(status);
      rows = rows.filter(s => this.normalizeStorageStatus(s.status) === normalized);
    }

    return rows.slice(0, limit);
  }

  async assignPickupDriver(storageId: string, driverId: string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === storageId);
    const driver = this.store.drivers.find(d => d.id === driverId);
    if (!order || !driver) return false;
    order.pickup_driver_id = driverId;
    order.pickup_driver_name = `${driver.first_name} ${driver.last_name}`;
    order.updated_at = new Date().toISOString();
    return true;
  }

  async assignDeliveryDriver(storageId: string, driverId: string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === storageId);
    const driver = this.store.drivers.find(d => d.id === driverId);
    if (!order || !driver) return false;
    order.delivery_driver_id = driverId;
    order.delivery_driver_name = `${driver.first_name} ${driver.last_name}`;
    order.updated_at = new Date().toISOString();
    return true;
  }

  async updateStatus(id: string, status: StorageStatus | string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === id);
    if (!order) return false;
    order.status = status as StorageStatus;
    order.updated_at = new Date().toISOString();
    return true;
  }

  async getStorageStats(_days = 30): Promise<StorageStats> {
    const totalBags = this.store.storage.reduce(
      (sum, s) => sum + (s.bag_count_large || 0) + (s.bag_count_carryon || 0) + (s.bag_count_backpack || 0),
      0
    );
    const revenue = this.store.storage
      .filter(s => this.normalizeStorageStatus(s.status) !== 'PENDING_DROPOFF')
      .reduce((sum, s) => sum + s.price_cents, 0) / 100;

    const stats: StorageStats = {
      pending: 0,
      picked_up: 0,
      in_storage: 0,
      ready_for_delivery: 0,
      delivered: 0,
      cancelled: 0,
      total_bags: totalBags,
      total_revenue: revenue,
    };

    for (const s of this.store.storage) {
      const status = this.normalizeStorageStatus(s.status);
      switch (status) {
        case 'PENDING_DROPOFF':
          stats.pending++;
          break;
        case 'PENDING_PICKUP':
          stats.in_storage++;
          break;
        case 'PICKUP_CONFIRMED':
        case 'DELIVERED':
          stats.delivered++;
          break;
        default:
          stats.cancelled++;
      }
    }

    return stats;
  }

  async confirmDropoff(storageId: string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === storageId);
    if (!order || this.normalizeStorageStatus(order.status) !== 'PENDING_DROPOFF') return false;
    order.status = 'PENDING_PICKUP' as StorageStatus;
    order.storage_start_date = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    return true;
  }

  async confirmPickup(storageId: string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === storageId);
    if (!order || this.normalizeStorageStatus(order.status) !== 'PENDING_PICKUP') return false;
    order.status = 'PICKUP_CONFIRMED' as StorageStatus;
    order.picked_up_at = new Date().toISOString();
    order.updated_at = new Date().toISOString();
    return true;
  }

  async cancel(storageId: string): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === storageId);
    if (!order) return false;
    const status = this.normalizeStorageStatus(order.status);
    if (status === 'DELIVERED' || status === 'CANCELLED' || status === 'PICKUP_CONFIRMED') return false;
    order.status = 'CANCELLED' as StorageStatus;
    order.updated_at = new Date().toISOString();
    return true;
  }

  getBagCount(storage: Storage): number {
    return (storage.bag_count_large || 0) + (storage.bag_count_carryon || 0) + (storage.bag_count_backpack || 0);
  }

  formatBagCounts(storage: Storage): string {
    const parts: string[] = [];
    if (storage.bag_count_large) parts.push(`${storage.bag_count_large}L`);
    if (storage.bag_count_carryon) parts.push(`${storage.bag_count_carryon}C`);
    if (storage.bag_count_backpack) parts.push(`${storage.bag_count_backpack}B`);
    return parts.length > 0 ? parts.join(', ') : 'N/A';
  }

  async updateOrder(id: string, updates: Partial<Storage>): Promise<boolean> {
    const order = this.store.storage.find(s => s.id === id);
    if (!order || order.status !== 'pending') return false;
    Object.assign(order, updates, { updated_at: new Date().toISOString() });
    return true;
  }
}

export class MockReportsRepository extends MockBaseRepository {
  getPeriodRange(period: 'weekly' | 'monthly' | 'quarterly' | 'annual'): { startDate: string; endDate: string; label: string } {
    const now = new Date();
    const endDate = now.toISOString();
    let start: Date;
    let label: string;

    switch (period) {
      case 'weekly': {
        const day = now.getUTCDay();
        const mondayOffset = day === 0 ? 6 : day - 1;
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset, 0, 0, 0, 0));
        label = 'This Week';
        break;
      }
      case 'monthly': {
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        label = 'This Month';
        break;
      }
      case 'quarterly': {
        const quarter = Math.floor(now.getUTCMonth() / 3);
        start = new Date(Date.UTC(now.getUTCFullYear(), quarter * 3, 1, 0, 0, 0, 0));
        label = `Q${quarter + 1} ${now.getUTCFullYear()}`;
        break;
      }
      case 'annual': {
        start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
        label = `${now.getUTCFullYear()}`;
        break;
      }
    }

    return { startDate: start.toISOString(), endDate, label };
  }

  async getRevenueReport(startDate: string, endDate: string, periodLabel?: string): Promise<RevenueReport> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const storageOrders = this.store.storage.filter(
      s => new Date(s.created_at) >= start && new Date(s.created_at) < end && s.status !== 'pending'
    );
    const transportOrders = this.store.shipments.filter(
      s => new Date(s.created_at) >= start && new Date(s.created_at) < end && s.status === 'DELIVERED'
    );

    const storageRevenue = storageOrders.reduce((sum, s) => sum + s.price_cents, 0) / 100;
    const transportRevenue = transportOrders.reduce((sum, s) => sum + s.price_cents, 0) / 100;

    return {
      period: periodLabel || `${startDate} to ${endDate}`,
      startDate,
      endDate,
      storageRevenue,
      transportRevenue,
      totalRevenue: storageRevenue + transportRevenue,
      storageOrders: storageOrders.length,
      transportOrders: transportOrders.length,
      totalOrders: storageOrders.length + transportOrders.length,
    };
  }

  async getDriverEarnings(_startDate: string, _endDate: string): Promise<DriverEarnings[]> {
    return this.store.drivers
      .map(driver => {
        const completed = this.store.shipments.filter(
          s => s.driver_id === driver.id && s.status === 'DELIVERED'
        );
        const earnings = completed.reduce((sum, s) => sum + s.price_cents, 0) / 100;
        return {
          driverId: driver.id,
          driverName: `${driver.first_name} ${driver.last_name}`,
          email: driver.email,
          storageEarnings: 0,
          transportEarnings: earnings,
          totalEarnings: earnings,
          completedOrders: completed.length,
        };
      })
      .filter(d => d.totalEarnings > 0)
      .sort((a, b) => b.totalEarnings - a.totalEarnings);
  }

  async getWeeklyReport(): Promise<RevenueReport> {
    const { startDate, endDate, label } = this.getPeriodRange('weekly');
    return this.getRevenueReport(startDate, endDate, label);
  }

  async getMonthlyReport(): Promise<RevenueReport> {
    const { startDate, endDate, label } = this.getPeriodRange('monthly');
    return this.getRevenueReport(startDate, endDate, label);
  }

  async getQuarterlyReport(): Promise<RevenueReport> {
    const { startDate, endDate, label } = this.getPeriodRange('quarterly');
    return this.getRevenueReport(startDate, endDate, label);
  }

  async getAnnualReport(): Promise<RevenueReport> {
    const { startDate, endDate, label } = this.getPeriodRange('annual');
    return this.getRevenueReport(startDate, endDate, label);
  }

  async getStorageOrdersForExport(_startDate: string, _endDate: string): Promise<any[]> {
    return this.store.storage.map(s => ({
      id: s.id,
      created_at: s.created_at,
      status: s.status,
      customer_name: s.customer_name,
      customer_email: s.customer_email,
      customer_phone: s.customer_phone,
      price: s.price_cents / 100,
      storage_days: s.storage_days,
      total_bags: (s.bag_count_large || 0) + (s.bag_count_carryon || 0) + (s.bag_count_backpack || 0),
      pickup_driver: s.pickup_driver_name,
      picked_up_at: s.picked_up_at,
    }));
  }

  async getTransportOrdersForExport(_startDate: string, _endDate: string): Promise<any[]> {
    return this.store.shipments.map(s => ({
      id: s.id,
      created_at: s.created_at,
      status: s.status,
      customer_name: s.customer_name,
      customer_email: s.customer_email,
      customer_phone: s.customer_phone,
      price: s.price_cents / 100,
      origin_airport: s.origin_airport,
      destination_airport: s.destination_airport,
      driver: s.driver_name,
      delivered_at: s.delivered_at,
    }));
  }

  async getEarningsBreakdown(periodType: 'monthly' | 'quarterly' | 'yearly'): Promise<any[]> {
    const now = new Date();
    let limit: number;
    let periodKey: (d: Date) => string;

    switch (periodType) {
      case 'monthly':
        limit = 12;
        periodKey = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        break;
      case 'quarterly':
        limit = 8;
        periodKey = d => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
        break;
      case 'yearly':
        limit = 5;
        periodKey = d => `${d.getUTCFullYear()}`;
        break;
    }

    const map = new Map<string, { period: string; storageRevenue: number; storageOrders: number; transportRevenue: number; transportOrders: number; totalRevenue: number; totalOrders: number }>();

    const add = (period: string, revenue: number, orders: number, type: 'storage' | 'transport') => {
      const existing = map.get(period);
      if (existing) {
        if (type === 'storage') {
          existing.storageRevenue += revenue;
          existing.storageOrders += orders;
        } else {
          existing.transportRevenue += revenue;
          existing.transportOrders += orders;
        }
        existing.totalRevenue += revenue;
        existing.totalOrders += orders;
      } else {
        map.set(period, {
          period,
          storageRevenue: type === 'storage' ? revenue : 0,
          storageOrders: type === 'storage' ? orders : 0,
          transportRevenue: type === 'transport' ? revenue : 0,
          transportOrders: type === 'transport' ? orders : 0,
          totalRevenue: revenue,
          totalOrders: orders,
        });
      }
    };

    this.store.storage
      .filter(s => s.status !== 'pending')
      .forEach(s => add(periodKey(new Date(s.created_at)), s.price_cents / 100, 1, 'storage'));

    this.store.shipments
      .filter(s => s.status === 'DELIVERED')
      .forEach(s => add(periodKey(new Date(s.created_at)), s.price_cents / 100, 1, 'transport'));

    return Array.from(map.values())
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, limit);
  }
}
