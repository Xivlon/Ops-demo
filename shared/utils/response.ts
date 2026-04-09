import type { ApiResponse } from '../types';

export function jsonResponse<T>(data: ApiResponse<T>, status = 200, cors = true, requestOrigin: string | null = null): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Prevent caching of API responses
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
  
  if (cors) {
    // Must specify exact origin when using credentials (can't use *)
    // If no origin provided, use * (but credentials won't work)
    headers['Access-Control-Allow-Origin'] = requestOrigin || '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return new Response(JSON.stringify(data), { status, headers });
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function errorResponse(message: string, code: string, status = 400): Response {
  return jsonResponse({ success: false, error: message, code }, status);
}

export function unauthorizedResponse(message = 'Unauthorized'): Response {
  return errorResponse(message, 'UNAUTHORIZED', 401);
}

export function corsPreflightResponse(requestOrigin?: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': requestOrigin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Set JWT cookie helper
export function setJWTCookie(jwt: string, maxAgeHours = 24): string {
  const maxAge = maxAgeHours * 3600;
  return `token=${jwt}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/`;
}

// Clear JWT cookie helper  
export function clearJWTCookie(): string {
  return 'token=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/';
}
