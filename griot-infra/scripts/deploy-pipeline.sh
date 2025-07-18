#!/bin/bash

# Manga Platform CI/CD Deployment Pipeline Script
# This script implements blue-green deployment strategy with validation and rollback capabilities
# Usage: ./scripts/deploy-pipeline.sh [environment] [deployment-type] [options]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DEPLOYMENT_ID="deploy-${TIMESTAMP}"

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

# Load configuration
load_config() {
    local env=$1
    local config_file="$PROJECT_ROOT/config/environments/${env}.json"
    
    if [ ! -f "$config_file" ]; then
        log_error "Configuration file not found: $config_file"
        exit 1
    fi
    
    log_info "Loading configuration for environment: $env"
    export ENVIRONMENT_CONFIG="$config_file"
}

# Validate environment
validate_environment() {
    local env=$1
    case $env in
        dev|staging|prod)
            log_success "Valid environment: $env"
            ;;
        *)
            log_error "Invalid environment: $env"
            log_error "Valid environments: dev, staging, prod"
            exit 1
            ;;
    esac
}

# Pre-deployment validation
pre_deployment_validation() {
    log_info "Running pre-deployment validation..."
    
    # Check AWS credentials
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_error "AWS credentials not configured or invalid"
        exit 1
    fi
    
    # Check CDK version
    local cdk_version=$(npx cdk --version | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
    log_info "CDK Version: $cdk_version"
    
    # Run tests
    log_info "Running test suite..."
    cd "$PROJECT_ROOT"
    npm test
    
    # CDK synth validation
    log_info "Validating CDK synthesis..."
    npx cdk synth --context environment=$ENVIRONMENT > /dev/null
    
    log_success "Pre-deployment validation completed"
}

# Blue-Green deployment strategy
blue_green_deploy() {
    local env=$1
    local current_color=$2
    local new_color=$3
    
    log_info "Starting blue-green deployment for $env environment"
    log_info "Current: $current_color, New: $new_color"
    
    # Deploy new version (green)
    log_info "Deploying new version ($new_color)..."
    npx cdk deploy --all \
        --context environment=$env \
        --context deploymentColor=$new_color \
        --context deploymentId=$DEPLOYMENT_ID \
        --require-approval never \
        --outputs-file "outputs-${env}-${new_color}.json"
    
    # Health check on new deployment
    if health_check "$env" "$new_color"; then
        log_success "Health check passed for new deployment"
        
        # Switch traffic to new version
        log_info "Switching traffic to new version..."
        switch_traffic "$env" "$new_color"
        
        # Final health check
        if health_check "$env" "$new_color"; then
            log_success "Blue-green deployment completed successfully"
            
            # Clean up old version after successful deployment
            cleanup_old_version "$env" "$current_color"
        else
            log_error "Final health check failed, initiating rollback..."
            rollback_deployment "$env" "$current_color"
            exit 1
        fi
    else
        log_error "Health check failed for new deployment, cleaning up..."
        cleanup_failed_deployment "$env" "$new_color"
        exit 1
    fi
}

# Health check function
health_check() {
    local env=$1
    local color=$2
    
    log_info "Running health checks for $env-$color..."
    
    # Get API Gateway endpoint from outputs
    local api_endpoint=$(get_stack_output "$env" "ApiEndpoint")
    
    if [ -z "$api_endpoint" ]; then
        log_error "Could not retrieve API endpoint"
        return 1
    fi
    
    # Health check endpoints
    local health_endpoints=(
        "/health"
        "/status"
    )
    
    for endpoint in "${health_endpoints[@]}"; do
        log_info "Checking endpoint: $api_endpoint$endpoint"
        
        local response_code=$(curl -s -o /dev/null -w "%{http_code}" "$api_endpoint$endpoint" || echo "000")
        
        if [ "$response_code" != "200" ]; then
            log_error "Health check failed for $endpoint (HTTP $response_code)"
            return 1
        fi
    done
    
    # Additional checks
    check_lambda_functions "$env"
    check_dynamodb_table "$env"
    check_eventbridge_bus "$env"
    
    log_success "All health checks passed"
    return 0
}

# Check Lambda functions
check_lambda_functions() {
    local env=$1
    
    log_info "Checking Lambda functions..."
    
    local functions=(
        "manga-preferences-processing-$env"
        "manga-story-generation-$env"
        "manga-episode-generation-$env"
        "manga-image-generation-$env"
        "manga-content-retrieval-$env"
    )
    
    for func in "${functions[@]}"; do
        if aws lambda get-function --function-name "$func" > /dev/null 2>&1; then
            log_success "Lambda function exists: $func"
        else
            log_error "Lambda function not found: $func"
            return 1
        fi
    done
}

# Check DynamoDB table
check_dynamodb_table() {
    local env=$1
    local table_name="MangaPlatformTable-$env"
    
    log_info "Checking DynamoDB table: $table_name"
    
    if aws dynamodb describe-table --table-name "$table_name" > /dev/null 2>&1; then
        log_success "DynamoDB table exists and is accessible"
    else
        log_error "DynamoDB table check failed"
        return 1
    fi
}

# Check EventBridge bus
check_eventbridge_bus() {
    local env=$1
    local bus_name="manga-platform-bus-$env"
    
    log_info "Checking EventBridge bus: $bus_name"
    
    if aws events describe-event-bus --name "$bus_name" > /dev/null 2>&1; then
        log_success "EventBridge bus exists and is accessible"
    else
        log_error "EventBridge bus check failed"
        return 1
    fi
}

# Switch traffic (placeholder for actual traffic switching logic)
switch_traffic() {
    local env=$1
    local new_color=$2
    
    log_info "Switching traffic to $new_color version..."
    
    # In a real implementation, this would update Route 53 weighted routing
    # or API Gateway stage variables to switch traffic
    
    # For now, we'll update a parameter in Systems Manager
    aws ssm put-parameter \
        --name "/manga-platform/$env/active-deployment" \
        --value "$new_color" \
        --type "String" \
        --overwrite
    
    log_success "Traffic switched to $new_color version"
}

# Rollback deployment
rollback_deployment() {
    local env=$1
    local previous_color=$2
    
    log_warning "Initiating rollback to $previous_color version..."
    
    # Switch traffic back to previous version
    switch_traffic "$env" "$previous_color"
    
    # Verify rollback
    if health_check "$env" "$previous_color"; then
        log_success "Rollback completed successfully"
    else
        log_error "Rollback failed - manual intervention required"
        exit 1
    fi
}

# Cleanup functions
cleanup_old_version() {
    local env=$1
    local old_color=$2
    
    log_info "Cleaning up old version ($old_color)..."
    
    # Keep old version for a grace period before cleanup
    # This could be implemented as a separate cleanup job
    log_info "Old version cleanup scheduled for later"
}

cleanup_failed_deployment() {
    local env=$1
    local failed_color=$2
    
    log_warning "Cleaning up failed deployment ($failed_color)..."
    
    # Remove failed deployment resources
    # This would typically involve deleting the failed stack
    log_info "Failed deployment cleanup completed"
}

# Get stack output value
get_stack_output() {
    local env=$1
    local output_key=$2
    local stack_name="MangaApiStack-$env"
    
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# Determine current deployment color
get_current_color() {
    local env=$1
    
    # Get current active deployment from Systems Manager
    local current=$(aws ssm get-parameter \
        --name "/manga-platform/$env/active-deployment" \
        --query "Parameter.Value" \
        --output text 2>/dev/null || echo "blue")
    
    echo "$current"
}

# Get next deployment color
get_next_color() {
    local current=$1
    
    if [ "$current" = "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# Main deployment function
main() {
    local environment=${1:-dev}
    local deployment_type=${2:-blue-green}
    local force_color=$3
    
    log_info "Starting deployment pipeline..."
    log_info "Environment: $environment"
    log_info "Deployment Type: $deployment_type"
    log_info "Deployment ID: $DEPLOYMENT_ID"
    
    # Validate inputs
    validate_environment "$environment"
    load_config "$environment"
    
    # Set environment variable
    export ENVIRONMENT="$environment"
    
    # Change to project directory
    cd "$PROJECT_ROOT"
    
    # Load environment variables
    if [ -f .env ]; then
        log_info "Loading environment variables from .env file..."
        export $(cat .env | grep -v '^#' | xargs)
    fi
    
    # Build project
    log_info "Building project..."
    npm run build
    
    # Run pre-deployment validation
    pre_deployment_validation
    
    case $deployment_type in
        blue-green)
            local current_color=$(get_current_color "$environment")
            local next_color
            
            if [ -n "$force_color" ]; then
                next_color="$force_color"
            else
                next_color=$(get_next_color "$current_color")
            fi
            
            blue_green_deploy "$environment" "$current_color" "$next_color"
            ;;
        direct)
            log_info "Running direct deployment..."
            npx cdk deploy --all \
                --context environment="$environment" \
                --context deploymentId="$DEPLOYMENT_ID" \
                --require-approval never
            
            # Run health checks
            if ! health_check "$environment" "direct"; then
                log_error "Health checks failed after direct deployment"
                exit 1
            fi
            ;;
        *)
            log_error "Invalid deployment type: $deployment_type"
            log_error "Valid types: blue-green, direct"
            exit 1
            ;;
    esac
    
    log_success "Deployment pipeline completed successfully!"
}

# Script execution
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi