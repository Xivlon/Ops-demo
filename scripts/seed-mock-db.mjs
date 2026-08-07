#!/usr/bin/env node
/**
 * Seed the local PostgreSQL mock database with deterministic demo data.
 *
 * Expects DATABASE_URL to be set, e.g.:
 *   DATABASE_URL=postgresql://opsdemo:opsdemo@localhost:5433/opsdemo node scripts/seed-mock-db.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://opsdemo:opsdemo@localhost:5433/opsdemo';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

function now() {
  return new Date().toISOString();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursFrom(iso, n) {
  const d = new Date(iso);
  d.setHours(d.getHours() + n);
  return d.toISOString();
}

function daysFrom(iso, n) {
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

const DRIVERS = [
  { id: 'drv-001', first_name: 'Alex', last_name: 'Smith', is_online: true, vehicle_type: 'Sedan', vehicle_plate: 'LUG1001', rating: 4.8, total_deliveries: 142 },
  { id: 'drv-002', first_name: 'Jordan', last_name: 'Johnson', is_online: true, vehicle_type: 'SUV', vehicle_plate: 'LUG1002', rating: 4.6, total_deliveries: 98 },
  { id: 'drv-003', first_name: 'Taylor', last_name: 'Williams', is_online: false, vehicle_type: 'Van', vehicle_plate: 'LUG1003', rating: 4.9, total_deliveries: 201 },
  { id: 'drv-004', first_name: 'Morgan', last_name: 'Brown', is_online: true, vehicle_type: 'Truck', vehicle_plate: 'LUG1004', rating: 4.4, total_deliveries: 76 },
  { id: 'drv-005', first_name: 'Casey', last_name: 'Jones', is_online: false, vehicle_type: 'Sedan', vehicle_plate: 'LUG1005', rating: 4.7, total_deliveries: 115 },
  { id: 'drv-006', first_name: 'Riley', last_name: 'Garcia', is_online: true, vehicle_type: 'SUV', vehicle_plate: 'LUG1006', rating: 4.5, total_deliveries: 88 },
  { id: 'drv-007', first_name: 'Quinn', last_name: 'Miller', is_online: true, vehicle_type: 'Van', vehicle_plate: 'LUG1007', rating: 4.8, total_deliveries: 167 },
  { id: 'drv-008', first_name: 'Avery', last_name: 'Davis', is_online: false, vehicle_type: 'Sedan', vehicle_plate: 'LUG1008', rating: 4.3, total_deliveries: 54 },
  { id: 'drv-009', first_name: 'Sam', last_name: 'Rodriguez', is_online: true, vehicle_type: 'Truck', vehicle_plate: 'LUG1009', rating: 4.9, total_deliveries: 189 },
  { id: 'drv-010', first_name: 'Drew', last_name: 'Martinez', is_online: false, vehicle_type: 'SUV', vehicle_plate: 'LUG1010', rating: 4.2, total_deliveries: 63 },
  { id: 'drv-011', first_name: 'Jamie', last_name: 'Hernandez', is_online: true, vehicle_type: 'Van', vehicle_plate: 'LUG1011', rating: 4.7, total_deliveries: 134 },
  { id: 'drv-012', first_name: 'Charlie', last_name: 'Lopez', is_online: true, vehicle_type: 'Sedan', vehicle_plate: 'LUG1012', rating: 4.6, total_deliveries: 112 },
];

function driverEmail(d) {
  return `${d.first_name.toLowerCase()}.${d.last_name.toLowerCase()}@opsdemo.dev`;
}

const STREETS = ['Market St', 'Mission St', 'Valencia St', 'Geary Blvd', 'Van Ness Ave', 'Hayes St', 'Folsom St', 'Howard St', 'Bryant St', 'Divisadero St'];
const AIRPORTS = ['JFK', 'LAX', 'ORD', 'MIA', 'SFO', 'DFW', 'SEA', 'BOS'];

function shipment(i) {
  const statuses = [
    'PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING','PENDING',
    'ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED','ASSIGNED',
    'IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT','IN_TRANSIT',
    'DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED','DELIVERED',
    'CANCELLED','CANCELLED','CANCELLED'
  ];
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
  };
}

const SHIPMENTS = Array.from({ length: 35 }, (_, i) => shipment(i));

function storageOrder(i) {
  const statuses = [
    'PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF','PENDING_DROPOFF',
    'PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP','PENDING_PICKUP',
    'PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED','PICKUP_CONFIRMED',
    'DELIVERED','DELIVERED','DELIVERED','CANCELLED'
  ];
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
  };
}

const STORAGE_ORDERS = Array.from({ length: 25 }, (_, i) => storageOrder(i));

const SCHEMA_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_status') THEN
    CREATE TYPE shipment_status AS ENUM ('PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_status') THEN
    CREATE TYPE storage_status AS ENUM ('PENDING_DROPOFF', 'PENDING_PICKUP', 'PICKUP_CONFIRMED', 'DELIVERED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS driver_profiles (
  id TEXT PRIMARY KEY,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  is_online BOOLEAN DEFAULT false,
  phone TEXT,
  current_latitude NUMERIC(10,7),
  current_longitude NUMERIC(10,7),
  vehicle_type TEXT,
  vehicle_plate TEXT,
  rating NUMERIC(3,2),
  total_deliveries INTEGER DEFAULT 0,
  profile_photo_url TEXT,
  account_created_at TIMESTAMPTZ DEFAULT NOW(),
  account_updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  driver_id TEXT REFERENCES driver_profiles(id),
  luggage_id TEXT,
  status shipment_status NOT NULL DEFAULT 'PENDING',
  origin_airport TEXT,
  destination_airport TEXT,
  pickup_address TEXT,
  pickup_latitude NUMERIC(10,7),
  pickup_longitude NUMERIC(10,7),
  pickup_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pickup_contact_name TEXT,
  pickup_contact_phone TEXT,
  dropoff_address TEXT,
  dropoff_latitude NUMERIC(10,7),
  dropoff_longitude NUMERIC(10,7),
  dropoff_by TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dropoff_contact_name TEXT,
  dropoff_contact_phone TEXT,
  distance_miles NUMERIC(5,1),
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  pickup_photo_url TEXT,
  delivery_photo_url TEXT,
  signature_url TEXT,
  claimed_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  luggage_description TEXT,
  promo_code TEXT,
  special_instructions TEXT,
  bknd BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS storage (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  pickup_driver_id TEXT REFERENCES driver_profiles(id),
  delivery_driver_id TEXT REFERENCES driver_profiles(id),
  status storage_status NOT NULL DEFAULT 'PENDING_DROPOFF',
  luggage_description TEXT,
  promo_code TEXT,
  special_instructions TEXT,
  storage_days INTEGER DEFAULT 0,
  storage_fee_cents INTEGER DEFAULT 0,
  storage_start_date TIMESTAMPTZ,
  storage_end_date TIMESTAMPTZ,
  pickup_address TEXT,
  pickup_latitude NUMERIC(10,7),
  pickup_longitude NUMERIC(10,7),
  pickup_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pickup_contact_name TEXT,
  pickup_contact_phone TEXT,
  pickup_distance_miles NUMERIC(5,1),
  pickup_fee_cents INTEGER,
  delivery_address TEXT,
  delivery_latitude NUMERIC(10,7),
  delivery_longitude NUMERIC(10,7),
  delivery_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_contact_name TEXT,
  delivery_contact_phone TEXT,
  delivery_distance_miles NUMERIC(5,1),
  delivery_fee_cents INTEGER,
  price_cents INTEGER NOT NULL DEFAULT 0,
  total_price_cents INTEGER,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  pickup_photo_url TEXT,
  storage_photo_url TEXT,
  delivery_photo_url TEXT,
  signature_url TEXT,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  bag_count_large INTEGER DEFAULT 0,
  bag_count_carryon INTEGER DEFAULT 0,
  bag_count_backpack INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS driver_stats (
  id TEXT PRIMARY KEY REFERENCES driver_profiles(id) ON DELETE CASCADE,
  total_assigned INTEGER DEFAULT 0,
  pending_count INTEGER DEFAULT 0,
  assigned_count INTEGER DEFAULT 0,
  in_transit_count INTEGER DEFAULT 0,
  total_completed INTEGER DEFAULT 0,
  cancelled_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  week_completed INTEGER DEFAULT 0,
  week_failed INTEGER DEFAULT 0,
  month_completed INTEGER DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  week_revenue NUMERIC(12,2) DEFAULT 0,
  month_revenue NUMERIC(12,2) DEFAULT 0,
  success_rate NUMERIC(5,2),
  cancel_rate NUMERIC(5,2),
  avg_rating NUMERIC(3,2),
  rating_count INTEGER DEFAULT 0,
  stats_updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function run() {
  try {
    console.log('Setting up schema...');
    await pool.query(SCHEMA_SQL);

    console.log('Clearing existing mock data...');
    await pool.query('TRUNCATE driver_profiles, shipments, storage, driver_stats CASCADE;');

    console.log(`Inserting ${DRIVERS.length} drivers...`);
    for (const d of DRIVERS) {
      await pool.query(
        `INSERT INTO driver_profiles
          (id, email, first_name, last_name, is_online, phone, current_latitude, current_longitude, vehicle_type, vehicle_plate, rating, total_deliveries, account_created_at, account_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [d.id, driverEmail(d), d.first_name, d.last_name, d.is_online, '+1-555-0000', 37.7749, -122.4194, d.vehicle_type, d.vehicle_plate, d.rating, d.total_deliveries, daysAgo(60 + parseInt(d.id.slice(-3), 10)), daysAgo(5)]
      );
    }

    console.log(`Inserting ${SHIPMENTS.length} shipments...`);
    for (const s of SHIPMENTS) {
      const cols = Object.keys(s);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `INSERT INTO shipments (${cols.join(',')}) VALUES (${placeholders})`,
        cols.map(c => s[c])
      );
    }

    console.log(`Inserting ${STORAGE_ORDERS.length} storage orders...`);
    for (const s of STORAGE_ORDERS) {
      const cols = Object.keys(s);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await pool.query(
        `INSERT INTO storage (${cols.join(',')}) VALUES (${placeholders})`,
        cols.map(c => s[c])
      );
    }

    console.log('Computing driver stats...');
    await pool.query(`
      INSERT INTO driver_stats (
        id, total_assigned, pending_count, assigned_count, in_transit_count,
        total_completed, cancelled_count, failed_count, week_completed, week_failed,
        month_completed, total_revenue, week_revenue, month_revenue,
        success_rate, cancel_rate, avg_rating, rating_count, stats_updated_at
      )
      SELECT
        dp.id,
        COUNT(DISTINCT s.id) AS total_assigned,
        COUNT(DISTINCT CASE WHEN s.status = 'PENDING' THEN s.id END) AS pending_count,
        COUNT(DISTINCT CASE WHEN s.status = 'ASSIGNED' THEN s.id END) AS assigned_count,
        COUNT(DISTINCT CASE WHEN s.status = 'IN_TRANSIT' THEN s.id END) AS in_transit_count,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' THEN s.id END) AS total_completed,
        COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' THEN s.id END) AS cancelled_count,
        0 AS failed_count,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.id END) AS week_completed,
        0 AS week_failed,
        COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.id END) AS month_completed,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' THEN s.price_cents ELSE 0 END), 0) / 100.0 AS total_revenue,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '7 days' THEN s.price_cents ELSE 0 END), 0) / 100.0 AS week_revenue,
        COALESCE(SUM(CASE WHEN s.status = 'DELIVERED' AND s.updated_at > NOW() - INTERVAL '30 days' THEN s.price_cents ELSE 0 END), 0) / 100.0 AS month_revenue,
        CASE
          WHEN COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('DELIVERED','CANCELLED')) > 0
          THEN ROUND((COUNT(DISTINCT CASE WHEN s.status = 'DELIVERED' THEN s.id END)::numeric / COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('DELIVERED','CANCELLED'))) * 100, 1)
          ELSE NULL
        END AS success_rate,
        CASE
          WHEN COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('DELIVERED','CANCELLED')) > 0
          THEN ROUND((COUNT(DISTINCT CASE WHEN s.status = 'CANCELLED' THEN s.id END)::numeric / COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('DELIVERED','CANCELLED'))) * 100, 1)
          ELSE NULL
        END AS cancel_rate,
        dp.rating AS avg_rating,
        dp.total_deliveries AS rating_count,
        NOW() AS stats_updated_at
      FROM driver_profiles dp
      LEFT JOIN shipments s ON s.driver_id = dp.id
      GROUP BY dp.id, dp.rating, dp.total_deliveries;
    `);

    console.log('Mock database seeded successfully.');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
