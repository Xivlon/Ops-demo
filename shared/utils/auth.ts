import type { Env } from '../types';
import { verifyJWT, extractJWT } from '../utils/jwt';
import { unauthorizedResponse, errorResponse } from '../utils/response';

export interface AuthenticatedRequest extends Request {
  jwt?: ReturnType<typeof verifyJWT> extends Promise<infer T> ? T : never;
}

/** Parse the ROLES JSON secret into a role->pin map */
export function parseRoles(env: Env): Record<string, string> {
  try {
    return JSON.parse(env.ROLES || '{}');
  } catch {
    return {};
  }
}

/** Hash a PIN using HMAC-SHA256 with a pepper */
async function hashPin(pin: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(pin));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** Validate a PIN against the ROLES map. Returns the matched role or null. */
export async function validatePin(pin: string, env: Env): Promise<string | null> {
  const roles = parseRoles(env);

  // If PIN_PEPPER is configured, use hashed comparison (secure mode)
  if (env.PIN_PEPPER) {
    const inputHash = await hashPin(pin, env.PIN_PEPPER);
    for (const [role, rolePinHash] of Object.entries(roles)) {
      if (rolePinHash === inputHash) return role;
    }
    return null;
  }

  // Fallback to plaintext comparison (backward compatibility — migrate to PIN_PEPPER!)
  console.warn('[SECURITY] PIN_PEPPER is not set. PINs are being compared in plaintext. Set PIN_PEPPER and hash your ROLES secret.');
  for (const [role, rolePin] of Object.entries(roles)) {
    if (rolePin === pin) return role;
  }
  return null;
}

/** Generate hashed ROLES JSON for a given pepper (run locally to migrate) */
export async function generateHashedRoles(roles: Record<string, string>, pepper: string): Promise<Record<string, string>> {
  const hashed: Record<string, string> = {};
  for (const [role, pin] of Object.entries(roles)) {
    hashed[role] = await hashPin(pin, pepper);
  }
  return hashed;
}

/** Get the role from the authenticated request */
export function getRole(request: Request): string | null {
  const jwt = (request as AuthenticatedRequest).jwt;
  return jwt?.role || null;
}

/** Check if the request's role is in the allowed list. Returns a Response if denied, null if allowed. */
export function requireRole(request: Request, allowedRoles: string[]): Response | null {
  const role = getRole(request);
  if (!role || !allowedRoles.includes(role)) {
    return unauthorizedResponse('Insufficient permissions');
  }
  return null;
}

export async function authMiddleware(
  request: Request,
  env: Env
): Promise<Response | null> {
  try {
    // Allow preflight requests
    if (request.method === 'OPTIONS') {
      return null;
    }

    // Public routes that don't require auth
    const url = new URL(request.url);
    const publicRoutes = ['/login', '/api/login', '/ping'];
    
    if (publicRoutes.includes(url.pathname)) {
      return null;
    }

    // Check for JWT token
    const token = extractJWT(request);
    
    if (!token) {
      // For HTML routes, redirect to login
      if (request.headers.get('Accept')?.includes('text/html')) {
        return new Response(null, {
          status: 302,
          headers: { Location: '/login' },
        });
      }
      return unauthorizedResponse('Authentication required');
    }

    const payload = await verifyJWT(token, env);
    
    if (!payload) {
      if (request.headers.get('Accept')?.includes('text/html')) {
        return new Response(null, {
          status: 302,
          headers: { 
            Location: '/login',
            'Set-Cookie': 'token=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/'
          },
        });
      }
      return unauthorizedResponse('Invalid or expired token');
    }

    // Attach payload to request for downstream handlers
    (request as AuthenticatedRequest).jwt = payload;
    
    return null;
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    // Check if it's a JWT verification error
    if (error instanceof Error && (error.message.includes('JWT') || error.message.includes('token'))) {
      return unauthorizedResponse('Invalid authentication token');
    }
    
    // For other errors, return 500
    return errorResponse(
      'Authentication system error',
      'AUTH_SYSTEM_ERROR',
      500
    );
  }
}
