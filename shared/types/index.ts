// Environment bindings
export interface Env {
  ROLES: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRY_HOURS?: string;
  PIN_PEPPER?: string; // Optional: secret for hashing PINs (recommended)
  DRIVER_STATS_WORKER_URL?: string; // Optional: URL for driver stats worker
  STORAGE_WORKER_URL?: string; // Optional: URL for storage worker
}

// JWT Payload
export interface JWTPayload {
  sub: string;
  iat: number;
  exp: number;
  role: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

// Shipment types - matching Neon schema
export interface Shipment {
  id: string;
  customer_id: string;
  driver_id: string | null;
  luggage_id: string | null;
  status: ShipmentStatus;
  origin_airport: string | null;
  destination_airport: string | null;
  pickup_address: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  pickup_at: string;  // NOT NULL - timestamp with time zone
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  dropoff_address: string | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  dropoff_by: string;  // NOT NULL - timestamp with time zone
  dropoff_contact_name: string | null;
  dropoff_contact_phone: string | null;
  distance_miles: number | null;
  price_cents: number;
  currency: string | null;
  notes: string | null;
  pickup_photo_url: string | null;
  delivery_photo_url: string | null;
  signature_url: string | null;
  claimed_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  luggage_description: string | null;
  promo_code: string | null;
  special_instructions: string | null;
  bknd: boolean;  // Backend/internal flag for cancelled orders
  // Joined fields
  driver_name?: string | null;
  urgency?: UrgencyLevel;
}

export type ShipmentStatus = 'PENDING' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';

// Driver types - matching Neon schema
export interface Driver {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_online: boolean;
  user_type?: string;
  phone: string | null;
  username?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  vehicle_type?: string | null;
  vehicle_plate?: string | null;
  rating?: number | null;
  total_deliveries?: number;
  profile_photo_url?: string | null;
  account_created_at?: string;
  account_updated_at?: string;
}

// Simplified DriverStats for the getLiveStats method
export interface DriverStats {
  total_drivers: number;
  online_drivers: number;
  offline_drivers: number;
  top_driver: {
    id: string;
    name: string;
    deliveries: number;
  } | null;
}

// Enhanced driver stats with more details
export interface EnhancedDriverStats {
  total: number;
  online: number;
  offline: number;
  topDriver: {
    id: string;
    name: string;
    deliveries: number;
    rating: number | null;
    vehicle: string | null;
  } | null;
  vehicleBreakdown: Record<string, number>;
  averageRating: number;
}

// Dashboard stats
export interface DashboardStats {
  pending: number;
  assigned: number;
  picked_up: number;
  delivered: number;
  cancelled: number;
  total_revenue: number;
  online_drivers: number;
  total_drivers: number;
}

// Urgency types
export type UrgencyLevel = 'OVERDUE' | 'CRITICAL' | 'WARNING' | 'NORMAL' | 'FAILED';

export interface UrgencyConfig {
  level: UrgencyLevel;
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
}

// Query parameters
export interface ListShipmentsParams {
  status?: ShipmentStatus;
  limit?: number;
  days?: number;
}

export interface AssignDriverParams {
  shipmentId: string;
  driverId: string;
}

// Request body types
export interface LoginRequest {
  pin: string;
}

// Storage types - matching Neon schema
export interface Storage {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  pickup_driver_id: string | null;
  delivery_driver_id: string | null;
  status: StorageStatus;
  luggage_description: string | null;
  promo_code: string | null;
  special_instructions: string | null;
  storage_days: number;
  storage_fee_cents: number;
  storage_start_date: string | null;
  storage_end_date: string | null;
  pickup_address: string | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  pickup_at: string;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  pickup_distance_miles: number | null;
  pickup_fee_cents: number | null;
  delivery_address: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_at: string;
  delivery_contact_name: string | null;
  delivery_contact_phone: string | null;
  delivery_distance_miles: number | null;
  delivery_fee_cents: number | null;
  price_cents: number;
  total_price_cents: number | null;
  currency: string | null;
  notes: string | null;
  pickup_photo_url: string | null;
  storage_photo_url: string | null;
  delivery_photo_url: string | null;
  signature_url: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  // Bag counts
  bag_count_large: number | null;
  bag_count_carryon: number | null;
  bag_count_backpack: number | null;
  // Joined fields
  pickup_driver_name?: string | null;
  delivery_driver_name?: string | null;
}

export type StorageStatus = 'pending' | 'picked_up' | 'in_storage' | 'ready_for_delivery' | 'delivered' | 'cancelled';

export interface StorageStats {
  pending: number;
  picked_up: number;
  in_storage: number;
  ready_for_delivery: number;
  delivered: number;
  cancelled: number;
  total_bags: number;
  total_revenue: number;
}

export interface ListStorageParams {
  status?: StorageStatus;
  limit?: number;
  days?: number;
}
