#!/bin/bash

# Manga Platform CDK Deployment Script
# Usage: ./scripts/deploy.sh [environment] [stack]
# Example: ./scripts/deploy.sh dev all
# Example: ./scripts/deploy.sh prod core

set -e

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  echo "📋 Loading environment variables from .env file..."
  export $(cat .env | grep -v '^#' | xargs)
fi

ENVIRONMENT=${1:-dev}
STACK=${2:-all}

echo "🚀 Deploying Manga Platform to environment: $ENVIRONMENT"

# Validate environment
case $ENVIRONMENT in
  dev|staging|prod)
    echo "✅ Valid environment: $ENVIRONMENT"
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "Valid environments: dev, staging, prod"
    exit 1
    ;;
esac

# Build the project
echo "🔨 Building CDK project..."
npm run build

# Bootstrap CDK if needed (only for first deployment)
if [ "$3" = "--bootstrap" ]; then
  echo "🏗️ Bootstrapping CDK..."
  npx cdk bootstrap --context environment=$ENVIRONMENT
fi

# Deploy based on stack parameter
case $STACK in
  all)
    echo "📦 Deploying all stacks..."
    npx cdk deploy --all --context environment=$ENVIRONMENT --require-approval never
    ;;
  core)
    echo "📦 Deploying Core Infrastructure Stack..."
    npx cdk deploy MangaCoreStack-$ENVIRONMENT --context environment=$ENVIRONMENT --require-approval never
    ;;
  api)
    echo "📦 Deploying API Stack..."
    npx cdk deploy MangaApiStack-$ENVIRONMENT --context environment=$ENVIRONMENT --require-approval never
    ;;
  monitoring)
    echo "📦 Deploying Monitoring Stack..."
    npx cdk deploy MangaMonitoringStack-$ENVIRONMENT --context environment=$ENVIRONMENT --require-approval never
    ;;
  *)
    echo "❌ Invalid stack: $STACK"
    echo "Valid stacks: all, core, api, monitoring"
    exit 1
    ;;
esac

echo "✅ Deployment completed successfully!"

# Configure EventBridge targets post-deployment to avoid circular dependencies
if [ "$STACK" = "all" ] || [ "$STACK" = "processing" ]; then
  echo ""
  echo "🎯 Configuring EventBridge targets..."
  ./scripts/configure-eventbridge-targets.sh $ENVIRONMENT
fi

echo "🔗 Check the AWS Console for stack outputs and resources"