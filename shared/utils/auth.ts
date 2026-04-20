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

/** Validate a PIN against the ROLES map. Returns the matched role or null. */
export function validatePin(pin: string, env: Env): string | null {
  const roles = parseRoles(env);
  for (const [role, rolePin] of Object.entries(roles)) {
    if (rolePin === pin) return role;
  }
  return null;
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
    const publicRoutes = ['/login', '/api/login', '/test', '/ping'];
    
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
