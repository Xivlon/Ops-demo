import type { Env } from '../types';
import { verifyJWT, extractJWT } from '../utils/jwt';
import { unauthorizedResponse } from '../utils/response';

export interface AuthenticatedRequest extends Request {
  jwt?: ReturnType<typeof verifyJWT> extends Promise<infer T> ? T : never;
}

export async function authMiddleware(
  request: Request,
  env: Env
): Promise<Response | null> {
  // Allow preflight requests
  if (request.method === 'OPTIONS') {
    return null;
  }

  // Public routes that don't require auth
  const url = new URL(request.url);
  const publicRoutes = ['/login', '/api/login', '/test'];
  
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
    return unauthorizedResponse();
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
    return unauthorizedResponse();
  }

  // Attach payload to request for downstream handlers
  (request as AuthenticatedRequest).jwt = payload;
  
  return null;
}

// Legacy PIN auth for migration/backup (can be removed after JWT is fully adopted)
export async function legacyPinAuth(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);
  const pin = url.searchParams.get('pin');
  return pin === env.ADMIN_PIN;
}
