#!/bin/bash

# Storage Worker Deployment Script

set -e

echo "🚀 Deploying Storage Worker..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler not found. Please install it:"
    echo "   npm install -g wrangler"
    exit 1
fi

# Determine environment
ENV=${1:-production}

echo "📦 Environment: $ENV"

# Type check
echo "🔍 Running TypeScript checks..."
npm run check

# Deploy
echo "🚀 Deploying to Cloudflare..."
wrangler deploy --env "$ENV"

echo "✅ Storage worker deployed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Update STORAGE_WORKER_URL in main worker if needed"
echo "   2. Set USE_STORAGE_WORKER = true to enable proxying"
echo "   3. Test the endpoints:"
echo "      - https://storage.constance-api.workers.dev/ping"
echo "      - https://storage.constance-api.workers.dev/health"
