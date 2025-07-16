# Griot Manga Generation Platform - Infrastructure

This directory contains the AWS CDK TypeScript infrastructure code for the Griot Manga Generation Platform.

## Project Structure

```
griot-infra/
├── bin/
│   └── griot-infra.ts          # CDK app entry point
├── lib/
│   └── stacks/
│       ├── core-infrastructure-stack.ts  # Core infrastructure (DynamoDB, S3, EventBridge)
│       ├── api-stack.ts                  # API Gateway, Cognito, Lambda functions
│       └── monitoring-stack.ts           # CloudWatch dashboards, alarms, logging
├── scripts/
│   └── deploy.sh               # Deployment script
├── test/
│   └── griot-infra.test.ts     # CDK unit tests
├── cdk.json                    # CDK configuration and context
├── package.json                # Node.js dependencies
└── tsconfig.json               # TypeScript configuration
```

## Stack Architecture

### Core Infrastructure Stack

- **DynamoDB Single Table**: `manga-platform-table-{env}` with GSI1 and GSI2
- **S3 Content Bucket**: `manga-platform-content-{env}-{account}` for storing generated content
- **EventBridge Custom Bus**: `manga-platform-events-{env}` for event-driven architecture

### API Stack

- **Cognito User Pool**: User authentication and management
- **API Gateway**: RESTful API endpoints with Cognito authorization
- **Lambda Functions**: Post-authentication trigger and API endpoint handlers

### Monitoring Stack

- **CloudWatch Dashboard**: System metrics and performance monitoring
- **CloudWatch Alarms**: Error rate and throttling alerts
- **SNS Topic**: Alert notifications
- **Log Groups**: Centralized logging for API Gateway and Lambda functions

## Environment Configuration

The project supports multiple environments configured in `cdk.json`:

- **dev**: Development environment
- **staging**: Staging environment
- **prod**: Production environment

Each environment has its own:

- AWS account and region settings
- Alert email configuration
- Resource naming conventions
- Retention policies

## Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with appropriate credentials
- AWS CDK CLI: `npm install -g aws-cdk`

## Deployment

### Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Deploy to development environment
./scripts/deploy.sh dev all

# Deploy specific stack
./scripts/deploy.sh dev core
./scripts/deploy.sh staging api
./scripts/deploy.sh prod monitoring
```

### First Time Setup

For first-time deployment to a new AWS account/region:

```bash
# Bootstrap CDK
./scripts/deploy.sh dev all --bootstrap
```

### Manual CDK Commands

```bash
# Synthesize CloudFormation templates
npx cdk synth --context environment=dev

# Deploy all stacks
npx cdk deploy --all --context environment=dev

# Deploy specific stack
npx cdk deploy MangaCoreStack-dev --context environment=dev

# Destroy stacks (be careful!)
npx cdk destroy --all --context environment=dev
```

## Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test -- --watch
```

## Stack Dependencies

The stacks have the following dependencies:

1. **Core Infrastructure Stack** (no dependencies)
2. **API Stack** (depends on Core Infrastructure)
3. **Monitoring Stack** (depends on Core Infrastructure and API)

This ensures proper deployment order and resource references.

## Environment Variables

The following environment variables are used by Lambda functions:

- `MANGA_TABLE_NAME`: DynamoDB table name
- `CONTENT_BUCKET_NAME`: S3 bucket name for content storage
- `EVENT_BUS_NAME`: EventBridge custom bus name
- `ENVIRONMENT`: Current deployment environment

## Security Features

- **Encryption**: All data at rest is encrypted (DynamoDB, S3)
- **IAM**: Least privilege access policies for all resources
- **VPC**: Optional VPC configuration for enhanced security
- **CORS**: Properly configured for API Gateway
- **Authentication**: Cognito User Pool with strong password policies

## Monitoring and Alerts

- **CloudWatch Dashboard**: Real-time metrics visualization
- **Alarms**: Automated alerts for errors and throttling
- **Logging**: Structured logging with retention policies
- **SNS Notifications**: Email alerts for critical issues

## Cost Optimization

- **Pay-per-request**: DynamoDB billing mode
- **Lifecycle policies**: S3 storage class transitions
- **Log retention**: Environment-specific retention periods
- **Resource cleanup**: Automatic cleanup for non-production environments

## Troubleshooting

### Common Issues

1. **Bootstrap Error**: Run CDK bootstrap for the target account/region
2. **Permission Denied**: Ensure AWS credentials have sufficient permissions
3. **Stack Dependencies**: Deploy stacks in the correct order (core → api → monitoring)
4. **Resource Limits**: Check AWS service quotas for your account

### Useful Commands

```bash
# Check CDK version
npx cdk --version

# List all stacks
npx cdk list --context environment=dev

# Show stack differences
npx cdk diff MangaCoreStack-dev --context environment=dev

# View stack outputs
aws cloudformation describe-stacks --stack-name MangaCoreStack-dev
```

## Contributing

1. Make changes to the CDK code
2. Run `npm run build` to compile TypeScript
3. Run `npm test` to execute unit tests
4. Test deployment in development environment
5. Submit pull request with changes

## Support

For issues and questions:

- Check AWS CDK documentation: https://docs.aws.amazon.com/cdk/
- Review CloudFormation events in AWS Console
- Check CloudWatch logs for Lambda function errors
