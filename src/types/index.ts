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

// Shipment types
export interface Shipment {
  id: string;
  created_at: string;
  status: ShipmentStatus;
  driver_id: string | null;
  origin_airport: string;
  destination_airport: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_photo_url: string | null;
  delivery_photo_url: string | null;
  price_cents: number;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  luggage_description: string | null;
  special_instructions: string | null;
  driver_name?: string | null;
  pickup_at?: string | null;    // Scheduled pickup time
  dropoff_by?: string | null;   // Scheduled dropoff time
  urgency?: UrgencyLevel;       // Calculated urgency level
}

export type UrgencyLevel = 'OVERDUE' | 'CRITICAL' | 'WARNING' | 'NORMAL' | 'FAILED';

export interface UrgencyConfig {
  level: UrgencyLevel;
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
}

export type ShipmentStatus = 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';

// Driver types
export interface Driver {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_online: boolean;
  user_type: 'driver';
  account_created_at: string;
  account_updated_at: string;
}

export interface DriverStats {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_online: boolean;
  driver_joined: string | null;
  total_assigned: number;
  pending_count: number;
  assigned_count: number;
  in_transit_count: number;
  total_completed: number;
  cancelled_count: number;
  failed_count: number;
  total_failed: number;
  week_completed: number;
  week_failed: number;
  month_completed: number;
  month_failed: number;
  total_revenue: number;
  week_revenue: number;
  month_revenue: number;
  last_active: string | null;
  success_rate: number | null;
  cancel_rate: number | null;
  week_success_rate: number | null;
  week_cancel_rate: number | null;
  month_success_rate: number | null;
  month_cancel_rate: number | null;
  avg_rating: number;
  rating_count: number;
  stats_updated_at: string;
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


