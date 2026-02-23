import type { Pool } from '@neondatabase/serverless';
import { ShipmentRepository } from './shipments';
import { DriverRepository } from './drivers';

export interface Repositories {
  shipments: ShipmentRepository;
  drivers: DriverRepository;
}

export function createRepositories(pool: Pool): Repositories {
  return {
    shipments: new ShipmentRepository(pool),
    drivers: new DriverRepository(pool),
  };
}

export { ShipmentRepository, DriverRepository };
