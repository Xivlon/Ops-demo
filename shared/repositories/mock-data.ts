// Deterministic in-memory mock data store for demo mode (no real database required).
// This mirrors the data produced by scripts/seed-mock-db.mjs so local development
// behaves consistently whether or not a Postgres container is running.
// Data persists for the lifetime of a single worker isolate.

import type {
  Shipment,
  Driver,
  Storage,
  DashboardStats,
  StorageStats,
} from '../types';

const STREETS = ['Market St', 'Mission St', 'Valencia St', 'Geary Blvd', 'Van Ness Ave', 'Hayes St', 'Folsom St', 'Howard St', 'Bryant St', 'Divisadero St'];
const AIRPORTS = ['JFK', 'LAX', 'ORD', 'MIA', 'SFO', 'DFW', 'SEA', 'BOS'];

function now() {
  return new Date().toISOString();
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursFrom(iso: string, n: number) {
  const d = new Date(iso);
  d.setHours(d.getHours() + n);
  return d.toISOString();
}

function daysFrom(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

// Target expiry ~3 months from Aug 7, 2026 (~Nov 7, 2026)
function threeMonthsOut(varianceHours = 0) {
  const d = new Date('2026-11-07T12:00:00Z');
  d.setHours(d.getHours() + varianceHours);
  return d.toISOString();
}

const DRIVERS: Driver[] = [
  { id: 'drv-001', email: 'alex.smith@opsdemo.dev', first_name: 'Alex', last_name: 'Smith', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Sedan', vehicle_plate: 'LUG1001', rating: 4.8, total_deliveries: 142, profile_photo_url: null, account_created_at: daysAgo(60 + 1), account_updated_at: daysAgo(5) },
  { id: 'drv-002', email: 'jordan.johnson@opsdemo.dev', first_name: 'Jordan', last_name: 'Johnson', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'SUV', vehicle_plate: 'LUG1002', rating: 4.6, total_deliveries: 98, profile_photo_url: null, account_created_at: daysAgo(60 + 2), account_updated_at: daysAgo(5) },
  { id: 'drv-003', email: 'taylor.williams@opsdemo.dev', first_name: 'Taylor', last_name: 'Williams', is_online: false, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Van', vehicle_plate: 'LUG1003', rating: 4.9, total_deliveries: 201, profile_photo_url: null, account_created_at: daysAgo(60 + 3), account_updated_at: daysAgo(5) },
  { id: 'drv-004', email: 'morgan.brown@opsdemo.dev', first_name: 'Morgan', last_name: 'Brown', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Truck', vehicle_plate: 'LUG1004', rating: 4.4, total_deliveries: 76, profile_photo_url: null, account_created_at: daysAgo(60 + 4), account_updated_at: daysAgo(5) },
  { id: 'drv-005', email: 'casey.jones@opsdemo.dev', first_name: 'Casey', last_name: 'Jones', is_online: false, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Sedan', vehicle_plate: 'LUG1005', rating: 4.7, total_deliveries: 115, profile_photo_url: null, account_created_at: daysAgo(60 + 5), account_updated_at: daysAgo(5) },
  { id: 'drv-006', email: 'riley.garcia@opsdemo.dev', first_name: 'Riley', last_name: 'Garcia', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'SUV', vehicle_plate: 'LUG1006', rating: 4.5, total_deliveries: 88, profile_photo_url: null, account_created_at: daysAgo(60 + 6), account_updated_at: daysAgo(5) },
  { id: 'drv-007', email: 'quinn.miller@opsdemo.dev', first_name: 'Quinn', last_name: 'Miller', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Van', vehicle_plate: 'LUG1007', rating: 4.8, total_deliveries: 167, profile_photo_url: null, account_created_at: daysAgo(60 + 7), account_updated_at: daysAgo(5) },
  { id: 'drv-008', email: 'avery.davis@opsdemo.dev', first_name: 'Avery', last_name: 'Davis', is_online: false, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Sedan', vehicle_plate: 'LUG1008', rating: 4.3, total_deliveries: 54, profile_photo_url: null, account_created_at: daysAgo(60 + 8), account_updated_at: daysAgo(5) },
  { id: 'drv-009', email: 'sam.rodriguez@opsdemo.dev', first_name: 'Sam', last_name: 'Rodriguez', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Truck', vehicle_plate: 'LUG1009', rating: 4.9, total_deliveries: 189, profile_photo_url: null, account_created_at: daysAgo(60 + 9), account_updated_at: daysAgo(5) },
  { id: 'drv-010', email: 'drew.martinez@opsdemo.dev', first_name: 'Drew', last_name: 'Martinez', is_online: false, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'SUV', vehicle_plate: 'LUG1010', rating: 4.2, total_deliveries: 63, profile_photo_url: null, account_created_at: daysAgo(60 + 10), account_updated_at: daysAgo(5) },
  { id: 'drv-011', email: 'jamie.hernandez@opsdemo.dev', first_name: 'Jamie', last_name: 'Hernandez', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Van', vehicle_plate: 'LUG1011', rating: 4.7, total_deliveries: 134, profile_photo_url: null, account_created_at: daysAgo(60 + 11), account_updated_at: daysAgo(5) },
  { id: 'drv-012', email: 'charlie.lopez@opsdemo.dev', first_name: 'Charlie', last_name: 'Lopez', is_online: true, phone: '+1-555-0000', current_latitude: 37.7749, current_longitude: -122.4194, vehicle_type: 'Sedan', vehicle_plate: 'LUG1012', rating: 4.6, total_deliveries: 112, profile_photo_url: null, account_created_at: daysAgo(60 + 12), account_updated_at: daysAgo(5) },
];

function shipment(i: number): Shipment {
  const statuses = [
    'PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING',
    'ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED',
    'IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT',
    'DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED',
    'CANCELLED','CANCELLED','CANCELLED'
  ] as const;
  const status = statuses[i];
  const driver = status !== 'PENDING' && status !== 'CANCELLED' ? DRIVERS[i % DRIVERS.length] : null;
  const origin = AIRPORTS[i % AIRPORTS.length];
  const destination = AIRPORTS[(i + 3) % AIRPORTS.length];
  const isFuturePending = status === 'PENDING' || status === 'ASSIGNED';
  const createdAt = isFuturePending ? daysAgo((i % 7) + 1) : daysAgo((i % 28) + 1);
  const pickupAt = isFuturePending ? threeMonthsOut((i % 48) - 24) : hoursFrom(createdAt, ((i % 12) + 2));
  const dropoffBy = hoursFrom(pickupAt, ((i % 8) + 3));
  const priceCents = 2500 + ((i * 347) % 12500);

  return {
    id: `shp-${String(i + 1).padStart(4, '0')}`,
    customer_id: `cust-${1000 + i}`,
    driver_id: driver?.id ?? null,
    luggage_id: `lug-${2000 + i}`,
    status,
    origin_airport: origin,
    destination_airport: destination,
    pickup_address: `${100 + (i * 97) % 9900} ${STREETS[i % STREETS.length]}, San Francisco, CA`,
    pickup_latitude: 37.7749 + ((i % 5) - 2) * 0.02,
    pickup_longitude: -122.4194 + ((i % 7) - 3) * 0.02,
    pickup_at: pickupAt,
    pickup_contact_name: `Pickup Contact ${i + 1}`,
    pickup_contact_phone: `+1-555-${String(1000 + (i * 7) % 9000).padStart(4, '0')}`,
    dropoff_address: `${100 + (i * 131) % 9900} ${STREETS[(i + 3) % STREETS.length]}, San Francisco, CA`,
    dropoff_latitude: 37.7749 + ((i % 6) - 2) * 0.02,
    dropoff_longitude: -122.4194 + ((i % 8) - 3) * 0.02,
    dropoff_by: dropoffBy,
    dropoff_contact_name: `Dropoff Contact ${i + 1}`,
    dropoff_contact_phone: `+1-555-${String(2000 + (i * 11) % 8000).padStart(4, '0')}`,
    distance_miles: parseFloat((2 + (i * 1.3) % 15).toFixed(1)),
    price_cents: priceCents,
    currency: 'USD',
    notes: i % 4 === 0 ? 'Handle with care' : null,
    pickup_photo_url: null,
    delivery_photo_url: null,
    signature_url: null,
    claimed_at: driver ? (isFuturePending ? createdAt : pickupAt) : null,
    picked_up_at: status === 'IN_TRANSIT' || status === 'DELIVERED' ? pickupAt : null,
    delivered_at: status === 'DELIVERED' ? dropoffBy : null,
    created_at: createdAt,
    updated_at: status === 'DELIVERED' || status === 'CANCELLED' ? dropoffBy : createdAt,
    customer_name: `Customer ${i + 1}`,
    customer_email: `customer${1000 + i}@example.com`,
    customer_phone: `+1-555-${String(3000 + (i * 13) % 7000).padStart(4, '0')}`,
    luggage_description: `${(i % 3) + 1} ${['carry-on', 'checked bag', 'large suitcase'][i % 3]}`,
    promo_code: i % 5 === 0 ? 'LUGGAGE10' : null,
    special_instructions: i % 3 === 0 ? 'Ring doorbell on arrival' : null,
    bknd: status === 'CANCELLED',
    driver_name: driver ? `${driver.first_name} ${driver.last_name}` : null,
  };
}

const SHIPMENTS = Array.from({ length: 35 }, (_, i) => shipment(i));

function storageOrder(i: number): Storage {
  const statuses = [
    'PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF',
    'PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP',
    'PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED',
    'DELIVERED','DELIVERED','DELIVERED','CANCELLED'
  ] as const;
  const status = statuses[i];
  const pickupDriver = status !== 'PENDING_DROPOFF' && status !== 'CANCELLED' ? DRIVERS[(i + 2) % DRIVERS.length] : null;
  const deliveryDriver = status === 'PICKUP_CONFIRMED' || status === 'DELIVERED' ? DRIVERS[(i + 5) % DRIVERS.length] : null;
  const isPendingStorage = status === 'PENDING_DROPOFF' || status === 'PENDING_PICKUP';

  const createdAt = daysAgo((i % 21) + 1);
  const pickupAt = hoursFrom(createdAt, ((i % 10) + 3));
  const deliveryAt = daysFrom(pickupAt, ((i % 10) + 2));
  const storageDays = (i % 14) + 1;
  const priceCents = 1500 + ((i * 251) % 6500);
  const storageFeeCents = Math.round(priceCents * 0.3);
  const bagL = i % 4;
  const bagC = (i + 1) % 3;
  const bagB = (i + 2) % 2;

  return {
    id: `sto-${String(i + 1).padStart(4, '0')}`,
    customer_id: `cust-${4000 + i}`,
    customer_name: `Storage Customer ${i + 1}`,
    customer_email: `storage${4000 + i}@example.com`,
    customer_phone: `+1-555-${String(5000 + (i * 17) % 5000).padStart(4, '0')}`,
    pickup_driver_id: pickupDriver?.id ?? null,
    delivery_driver_id: deliveryDriver?.id ?? null,
    status,
    luggage_description: `${bagL + bagC + bagB} bags (${bagL}L, ${bagC}C, ${bagB}B)`,
    promo_code: i % 6 === 0 ? 'STORE20' : null,
    special_instructions: i % 4 === 0 ? 'Store in climate controlled area' : null,
    storage_days: storageDays,
    storage_fee_cents: storageFeeCents,
    storage_start_date: status !== 'PENDING_DROPOFF' ? pickupAt : null,
    storage_end_date: isPendingStorage ? threeMonthsOut((i % 48) - 24) : (status === 'PICKUP_CONFIRMED' || status === 'DELIVERED' ? deliveryAt : null),
    pickup_address: `${100 + (i * 89) % 9900} ${STREETS[(i + 5) % STREETS.length]}, San Francisco, CA`,
    pickup_latitude: 37.7749 + ((i % 4) - 1) * 0.02,
    pickup_longitude: -122.4194 + ((i % 5) - 2) * 0.02,
    pickup_at: pickupAt,
    pickup_contact_name: `Pickup Contact ${i + 1}`,
    pickup_contact_phone: `+1-555-${String(6000 + (i * 19) % 4000).padStart(4, '0')}`,
    pickup_distance_miles: parseFloat((1 + (i * 0.9) % 10).toFixed(1)),
    pickup_fee_cents: 500 + ((i * 101) % 2000),
    delivery_address: `${100 + (i * 157) % 9900} ${STREETS[(i + 8) % STREETS.length]}, San Francisco, CA`,
    delivery_latitude: 37.7749 + ((i % 5) - 2) * 0.02,
    delivery_longitude: -122.4194 + ((i % 6) - 2) * 0.02,
    delivery_at: deliveryAt,
    delivery_contact_name: `Delivery Contact ${i + 1}`,
    delivery_contact_phone: `+1-555-${String(7000 + (i * 23) % 3000).padStart(4, '0')}`,
    delivery_distance_miles: parseFloat((1 + (i * 1.1) % 10).toFixed(1)),
    delivery_fee_cents: 500 + ((i * 137) % 2000),
    price_cents: priceCents,
    total_price_cents: priceCents + storageFeeCents,
    currency: 'USD',
    notes: i % 5 === 0 ? 'Fragile items inside' : null,
    pickup_photo_url: null,
    storage_photo_url: null,
    delivery_photo_url: null,
    signature_url: null,
    picked_up_at: status !== 'PENDING_DROPOFF' && status !== 'CANCELLED' ? pickupAt : null,
    delivered_at: status === 'DELIVERED' ? deliveryAt : null,
    created_at: createdAt,
    updated_at: createdAt,
    bag_count_large: bagL,
    bag_count_carryon: bagC,
    bag_count_backpack: bagB,
    pickup_driver_name: pickupDriver ? `${pickupDriver.first_name} ${pickupDriver.last_name}` : null,
    delivery_driver_name: deliveryDriver ? `${deliveryDriver.first_name} ${deliveryDriver.last_name}` : null,
  };
}

const STORAGE_ORDERS = Array.from({ length: 25 }, (_, i) => storageOrder(i));

export interface MockDataStore {
  drivers: Driver[];
  shipments: Shipment[];
  storage: Storage[];
}

export function createMockDataStore(): MockDataStore {
  return {
    drivers: DRIVERS,
    shipments: SHIPMENTS,
    storage: STORAGE_ORDERS,
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
