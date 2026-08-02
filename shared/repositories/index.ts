import type { Pool } from '@neondatabase/serverless';
import { ShipmentRepository } from './shipments';
import { DriverRepository } from './drivers';
import { StorageRepository } from './storage';
import { ReportsRepository } from './reports';
import {
  MockShipmentRepository,
  MockDriverRepository,
  MockStorageRepository,
  MockReportsRepository,
} from './mock';

export interface Repositories {
  shipments: ShipmentRepository | MockShipmentRepository;
  drivers: DriverRepository | MockDriverRepository;
  storage: StorageRepository | MockStorageRepository;
  reports: ReportsRepository | MockReportsRepository;
}

export function createRepositories(pool: Pool): Repositories {
  return {
    shipments: new ShipmentRepository(pool),
    drivers: new DriverRepository(pool),
    storage: new StorageRepository(pool),
    reports: new ReportsRepository(pool),
  };
}

export function createMockRepositories(): Repositories {
  return {
    shipments: new MockShipmentRepository(),
    drivers: new MockDriverRepository(),
    storage: new MockStorageRepository(),
    reports: new MockReportsRepository(),
  };
}

export { ShipmentRepository, DriverRepository, StorageRepository, ReportsRepository };
export { MockShipmentRepository, MockDriverRepository, MockStorageRepository, MockReportsRepository };
export type { RevenueReport, DriverEarnings } from './reports';
