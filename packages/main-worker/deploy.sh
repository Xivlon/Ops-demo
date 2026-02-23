#!/bin/bash

# Main Worker Deployment Script
# For Cloudflare CI/CD or manual deployment

echo "🚀 Deploying Main Worker (luggster-ops)..."

# Build HTML templates
echo "📦 Building HTML templates..."
npm run build:html

# Deploy to Cloudflare
echo "🚀 Deploying to Cloudflare Workers..."
npx wrangler deploy --env production

echo "✅ Main worker deployed to: https://luggster-ops.constance-api.workers.dev"
echo "📊 Health check: https://luggster-ops.constance-api.workers.dev/health"
echo "🔗 Dashboard: https://luggster-ops.constance-api.workers.dev"