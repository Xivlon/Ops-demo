// In-memory mock data store for demo mode (no real database required)
// Data persists for the lifetime of a single worker isolate.

import type {
  Shipment,
  ShipmentStatus,
  Driver,
  Storage,
  StorageStatus,
  DashboardStats,
  StorageStats,
} from '../types';

const AIRPORTS = ['JFK', 'LAX', 'ORD', 'MIA', 'SFO', 'DFW', 'SEA', 'BOS'];
const VEHICLES = ['Sedan', 'SUV', 'Van', 'Truck'];
const FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Sam', 'Drew', 'Jamie', 'Charlie', 'Peyton', 'Skyler', 'Dakota'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez'];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randBool(chance = 0.5): boolean {
  return Math.random() < chance;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function hoursAgo(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

function name(): string {
  return `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
}

export function generateMockDrivers(count = 12): Driver[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `drv-${String(i + 1).padStart(3, '0')}`;
    const firstName = rand(FIRST_NAMES);
    const lastName = rand(LAST_NAMES);
    return {
      id,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@luggster.dev`,
      first_name: firstName,
      last_name: lastName,
      is_online: randBool(0.55),
      phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      current_latitude: 37.7749 + (Math.random() - 0.5) * 0.2,
      current_longitude: -122.4194 + (Math.random() - 0.5) * 0.2,
      vehicle_type: rand(VEHICLES),
      vehicle_plate: `LUG${randInt(1000, 9999)}`,
      rating: parseFloat((3.5 + Math.random() * 1.5).toFixed(1)),
      total_deliveries: randInt(10, 250),
      account_created_at: daysAgo(randInt(30, 365)),
      account_updated_at: daysAgo(randInt(1, 30)),
    };
  });
}

export function generateMockShipments(drivers: Driver[], count = 35): Shipment[] {
  const statuses: ShipmentStatus[] = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
  const weights = [0.25, 0.25, 0.2, 0.2, 0.1];

  function pickStatus(): ShipmentStatus {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < statuses.length; i++) {
      cumulative += weights[i];
      if (r < cumulative) return statuses[i];
    }
    return 'PENDING';
  }

  return Array.from({ length: count }, (_, i) => {
    const id = `shp-${String(i + 1).padStart(4, '0')}`;
    const status = pickStatus();
    const driver = status !== 'PENDING' && status !== 'CANCELLED' ? rand(drivers) : null;
    const origin = rand(AIRPORTS);
    let destination = rand(AIRPORTS);
    while (destination === origin) destination = rand(AIRPORTS);

    const createdAt = daysAgo(randInt(0, 28));
    const pickupAt = new Date(createdAt);
    pickupAt.setHours(pickupAt.getHours() + randInt(1, 48));
    const dropoffBy = new Date(pickupAt);
    dropoffBy.setHours(dropoffBy.getHours() + randInt(2, 12));

    const priceCents = randInt(2500, 15000);

    return {
      id,
      customer_id: `cust-${randInt(1000, 9999)}`,
      driver_id: driver?.id ?? null,
      luggage_id: `lug-${randInt(1000, 9999)}`,
      status,
      origin_airport: origin,
      destination_airport: destination,
      pickup_address: `${randInt(100, 9999)} ${rand(['Market St', 'Mission St', 'Valencia St', 'Geary Blvd', 'Van Ness Ave'])}, San Francisco, CA`,
      pickup_latitude: 37.7749 + (Math.random() - 0.5) * 0.15,
      pickup_longitude: -122.4194 + (Math.random() - 0.5) * 0.15,
      pickup_at: pickupAt.toISOString(),
      pickup_contact_name: name(),
      pickup_contact_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      dropoff_address: `${randInt(100, 9999)} ${rand(['Hayes St', 'Folsom St', 'Howard St', 'Bryant St', 'Divisadero St'])}, San Francisco, CA`,
      dropoff_latitude: 37.7749 + (Math.random() - 0.5) * 0.15,
      dropoff_longitude: -122.4194 + (Math.random() - 0.5) * 0.15,
      dropoff_by: dropoffBy.toISOString(),
      dropoff_contact_name: name(),
      dropoff_contact_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      distance_miles: parseFloat((Math.random() * 15 + 2).toFixed(1)),
      price_cents: priceCents,
      currency: 'USD',
      notes: randBool(0.3) ? 'Handle with care' : null,
      pickup_photo_url: null,
      delivery_photo_url: null,
      signature_url: null,
      claimed_at: driver ? pickupAt.toISOString() : null,
      picked_up_at: status === 'IN_TRANSIT' || status === 'DELIVERED' ? pickupAt.toISOString() : null,
      delivered_at: status === 'DELIVERED' ? dropoffBy.toISOString() : null,
      created_at: createdAt,
      updated_at: createdAt,
      customer_name: name(),
      customer_email: `customer${randInt(1, 999)}@example.com`,
      customer_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      luggage_description: `${randInt(1, 4)} ${rand(['carry-on', 'checked bag', 'large suitcase', 'backpack'])}`,
      promo_code: randBool(0.2) ? 'LUGGAGE10' : null,
      special_instructions: randBool(0.25) ? 'Ring doorbell on arrival' : null,
      bknd: status === 'CANCELLED',
      driver_name: driver ? `${driver.first_name} ${driver.last_name}` : null,
    };
  });
}

export function generateMockStorageOrders(drivers: Driver[], count = 25): Storage[] {
  const statuses: StorageStatus[] = ['pending', 'picked_up', 'in_storage', 'ready_for_delivery', 'delivered', 'cancelled'];
  const weights = [0.2, 0.15, 0.25, 0.15, 0.15, 0.1];

  function pickStatus(): StorageStatus {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < statuses.length; i++) {
      cumulative += weights[i];
      if (r < cumulative) return statuses[i];
    }
    return 'pending';
  }

  return Array.from({ length: count }, (_, i) => {
    const id = `sto-${String(i + 1).padStart(4, '0')}`;
    const status = pickStatus();
    const pickupDriver = status !== 'pending' && status !== 'cancelled' ? rand(drivers) : null;
    const deliveryDriver = status === 'ready_for_delivery' || status === 'delivered' ? rand(drivers) : null;

    const createdAt = daysAgo(randInt(0, 28));
    const pickupAt = new Date(createdAt);
    pickupAt.setHours(pickupAt.getHours() + randInt(1, 48));
    const deliveryAt = new Date(pickupAt);
    deliveryAt.setDate(deliveryAt.getDate() + randInt(1, 14));

    const storageDays = randInt(1, 14);
    const priceCents = randInt(1500, 8000);
    const storageFeeCents = Math.round(priceCents * 0.3);

    const bags = {
      large: randInt(0, 3),
      carryon: randInt(0, 3),
      backpack: randInt(0, 2),
    };

    return {
      id,
      customer_id: `cust-${randInt(1000, 9999)}`,
      customer_name: name(),
      customer_email: `customer${randInt(1, 999)}@example.com`,
      customer_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      pickup_driver_id: pickupDriver?.id ?? null,
      delivery_driver_id: deliveryDriver?.id ?? null,
      status,
      luggage_description: `${bags.large + bags.carryon + bags.backpack} bags (${bags.large}L, ${bags.carryon}C, ${bags.backpack}B)`,
      promo_code: randBool(0.2) ? 'STORE20' : null,
      special_instructions: randBool(0.25) ? 'Store in climate controlled area' : null,
      storage_days: storageDays,
      storage_fee_cents: storageFeeCents,
      storage_start_date: status !== 'pending' ? pickupAt.toISOString() : null,
      storage_end_date: status === 'delivered' || status === 'ready_for_delivery' ? deliveryAt.toISOString() : null,
      pickup_address: `${randInt(100, 9999)} ${rand(['Market St', 'Mission St', 'Valencia St', 'Geary Blvd', 'Van Ness Ave'])}, San Francisco, CA`,
      pickup_latitude: 37.7749 + (Math.random() - 0.5) * 0.15,
      pickup_longitude: -122.4194 + (Math.random() - 0.5) * 0.15,
      pickup_at: pickupAt.toISOString(),
      pickup_contact_name: name(),
      pickup_contact_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      pickup_distance_miles: parseFloat((Math.random() * 10 + 1).toFixed(1)),
      pickup_fee_cents: randInt(500, 2500),
      delivery_address: `${randInt(100, 9999)} ${rand(['Hayes St', 'Folsom St', 'Howard St', 'Bryant St', 'Divisadero St'])}, San Francisco, CA`,
      delivery_latitude: 37.7749 + (Math.random() - 0.5) * 0.15,
      delivery_longitude: -122.4194 + (Math.random() - 0.5) * 0.15,
      delivery_at: deliveryAt.toISOString(),
      delivery_contact_name: name(),
      delivery_contact_phone: `+1-555-${String(randInt(1000, 9999)).padStart(4, '0')}`,
      delivery_distance_miles: parseFloat((Math.random() * 10 + 1).toFixed(1)),
      delivery_fee_cents: randInt(500, 2500),
      price_cents: priceCents,
      total_price_cents: priceCents + storageFeeCents,
      currency: 'USD',
      notes: randBool(0.3) ? 'Fragile items inside' : null,
      pickup_photo_url: null,
      storage_photo_url: null,
      delivery_photo_url: null,
      signature_url: null,
      picked_up_at: status !== 'pending' && status !== 'cancelled' ? pickupAt.toISOString() : null,
      delivered_at: status === 'delivered' ? deliveryAt.toISOString() : null,
      created_at: createdAt,
      updated_at: createdAt,
      bag_count_large: bags.large,
      bag_count_carryon: bags.carryon,
      bag_count_backpack: bags.backpack,
      pickup_driver_name: pickupDriver ? `${pickupDriver.first_name} ${pickupDriver.last_name}` : null,
      delivery_driver_name: deliveryDriver ? `${deliveryDriver.first_name} ${deliveryDriver.last_name}` : null,
    };
  });
}

export interface MockDataStore {
  drivers: Driver[];
  shipments: Shipment[];
  storage: Storage[];
}

export function createMockDataStore(): MockDataStore {
  const drivers = generateMockDrivers();
  return {
    drivers,
    shipments: generateMockShipments(drivers),
    storage: generateMockStorageOrders(drivers),
  };
}

// Global in-memory store reused across requests within the same isolate.
let globalStore: MockDataStore | null = null;

export function getMockDataStore(): MockDataStore {
  if (!globalStore) {
    globalStore = createMockDataStore();
  }
  return globalStore;
}

export function resetMockDataStore(): MockDataStore {
  globalStore = createMockDataStore();
  return globalStore;
}
