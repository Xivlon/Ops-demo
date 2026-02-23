# Driver Stats Worker Deployment Guide

This guide explains how to deploy and configure the separate driver stats worker.

## Architecture Overview

We now have two Cloudflare Workers:

1. **Main Worker** (`luggster-ops`)
   - Handles authentication, dashboard, shipments, and general operations
   - Routes: `ops.luggster.com/*`
   - File: `src/index.ts`
   - Config: `wrangler.toml`

2. **Driver Stats Worker** (`driver-stats`)
   - Handles all driver statistics queries
   - Routes: `driver-stats.luggster.com/*`
   - File: `src/driver-stats-worker.ts`
   - Config: `wrangler.driver-stats.toml`

## Local Development

### Option 1: Run both workers simultaneously
```bash
# Install dependencies
npm install

# Build HTML templates
npm run build:html

# Run both workers (requires concurrently)
npm run dev:all
```

### Option 2: Run workers separately
```bash
# Terminal 1: Main worker
npm run dev

# Terminal 2: Stats worker
npm run dev:stats
```

### Test the setup
```bash
# Run test script (after workers are running)
node scripts/test-driver-stats.js
```

## Production Deployment

### Step 1: Configure Environment Variables

Set secrets for both workers:

```bash
# Main worker secrets
wrangler secret put DATABASE_URL
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_PIN

# Stats worker secrets (uses same DATABASE_URL)
wrangler secret put DATABASE_URL --config wrangler.driver-stats.toml
```

### Step 2: Deploy Both Workers

```bash
# Deploy main worker
npm run deploy

# Deploy stats worker
npm run deploy:stats

# Or deploy both at once
npm run deploy:all
```

### Step 3: Configure DNS

Ensure both subdomains are configured in Cloudflare DNS:

1. `ops.luggster.com` → Main worker
2. `driver-stats.luggster.com` → Stats worker

Both should have:
- Proxy status: Proxied (orange cloud)
- SSL/TLS: Full

## Configuration Options

### Main Worker Configuration (`src/index.ts`)

You can modify these constants at the top of `src/index.ts`:

```typescript
// URL of the driver stats worker
const DRIVER_STATS_WORKER_URL = 'https://driver-stats.luggster.workers.dev';

// Enable/disable using the separate worker
const USE_DRIVER_STATS_WORKER = true;

// Timeout for proxy requests (milliseconds)
const DRIVER_STATS_TIMEOUT_MS = 10000;
```

### Fallback Behavior

The main worker has built-in fallback:
1. First tries to proxy to driver stats worker
2. If proxy fails (timeout, error), falls back to direct database query
3. Returns metadata indicating which source was used

## Monitoring

### Check Worker Status

```bash
# Check main worker
curl https://ops.luggster.com/health

# Check stats worker directly
curl https://driver-stats.luggster.com/health

# Check stats via proxy
curl https://ops.luggster.com/api/drivers/stats
```

### Cloudflare Dashboard
Monitor each worker separately in Cloudflare:
1. **Main Worker**: Workers & Pages → luggster-ops
2. **Stats Worker**: Workers & Pages → driver-stats

## Troubleshooting

### Common Issues

1. **CORS Errors**: Ensure both workers have proper CORS headers
2. **DNS Issues**: Verify both subdomains are properly configured
3. **Secret Mismatch**: Ensure DATABASE_URL is set for both workers
4. **Timeout Errors**: Increase `DRIVER_STATS_TIMEOUT_MS` if needed

### Debug Mode

Enable debug logging in `src/index.ts`:

```typescript
const DEBUG_LOGGING = true;

// Add debug logs
if (DEBUG_LOGGING) {
  console.log(`Proxying to: ${url}`);
}
```

## Performance Considerations

### When to Use Separate Worker

✅ **Use separate worker when:**
- Driver stats queries are complex or heavy
- You need to scale driver stats independently
- Driver stats cause performance issues for main operations

❌ **Use direct queries when:**
- Simple driver stats queries
- Low traffic volume
- Simpler deployment preferred

### Switching Back to Direct Queries

To revert to direct queries without the separate worker:

1. Set `USE_DRIVER_STATS_WORKER = false` in `src/index.ts`
2. Redeploy main worker only
3. The stats worker can be left deployed but unused

## API Endpoints

### Main Worker (Proxy Endpoints)
- `GET /api/drivers` → Proxies to stats worker
- `GET /api/drivers/online` → Proxies to stats worker
- `GET /api/drivers/stats` → Proxies to stats worker
- `GET /api/drivers/stats/enhanced` → Proxies to stats worker

### Stats Worker (Direct Endpoints)
- `GET /api/drivers/stats/live` → Live driver stats
- `GET /api/drivers` → All drivers list
- `GET /api/drivers/online` → Online drivers only
- `GET /api/drivers/stats/enhanced` → Enhanced stats with breakdowns
- `GET /health` → Health check
- `GET /ping` → Simple ping

## Security Notes

1. **Authentication**: Main worker handles JWT auth, stats worker doesn't need auth
2. **CORS**: Stats worker allows all origins; main worker validates origin
3. **Database Credentials**: Both workers use same DATABASE_URL but are isolated
4. **Rate Limiting**: Consider adding Cloudflare Rate Limiting to stats worker

## Cost Considerations

- Both workers count toward your Cloudflare Workers usage
- Database connections are separate for each worker
- Consider enabling [Workers Bundled Pricing](https://developers.cloudflare.com/workers/platform/pricing/#workers) if needed
