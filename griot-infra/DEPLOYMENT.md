# Manga Platform Deployment Guide

This document provides comprehensive instructions for deploying the Manga Platform using AWS CDK with support for multiple environments and blue-green deployments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Deployment Methods](#deployment-methods)
- [Blue-Green Deployment](#blue-green-deployment)
- [CI/CD Pipeline](#cicd-pipeline)
- [Monitoring and Validation](#monitoring-and-validation)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

- **Node.js** (v18 or later)
- **npm** (v8 or later)
- **AWS CLI** (v2.x)
- **AWS CDK** (v2.x)
- **Git**

### AWS Setup

1. **AWS Account**: Ensure you have AWS accounts for each environment (dev, staging, prod)
2. **AWS Credentials**: Configure AWS credentials for each environment
3. **CDK Bootstrap**: Bootstrap CDK in each target region/account

```bash
# Bootstrap CDK for each environment
aws configure --profile dev
npx cdk bootstrap --profile dev

aws configure --profile staging
npx cdk bootstrap --profile staging

aws configure --profile prod
npx cdk bootstrap --profile prod
```

### Environment Variables

Create a `.env` file in the `griot-infra` directory:

```bash
# AWS Configuration
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=123456789012

# Environment-specific settings
DEV_ALERT_EMAIL=dev-alerts@example.com
STAGING_ALERT_EMAIL=staging-alerts@example.com
PROD_ALERT_EMAIL=prod-alerts@example.com

# External API Keys (if needed)
QLOO_API_KEY=your-qloo-api-key
```

## Environment Configuration

The platform supports three environments with different configurations:

### Development (dev)

- **Purpose**: Development and testing
- **Resources**: Minimal, cost-optimized
- **Data Retention**: 7 days
- **Monitoring**: Basic
- **Deployment**: Direct deployment

### Staging (staging)

- **Purpose**: Pre-production testing
- **Resources**: Production-like but smaller scale
- **Data Retention**: 14 days
- **Monitoring**: Enhanced
- **Deployment**: Blue-green deployment

### Production (prod)

- **Purpose**: Live production environment
- **Resources**: Full scale, high availability
- **Data Retention**: 30+ days
- **Monitoring**: Comprehensive
- **Deployment**: Blue-green deployment with manual approval

### Configuration Files

Environment-specific configurations are stored in `config/environments/`:

- `dev.json` - Development environment settings
- `staging.json` - Staging environment settings
- `prod.json` - Production environment settings

## Deployment Methods

### 1. Direct Deployment

Simple deployment for development environments:

```bash
# Deploy to development
npm run deploy:dev

# Deploy specific stack
./scripts/deploy.sh dev core
./scripts/deploy.sh dev api
```

### 2. Pipeline Deployment

Advanced deployment with validation and rollback capabilities:

```bash
# Blue-green deployment to staging
./scripts/deploy-pipeline.sh staging blue-green

# Direct deployment to development
./scripts/deploy-pipeline.sh dev direct

# Production deployment with specific color
./scripts/deploy-pipeline.sh prod blue-green green
```

### 3. Manual CDK Commands

For fine-grained control:

```bash
# Synthesize templates
npm run synth:prod

# Deploy with CDK directly
npx cdk deploy --all --context environment=prod

# View differences
npx cdk diff --context environment=prod
```

## Blue-Green Deployment

Blue-green deployment provides zero-downtime deployments by maintaining two identical production environments.

### How It Works

1. **Current State**: One environment (blue) serves production traffic
2. **New Deployment**: Deploy to the inactive environment (green)
3. **Validation**: Run health checks on the new environment
4. **Traffic Switch**: Route traffic to the new environment
5. **Cleanup**: Remove the old environment after validation

### Blue-Green Process

```bash
# Automatic blue-green deployment
./scripts/deploy-pipeline.sh prod blue-green

# Force specific color
./scripts/deploy-pipeline.sh prod blue-green green

# Check current active deployment
aws ssm get-parameter --name "/manga-platform/prod/active-deployment"
```

### Rollback Process

If deployment fails, the system automatically rolls back:

1. **Detection**: Health checks fail on new deployment
2. **Traffic Switch**: Route traffic back to previous environment
3. **Cleanup**: Remove failed deployment
4. **Notification**: Alert operations team

Manual rollback:

```bash
# Switch back to blue environment
aws ssm put-parameter \
  --name "/manga-platform/prod/active-deployment" \
  --value "blue" \
  --overwrite
```

## CI/CD Pipeline

### GitHub Actions Workflow

The platform includes a comprehensive GitHub Actions workflow (`.github/workflows/deploy.yml`) that:

1. **Tests**: Runs unit, integration, and quality tests
2. **Validates**: Performs security scans and infrastructure validation
3. **Deploys**: Deploys to appropriate environment based on branch
4. **Monitors**: Validates deployment health

### Branch Strategy

- **`main`** → Production deployment
- **`develop`** → Staging deployment
- **`feature/*`** → Development deployment (manual)
- **`release/*`** → Staging deployment

### Required Secrets

Configure these secrets in your GitHub repository:

```
AWS_ACCESS_KEY_ID_DEV
AWS_SECRET_ACCESS_KEY_DEV
AWS_ACCESS_KEY_ID_STAGING
AWS_SECRET_ACCESS_KEY_STAGING
AWS_ACCESS_KEY_ID_PROD
AWS_SECRET_ACCESS_KEY_PROD
```

### Manual Deployment

Use GitHub Actions manual dispatch for ad-hoc deployments:

1. Go to Actions tab in GitHub
2. Select "Deploy Manga Platform" workflow
3. Click "Run workflow"
4. Choose environment and deployment type

## Monitoring and Validation

### Deployment Validation

The deployment pipeline includes comprehensive validation:

```bash
# Run full validation
./scripts/deployment-validation.sh prod

# Validate specific environment
./scripts/deployment-validation.sh staging blue
```

### Health Checks

The validation script checks:

- **API Gateway**: Endpoint availability and response codes
- **Lambda Functions**: Function existence and state
- **DynamoDB**: Table status and metrics
- **S3 Buckets**: Bucket accessibility and configuration
- **EventBridge**: Event bus status
- **Monitoring**: CloudWatch dashboards and alarms

### Test Suite

Run comprehensive tests:

```bash
# All tests
./scripts/run-tests.sh all

# Specific test types
./scripts/run-tests.sh unit
./scripts/run-tests.sh integration staging
./scripts/run-tests.sh load staging
```

### Monitoring

Each environment includes:

- **CloudWatch Dashboards**: System metrics and performance
- **CloudWatch Alarms**: Critical failure alerts
- **X-Ray Tracing**: Distributed request tracing
- **Structured Logging**: Centralized log aggregation

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Issues

```bash
# Re-bootstrap CDK
npx cdk bootstrap --force

# Check bootstrap stack
aws cloudformation describe-stacks --stack-name CDKToolkit
```

#### 2. Permission Errors

```bash
# Verify AWS credentials
aws sts get-caller-identity

# Check IAM permissions
aws iam get-user
```

#### 3. Stack Deployment Failures

```bash
# View stack events
aws cloudformation describe-stack-events --stack-name GriotCoreStack-prod

# Check stack status
aws cloudformation describe-stacks --stack-name GriotCoreStack-prod
```

#### 4. Blue-Green Deployment Issues

```bash
# Check current deployment color
aws ssm get-parameter --name "/manga-platform/prod/active-deployment"

# List all stack versions
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

### Rollback Procedures

#### Immediate Rollback

```bash
# Switch traffic to previous version
./scripts/deploy-pipeline.sh prod blue-green --rollback

# Manual traffic switch
aws ssm put-parameter \
  --name "/manga-platform/prod/active-deployment" \
  --value "blue" \
  --overwrite
```

#### Stack Rollback

```bash
# Rollback CloudFormation stack
aws cloudformation cancel-update-stack --stack-name GriotCoreStack-prod

# Delete failed stack
aws cloudformation delete-stack --stack-name GriotCoreStack-prod-green
```

### Debugging

#### Enable Debug Logging

```bash
# Set debug environment variable
export CDK_DEBUG=true

# Run deployment with verbose output
./scripts/deploy-pipeline.sh dev direct --verbose
```

#### Check Logs

```bash
# View Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/manga"

# Tail specific log group
aws logs tail /aws/lambda/manga-story-generation-prod --follow
```

### Support

For additional support:

1. Check CloudWatch logs for detailed error messages
2. Review CloudFormation events for stack deployment issues
3. Validate environment configuration files
4. Ensure all prerequisites are met
5. Contact the development team with specific error messages

## Best Practices

### Security

- Use least-privilege IAM policies
- Enable encryption at rest for all data stores
- Implement proper secret management
- Regular security audits and updates

### Performance

- Monitor Lambda cold starts
- Optimize DynamoDB capacity settings
- Use appropriate S3 storage classes
- Implement caching strategies

### Cost Optimization

- Use appropriate instance sizes
- Implement lifecycle policies
- Monitor and optimize resource usage
- Regular cost reviews

### Reliability

- Implement proper error handling
- Use dead letter queues
- Monitor system health
- Regular backup and recovery testing
