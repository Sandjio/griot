# Griot - Manga Generation Platform

Griot is a comprehensive manga generation platform that allows users to create personalized manga content based on their preferences.

## Documentation

- [API Documentation](docs/API.md) - Complete API reference for all endpoints
- [Deployment Guide](griot-infra/DEPLOYMENT.md) - Infrastructure deployment instructions

## Architecture

The platform consists of:

- **Frontend**: Next.js application for user interaction
- **Backend**: AWS Lambda functions for API processing
- **Infrastructure**: AWS CDK for infrastructure as code
- **Database**: DynamoDB for data storage
- **External APIs**: Qloo API for personalized insights

## Key Features

- User authentication with AWS Cognito
- Preferences collection and storage
- Personalized manga generation
- Real-time monitoring and logging
- Scalable serverless architecture

## API Endpoints

### Preferences API

- `POST /preferences` - Submit user preferences and get personalized insights
- `GET /preferences` - Retrieve stored user preferences

See [API Documentation](docs/API.md) for complete details.

## Development

### Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK v2

### Local Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Deploy to development environment
npm run deploy:dev
```

### Monitoring

The platform includes comprehensive monitoring:

- CloudWatch logs and metrics
- X-Ray distributed tracing
- Custom business metrics
- Performance monitoring

Use the monitoring validation script:

```bash
./scripts/validate-preferences-monitoring.sh dev
```

## Support

For questions and support, please refer to the documentation or contact the development team.
