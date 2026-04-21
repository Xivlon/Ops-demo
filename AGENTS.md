# Luggster Ops - Development Guide

## Architecture Overview

This is a Cloudflare Worker-based operations console for LuggageLink, using:
- **Runtime**: Cloudflare Workers (V8 isolates)
- **Database**: Neon PostgreSQL (serverless Postgres)
- **ORM/Connection**: `@neondatabase/serverless` Pool for connection pooling
- **Auth**: JWT-based authentication (stored in HttpOnly cookies)
- **Frontend**: Vanilla JS + Tailwind CSS (served as static HTML)

## Project Structure

```
src/
├── index.ts                 # Worker entry point (request routing)
├── types/                   # TypeScript type definitions
│   └── index.ts
├── repositories/            # Data access layer (replaces raw SQL)
│   ├── base.ts             # Base repository class
│   ├── shipments.ts        # Shipment queries
│   ├── drivers.ts          # Driver queries & stats
│   └── index.ts            # Repository factory
├── middleware/             # Request middleware
│   └── auth.ts            # JWT authentication
├── utils/                  # Utility functions
│   ├── jwt.ts             # JWT create/verify
│   ├── response.ts        # HTTP response helpers
│   └── html-loader.ts     # HTML template loader
└── generated/             # Auto-generated files
    └── html-templates.ts  # Inlined HTML templates

templates/                  # HTML source files
├── dashboard.html
├── driver-stats.html
└── login.html

scripts/
└── build-html.ts          # Build script to inline HTML
```

## Key Changes from v1.x

### 1. Repository Pattern (Replaces Raw SQL)
Instead of raw SQL queries scattered throughout handlers:

```typescript
// Before
const result = await sql`SELECT * FROM shipments WHERE id = ${id}`;

// After
const shipment = await repos.shipments.findById(id);
```

Benefits:
- Type-safe database operations
- Centralized query logic
- Easier to test and maintain
- Prepared statements for security

### 2. JWT Authentication with Role-Based Access
Instead of a single `?pin=1234` in every URL, we use 3 role-based PINs:

```typescript
// ROLES = {"admin":"847291","storage":"563204","transport":"918473"}
// Login POST /api/login → Validates PIN against ROLES map
//                   → Sets HttpOnly cookie with JWT (role claim)
// Subsequent requests → Cookie automatically sent
//                   → JWT verified + role checked per route
```

Benefits:
- No sensitive data in URLs (logs, browser history)
- Automatic token expiry
- Can revoke sessions server-side by rotating ROLES secret
- CSRF protection via SameSite cookies
- Granular access: storage staff can't touch transport data, and vice versa

### 3. Connection Pooling with Neon Pool
Instead of creating connections per request:

```typescript
// Pool is created once per worker and reused
const pool = new Pool({ connectionString: env.DATABASE_URL });
const client = await pool.connect();
try {
  const result = await client.query(sql, params);
} finally {
  client.release();
}
```

Benefits:
- Efficient connection reuse
- Better performance under load
- Automatic connection management

### 4. HTML Template Build Step
HTML files are kept separate in `templates/` during development, then inlined at build:

```bash
npm run build:html  # Generates src/generated/html-templates.ts
```

Benefits:
- Syntax highlighting and IDE support for HTML
- Separate concerns (logic vs presentation)
- Type-safe imports in TypeScript

## Development Workflow

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. **Build HTML templates** (required before dev/deploy)
   ```bash
   npm run build:html
   ```

4. **Run locally**
   ```bash
   npm run dev
   ```

5. **Deploy**
   ```bash
   # Set secrets first (NEVER commit these to version control)
   wrangler secret put DATABASE_URL
   wrangler secret put JWT_SECRET
   wrangler secret put ROLES
   
   # Then deploy
   npm run deploy
   ```

## API Endpoints

### Authentication
| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/api/login` | Login with PIN, sets JWT cookie | Any valid PIN |
| POST | `/api/logout` | Clear JWT cookie | Any |

### Dashboard (Admin Only)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard HTML |
| GET | `/api/dashboard/stats` | Dashboard statistics |
| GET | `/api/reports/*` | Revenue, earnings, driver reports |
| GET | `/api/export/*` | CSV/JSON exports |

### Shipments & Transport (Admin + Transport)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/drivers` | Driver stats HTML page |
| GET | `/api/shipments` | List shipments (with filters) |
| POST | `/api/shipments/:id/assign` | Assign driver to shipment |
| POST | `/api/shipments/:id/cancel` | Cancel shipment |
| GET | `/api/drivers` | List all drivers |
| GET | `/api/drivers/online` | List online drivers |
| GET | `/api/drivers/stats` | Cached driver stats |
| GET | `/api/drivers/stats/enhanced` | Enhanced driver statistics |

### Storage (Admin + Storage)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/storage` | Storage operations HTML page |
| GET | `/api/storage` | List storage orders |
| GET | `/api/storage/stats` | Storage statistics |
| POST | `/api/storage/:id/assign-pickup` | Assign pickup driver |
| POST | `/api/storage/:id/assign-delivery` | Assign delivery driver |
| POST | `/api/storage/:id/confirm-pickup` | Confirm pickup |
| POST | `/api/storage/:id/confirm-dropoff` | Confirm dropoff |
| POST | `/api/storage/:id/status` | Update storage status |
| POST | `/api/storage/:id/cancel` | Cancel storage order |

### Legacy (for migration)
| Method | Endpoint | Description | Roles |
|--------|----------|-------------|-------|
| POST | `/api/neon-query` | Direct SQL queries | Admin only |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `ROLES` | Yes | JSON map of role→PIN: `{"admin":"...","storage":"...","transport":"..."}` |
| `JWT_EXPIRY_HOURS` | No | JWT expiry (default: 24) |

## Security Considerations

1. **Secrets in `wrangler.toml`**: Never put `DATABASE_URL`, `JWT_SECRET`, `ROLES`, or `PIN_PEPPER` in `[vars]`. Use `wrangler secret put` or `.dev.vars` (gitignored).
2. **JWT Secret**: Must be cryptographically random (32+ bytes)
3. **PIN Hashing (strongly recommended)**: Set `PIN_PEPPER` and store HMAC-SHA256 hashes in `ROLES` instead of plaintext PINs. See `.env.example` for migration instructions.
4. **CORS**: Currently allows all origins (`*`) - restrict in production
5. **Rate Limiting**: Login attempts are rate-limited in-memory (5 per 15 min per IP). For stronger protection, add Cloudflare Rate Limiting rules.
6. **Query Safety**: Repository layer uses prepared statements. The `/api/neon-query` legacy endpoint is admin-only but allows raw `UPDATE` — remove it if not needed.
7. **Defense in depth**: Sub-workers (storage, driver-stats) independently verify JWTs and roles, even when proxied through the main worker.
8. **Public endpoints**: `/ping` and `/health` are public. `/test` is no longer public (removed from unauthenticated access).
9. **Worker URLs**: Hardcoded internal worker URLs have been moved to optional environment variables.

## Testing TypeScript

```bash
npm run check  # Type check only
npm run lint   # Type check + validation
```
