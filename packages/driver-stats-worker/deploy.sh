#!/bin/bash

# Driver Stats Worker Deployment Script
# For Cloudflare CI/CD or manual deployment

echo "🚀 Deploying Driver Stats Worker..."

# Deploy to Cloudflare
echo "🚀 Deploying to Cloudflare Workers..."
npx wrangler deploy --env production

echo "✅ Driver stats worker deployed to: https://driver-stats.constance-api.workers.dev"
echo "📊 Health check: https://driver-stats.constance-api.workers.dev/health"
echo "🏎️  Driver stats: https://driver-stats.constance-api.workers.dev/api/drivers/stats/live"