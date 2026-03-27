import type { Pool } from '@neondatabase/serverless';
import { ShipmentRepository } from './shipments';
import { DriverRepository } from './drivers';
import { StorageRepository } from './storage';

export interface Repositories {
  shipments: ShipmentRepository;
  drivers: DriverRepository;
  storage: StorageRepository;
}

export function createRepositories(pool: Pool): Repositories {
  return {
    shipments: new ShipmentRepository(pool),
    drivers: new DriverRepository(pool),
    storage: new StorageRepository(pool),
  };
}

export { ShipmentRepository, DriverRepository, StorageRepository };
