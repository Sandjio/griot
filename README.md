# Griot - AI-Powered Manga Generation Platform

_Qloo Global Hackathon Submission_

Griot is an intelligent manga generation platform that combines Large Language Models (LLMs) with Qloo's Taste AI™ API to create deeply personalized manga content. By leveraging Qloo's cultural intelligence and consumer behavior insights, Griot understands user preferences across entertainment, lifestyle, and cultural domains to generate manga stories that truly resonate with individual tastes.

## Documentation

- [API Documentation](docs/API.md) - Complete API reference for all endpoints
- [Deployment Guide](griot-infra/DEPLOYMENT.md) - Infrastructure deployment instructions

## Hackathon Integration

**LLM Integration**: Utilizes advanced language models (Claude) for manga story generation and narrative creation.

**Qloo's Taste AI™**: Leverages Qloo's cultural intelligence API to understand user preferences across music, TV, dining, fashion, travel, and entertainment to inform manga content generation.

## Architecture

The platform consists of:

- **Frontend**: Next.js application for user interaction
- **Backend**: AWS Lambda functions for API processing
- **Infrastructure**: AWS CDK for infrastructure as code
- **Database**: DynamoDB for data storage
- **Cultural Intelligence**: Qloo's Taste AI™ API for deep preference insights
- **Content Generation**: LLM integration for personalized manga creation

## Key Features

- **Cultural Intelligence**: Qloo's Taste AI™ integration for understanding user preferences across multiple domains
- **LLM-Powered Generation**: Advanced language models create personalized manga narratives
- **Privacy-First**: No personal identifying data required - powered by cultural preferences
- **Cross-Domain Insights**: Connects user interests from music, entertainment, lifestyle to manga content
- **Scalable Architecture**: Serverless AWS infrastructure with real-time processing
- **Personalized Storytelling**: Generates manga content that reflects individual cultural tastes

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
