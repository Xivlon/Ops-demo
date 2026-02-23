# Luggster Ops - Multi-Worker Deployment

## New Structure

```
Luggster-Ops/
├── packages/
│   ├── main-worker/          # Main operations console
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── generated/   # Auto-generated HTML templates
│   │   ├── templates/       # HTML source files
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── driver-stats-worker/ # Driver statistics worker
│       ├── src/
│       │   └── index.ts
│       ├── wrangler.toml
│       └── package.json
│
├── shared/                  # Shared code
│   ├── types/
│   ├── repositories/
│   └── utils/
│
└── scripts/
    └── build-html-new.ts
```

## Deployment Steps

### 1. Build HTML Templates

```bash
cd packages/main-worker
npm run build:html
```

### 2. Deploy Driver Stats Worker

```bash
cd packages/driver-stats-worker

# Deploy the worker
npm run deploy

# Set DATABASE_URL secret
npx wrangler secret put DATABASE_URL
```

### 3. Deploy Main Worker

```bash
cd packages/main-worker

# Deploy the worker
npm run deploy

# Set secrets
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PIN
```

## Configuration

### Main Worker (`packages/main-worker/wrangler.toml`)
- Name: `luggster-ops`
- Route: `ops.luggster.com/*`

### Driver Stats Worker (`packages/driver-stats-worker/wrangler.toml`)
- Name: `driver-stats`
- URL: `driver-stats.constance-api.workers.dev`
- No custom domain (uses workers.dev subdomain)

## Development

```bash
# Install dependencies
npm install

# Run both workers locally
npm run dev:all

# Or run separately
npm run dev:main      # Main worker (port 8787)
npm run dev:stats     # Stats worker (port 8788)
```

## Testing

```bash
# Test driver stats worker
curl http://localhost:8788/health
curl http://localhost:8788/api/drivers/stats/live

# Test main worker (after login)
curl -X POST http://localhost:8787/api/login -d '{"pin":"1234"}'
curl http://localhost:8787/api/drivers/stats
```

## Notes

1. **Shared Code**: Both workers use code from `shared/` directory
2. **HTML Templates**: Only main worker needs HTML templates
3. **Secrets**: Each worker needs its own DATABASE_URL secret
4. **CORS**: Driver stats worker has CORS enabled for cross-worker communication
5. **Fallback**: Main worker falls back to direct queries if stats worker fails
