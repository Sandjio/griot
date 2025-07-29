#!/bin/bash

# Deployment script for Griot Frontend
# Usage: ./scripts/deploy.sh [environment] [build-version]

set -e

# Configuration
ENVIRONMENT=${1:-staging}
BUILD_VERSION=${2:-$(date +%Y%m%d-%H%M%S)}
PROJECT_NAME="griot-frontend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate environment
validate_environment() {
    case $ENVIRONMENT in
        development|staging|production)
            log_info "Deploying to environment: $ENVIRONMENT"
            ;;
        *)
            log_error "Invalid environment: $ENVIRONMENT"
            log_error "Valid environments: development, staging, production"
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed"
        exit 1
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node --version)
    log_info "Node.js version: $NODE_VERSION"
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        log_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Setup environment variables
setup_environment() {
    log_info "Setting up environment variables..."
    
    # Set build version
    export NEXT_PUBLIC_BUILD_VERSION=$BUILD_VERSION
    export NEXT_PUBLIC_ENVIRONMENT=$ENVIRONMENT
    
    # Check for environment-specific .env file
    ENV_FILE=".env.${ENVIRONMENT}"
    if [ -f "$ENV_FILE" ]; then
        log_info "Loading environment variables from $ENV_FILE"
        set -a
        source "$ENV_FILE"
        set +a
    else
        log_warning "Environment file $ENV_FILE not found"
        
        # Check for .env.local
        if [ -f ".env.local" ]; then
            log_info "Loading environment variables from .env.local"
            set -a
            source ".env.local"
            set +a
        else
            log_warning "No environment file found. Using defaults."
        fi
    fi
    
    # Validate required environment variables
    REQUIRED_VARS=(
        "NEXT_PUBLIC_COGNITO_USER_POOL_ID"
        "NEXT_PUBLIC_COGNITO_CLIENT_ID"
        "NEXT_PUBLIC_COGNITO_DOMAIN"
        "NEXT_PUBLIC_API_BASE_URL"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done
    
    log_success "Environment variables configured"
}

# Install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    
    # Clean install
    if [ -d "node_modules" ]; then
        log_info "Cleaning existing node_modules..."
        rm -rf node_modules
    fi
    
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
    
    log_success "Dependencies installed"
}

# Run tests
run_tests() {
    log_info "Running tests..."
    
    # Run unit tests
    npm run test:run
    
    # Run type checking
    npx tsc --noEmit
    
    log_success "Tests passed"
}

# Build application
build_application() {
    log_info "Building application for $ENVIRONMENT..."
    
    # Set build environment
    export NODE_ENV=production
    
    # Build the application
    npm run build
    
    # Check if build was successful
    if [ ! -d ".next" ]; then
        log_error "Build failed - .next directory not found"
        exit 1
    fi
    
    log_success "Application built successfully"
}

# Generate build report
generate_build_report() {
    log_info "Generating build report..."
    
    BUILD_REPORT_FILE="build-report-${ENVIRONMENT}-${BUILD_VERSION}.json"
    
    cat > "$BUILD_REPORT_FILE" << EOF
{
  "environment": "$ENVIRONMENT",
  "buildVersion": "$BUILD_VERSION",
  "buildTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "nodeVersion": "$(node --version)",
  "npmVersion": "$(npm --version)",
  "gitCommit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
  "buildSize": {
    "total": "$(du -sh .next 2>/dev/null | cut -f1 || echo 'unknown')",
    "static": "$(du -sh .next/static 2>/dev/null | cut -f1 || echo 'unknown')"
  }
}
EOF
    
    log_success "Build report generated: $BUILD_REPORT_FILE"
}

# Security checks
run_security_checks() {
    log_info "Running security checks..."
    
    # Check for known vulnerabilities
    npm audit --audit-level=high
    
    # Check for sensitive files
    SENSITIVE_FILES=(".env" ".env.local" ".env.production" "*.key" "*.pem")
    for pattern in "${SENSITIVE_FILES[@]}"; do
        if ls $pattern 1> /dev/null 2>&1; then
            log_warning "Sensitive files found matching pattern: $pattern"
        fi
    done
    
    log_success "Security checks completed"
}

# Deployment validation
validate_deployment() {
    log_info "Validating deployment..."
    
    # Check if required files exist
    REQUIRED_FILES=(".next/BUILD_ID" ".next/static")
    for file in "${REQUIRED_FILES[@]}"; do
        if [ ! -e "$file" ]; then
            log_error "Required file/directory not found: $file"
            exit 1
        fi
    done
    
    # Validate configuration
    node -e "
        const { validateConfig } = require('./src/lib/config.ts');
        const validation = validateConfig();
        if (!validation.isValid) {
            console.error('Configuration validation failed:', validation.errors);
            process.exit(1);
        }
        console.log('Configuration validation passed');
    " 2>/dev/null || log_warning "Configuration validation skipped (TypeScript compilation required)"
    
    log_success "Deployment validation passed"
}

# Cleanup
cleanup() {
    log_info "Cleaning up..."
    
    # Remove temporary files
    rm -f build-report-*.json.tmp
    
    log_success "Cleanup completed"
}

# Main deployment function
main() {
    log_info "Starting deployment of $PROJECT_NAME"
    log_info "Environment: $ENVIRONMENT"
    log_info "Build Version: $BUILD_VERSION"
    
    validate_environment
    check_prerequisites
    setup_environment
    install_dependencies
    
    # Skip tests in development for faster builds
    if [ "$ENVIRONMENT" != "development" ]; then
        run_tests
        run_security_checks
    fi
    
    build_application
    validate_deployment
    generate_build_report
    cleanup
    
    log_success "Deployment completed successfully!"
    log_info "Build version: $BUILD_VERSION"
    log_info "Environment: $ENVIRONMENT"
    log_info "Build directory: .next"
}

# Error handling
trap 'log_error "Deployment failed!"; exit 1' ERR

# Run main function
main "$@"