# Storage Worker

Microservice for storage operations in LuggageLink Ops.

## Purpose

This worker handles all storage-related operations independently from the main worker:
- Listing storage orders with filters
- Getting storage statistics
- Assigning pickup/delivery drivers
- Confirming pickups and storage entries
- Updating order status
- Cancelling orders

## Benefits

- **Isolation**: Storage operations don't impact main worker performance
- **Independent Scaling**: Can scale based on storage operation load
- **Independent Deployment**: Deploy updates without affecting main ops
- **Fallback Support**: Main worker has direct query fallback if worker is unavailable

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ping` | Health ping |
| GET | `/health` | Health check with DB test |
| GET | `/api/storage` | List storage orders |
| GET | `/api/storage/stats` | Storage statistics |
| POST | `/api/storage/:id/assign-pickup` | Assign pickup driver |
| POST | `/api/storage/:id/assign-delivery` | Assign delivery driver |
| POST | `/api/storage/:id/confirm-pickup` | Confirm pickup |
| POST | `/api/storage/:id/confirm-storage` | Confirm storage entry |
| POST | `/api/storage/:id/status` | Update status |
| POST | `/api/storage/:id/cancel` | Cancel order |
| GET | `/api/storage/:id` | Get single storage order |

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Type check
npm run check

# Deploy
npm run deploy
# or
./deploy.sh [environment]
```

## Configuration

The worker is configured via `wrangler.toml`:

```toml
[env.production]
name = 'storage'
workers_dev = true
```

Environment variables should be set via Wrangler secrets:
```bash
wrangler secret put DATABASE_URL
```

## Integration with Main Worker

The main worker can proxy requests to this worker by setting:

```typescript
const USE_STORAGE_WORKER = true;
const STORAGE_WORKER_URL = 'https://storage.constance-api.workers.dev';
```

If the worker is unavailable, the main worker automatically falls back to direct database queries.
