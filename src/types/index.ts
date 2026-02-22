// Environment bindings
export interface Env {
  ADMIN_PIN: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRY_HOURS?: string;
}

// JWT Payload
export interface JWTPayload {
  sub: string;
  iat: number;
  exp: number;
  role: 'admin';
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  meta?: Record<string, unknown>;
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
  // Joined fields
  driver_name?: string | null;
  urgency?: UrgencyLevel;
}

export type ShipmentStatus = 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';

// Driver types - matching Neon schema
export interface Driver {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_online: boolean;
  user_type: string;
  phone: string | null;
  username: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  vehicle_type: string | null;
  vehicle_plate: string | null;
  rating: number | null;
  total_deliveries: number;
  profile_photo_url: string | null;
  account_created_at: string;
  account_updated_at: string;
}

export interface DriverStats {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_online: boolean;
  phone: string | null;
  account_created_at: string;
  total_assigned: number;
  pending_count: number;
  assigned_count: number;
  in_transit_count: number;
  total_completed: number;
  cancelled_count: number;
  total_revenue: number;
  week_completed: number;
  month_completed: number;
  success_rate: number | null;
  avg_rating: number;
}

// Dashboard stats
export interface DashboardStats {
  pending: number;
  assigned: number;
  picked_up: number;
  delivered: number;
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
