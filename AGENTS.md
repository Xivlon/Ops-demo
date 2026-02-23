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

### 2. JWT Authentication (Replaces PIN-in-URL)
Instead of `?pin=1234` in every URL:

```typescript
// Login POST /api/login → Sets HttpOnly cookie with JWT
// Subsequent requests → Cookie automatically sent
// JWT verified via authMiddleware
```

Benefits:
- No sensitive data in URLs (logs, browser history)
- Automatic token expiry
- Can revoke sessions server-side
- CSRF protection via SameSite cookies

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
   # Set secrets first
   wrangler secret put DATABASE_URL
   wrangler secret put JWT_SECRET
   
   # Then deploy
   npm run deploy
   ```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/login` | Login with PIN, sets JWT cookie |
| POST | `/api/logout` | Clear JWT cookie |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard HTML |
| GET | `/api/dashboard/stats` | Dashboard statistics |

### Shipments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shipments` | List shipments (with filters) |
| POST | `/api/shipments/:id/assign` | Assign driver to shipment |

### Drivers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/drivers` | Driver stats HTML |
| GET | `/api/drivers` | List all drivers |
| GET | `/api/drivers/online` | List online drivers |
| GET | `/api/drivers/stats` | Cached driver stats |
| GET | `/api/drivers/stats/live` | Live driver stats |
| POST | `/api/drivers/stats/refresh` | Refresh stats cache |

### Legacy (for migration)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/neon-query` | Direct SQL queries (PIN auth) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret key for JWT signing |
| `ADMIN_PIN` | Yes | PIN for initial authentication |
| `JWT_EXPIRY_HOURS` | No | JWT expiry (default: 24) |

## Security Considerations

1. **JWT Secret**: Must be cryptographically random (32+ bytes)
2. **ADMIN_PIN**: Change from default in production
3. **CORS**: Currently allows all origins (`*`) - restrict in production
4. **Rate Limiting**: Consider adding Cloudflare Rate Limiting rules
5. **Query Safety**: Repository layer  uses prepared statements

## Testing TypeScript

```bash
npm run check  # Type check only
npm run lint   # Type check + validation
```
