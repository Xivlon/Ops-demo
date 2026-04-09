import type { Pool } from '@neondatabase/serverless';
import { ShipmentRepository } from './shipments';
import { DriverRepository } from './drivers';
import { StorageRepository } from './storage';
import { ReportsRepository } from './reports';

export interface Repositories {
  shipments: ShipmentRepository;
  drivers: DriverRepository;
  storage: StorageRepository;
  reports: ReportsRepository;
}

export function createRepositories(pool: Pool): Repositories {
  return {
    shipments: new ShipmentRepository(pool),
    drivers: new DriverRepository(pool),
    storage: new StorageRepository(pool),
    reports: new ReportsRepository(pool),
  };
}

export { ShipmentRepository, DriverRepository, StorageRepository, ReportsRepository };
export type { RevenueReport, DriverEarnings } from './reports';
