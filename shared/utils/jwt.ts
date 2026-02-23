import type { Env, JWTPayload } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Simple base64url encoding/decoding
function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const arr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): ArrayBuffer {
  const base64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + (4 - (str.length % 4)) % 4, '=');
  const bytes = atob(base64).split('').map(c => c.charCodeAt(0));
  return new Uint8Array(bytes).buffer;
}

// HMAC-SHA256 signature
async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(signature);
}

// Verify HMAC-SHA256 signature
async function verify(data: string, signature: string, secret: string): Promise<boolean> {
  const expectedSig = await sign(data, secret);
  // Constant-time comparison
  if (signature.length !== expectedSig.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return result === 0;
}

export async function createJWT(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiryHours = parseInt(env.JWT_EXPIRY_HOURS || '24', 10);
  
  const payload: JWTPayload = {
    sub: 'admin',
    iat: now,
    exp: now + (expiryHours * 3600),
    role: 'admin'
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = await sign(signingInput, env.JWT_SECRET);
  
  return `${signingInput}.${signature}`;
}

export async function verifyJWT(token: string, env: Env): Promise<JWTPayload | null> {
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    
    if (!headerB64 || !payloadB64 || !signature) {
      return null;
    }

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const isValid = await verify(signingInput, signature, env.JWT_SECRET);
    
    if (!isValid) {
      return null;
    }

    // Parse payload
    const payloadArray = new Uint8Array(base64UrlDecode(payloadB64));
    const payloadJson = decoder.decode(payloadArray);
    const payload = JSON.parse(payloadJson) as JWTPayload;
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// Extract JWT from request (cookie or Authorization header)
export function extractJWT(request: Request): string | null {
  // Try Authorization header first
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Try cookie
  const cookie = request.headers.get('Cookie');
  if (cookie) {
    const match = cookie.match(/token=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}
