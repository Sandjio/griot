#!/bin/bash

# Deployment Validation Script
# This script validates the deployment by running comprehensive health checks
# Usage: ./scripts/deployment-validation.sh [environment] [deployment-color]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# Validation configuration
VALIDATION_TIMEOUT=300  # 5 minutes
RETRY_ATTEMPTS=3
RETRY_DELAY=10

# Health check endpoints
declare -A HEALTH_ENDPOINTS=(
    ["/health"]="Health check endpoint"
    ["/status"]="Status endpoint"
)

# Expected Lambda functions
declare -a EXPECTED_LAMBDAS=(
    "manga-post-auth-trigger"
    "manga-preferences-processing"
    "manga-story-generation"
    "manga-episode-generation"
    "manga-image-generation"
    "manga-content-retrieval"
    "manga-status-check"
)

# Validation functions
validate_environment() {
    local env=$1
    case $env in
        dev|staging|prod)
            log_success "Valid environment: $env"
            return 0
            ;;
        *)
            log_error "Invalid environment: $env"
            log_error "Valid environments: dev, staging, prod"
            return 1
            ;;
    esac
}

# Get stack outputs
get_stack_output() {
    local stack_name=$1
    local output_key=$2
    
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# Validate API Gateway
validate_api_gateway() {
    local env=$1
    local color=$2
    
    log_info "Validating API Gateway..."
    
    local stack_name="GriotMangaApiStack-${env}"
    if [ -n "$color" ]; then
        stack_name="${stack_name}-${color}"
    fi
    
    local api_endpoint=$(get_stack_output "$stack_name" "ApiEndpoint")
    
    if [ -z "$api_endpoint" ]; then
        log_error "Could not retrieve API endpoint from stack outputs"
        return 1
    fi
    
    log_info "API Endpoint: $api_endpoint"
    
    # Test health endpoints
    for endpoint in "${!HEALTH_ENDPOINTS[@]}"; do
        local description="${HEALTH_ENDPOINTS[$endpoint]}"
        log_info "Testing $description: $api_endpoint$endpoint"
        
        local response_code
        local attempt=1
        
        while [ $attempt -le $RETRY_ATTEMPTS ]; do
            response_code=$(curl -s -o /dev/null -w "%{http_code}" \
                --max-time 30 \
                "$api_endpoint$endpoint" || echo "000")
            
            if [ "$response_code" = "200" ]; then
                log_success "$description responded with HTTP $response_code"
                break
            elif [ $attempt -eq $RETRY_ATTEMPTS ]; then
                log_error "$description failed with HTTP $response_code after $RETRY_ATTEMPTS attempts"
                return 1
            else
                log_warning "$description failed with HTTP $response_code, retrying in ${RETRY_DELAY}s (attempt $attempt/$RETRY_ATTEMPTS)"
                sleep $RETRY_DELAY
                ((attempt++))
            fi
        done
    done
    
    # Test API Gateway metrics
    log_info "Checking API Gateway metrics..."
    local api_name=$(get_stack_output "$stack_name" "ApiName")
    
    if [ -n "$api_name" ]; then
        # Check if API Gateway is receiving requests
        local metric_value=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/ApiGateway" \
            --metric-name "Count" \
            --dimensions Name=ApiName,Value="$api_name" \
            --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
            --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "None")
        
        if [ "$metric_value" != "None" ] && [ "$metric_value" != "null" ]; then
            log_success "API Gateway is receiving requests (Count: $metric_value)"
        else
            log_warning "No recent API Gateway requests detected"
        fi
    fi
    
    return 0
}

# Validate Lambda functions
validate_lambda_functions() {
    local env=$1
    local color=$2
    
    log_info "Validating Lambda functions..."
    
    local suffix="-${env}"
    if [ -n "$color" ]; then
        suffix="${suffix}-${color}"
    fi
    
    for lambda_base in "${EXPECTED_LAMBDAS[@]}"; do
        local lambda_name="${lambda_base}${suffix}"
        
        log_info "Checking Lambda function: $lambda_name"
        
        # Check if function exists
        if aws lambda get-function --function-name "$lambda_name" > /dev/null 2>&1; then
            log_success "Lambda function exists: $lambda_name"
            
            # Check function configuration
            local runtime=$(aws lambda get-function-configuration \
                --function-name "$lambda_name" \
                --query 'Runtime' \
                --output text 2>/dev/null || echo "unknown")
            
            local state=$(aws lambda get-function-configuration \
                --function-name "$lambda_name" \
                --query 'State' \
                --output text 2>/dev/null || echo "unknown")
            
            log_info "  Runtime: $runtime, State: $state"
            
            if [ "$state" != "Active" ]; then
                log_error "Lambda function $lambda_name is not in Active state: $state"
                return 1
            fi
            
            # Check recent invocations
            local invocations=$(aws cloudwatch get-metric-statistics \
                --namespace "AWS/Lambda" \
                --metric-name "Invocations" \
                --dimensions Name=FunctionName,Value="$lambda_name" \
                --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
                --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
                --period 300 \
                --statistics Sum \
                --query 'Datapoints[0].Sum' \
                --output text 2>/dev/null || echo "None")
            
            if [ "$invocations" != "None" ] && [ "$invocations" != "null" ]; then
                log_info "  Recent invocations: $invocations"
            fi
            
            # Check for errors
            local errors=$(aws cloudwatch get-metric-statistics \
                --namespace "AWS/Lambda" \
                --metric-name "Errors" \
                --dimensions Name=FunctionName,Value="$lambda_name" \
                --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
                --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
                --period 300 \
                --statistics Sum \
                --query 'Datapoints[0].Sum' \
                --output text 2>/dev/null || echo "None")
            
            if [ "$errors" != "None" ] && [ "$errors" != "null" ] && [ "$errors" != "0" ]; then
                log_warning "  Recent errors detected: $errors"
            fi
            
        else
            log_error "Lambda function not found: $lambda_name"
            return 1
        fi
    done
    
    return 0
}

# Validate DynamoDB table
validate_dynamodb() {
    local env=$1
    local color=$2
    
    log_info "Validating DynamoDB table..."
    
    local table_name="manga-platform-table-${env}"
    if [ -n "$color" ]; then
        table_name="${table_name}-${color}"
    fi
    
    log_info "Checking DynamoDB table: $table_name"
    
    # Check if table exists and is active
    local table_status=$(aws dynamodb describe-table \
        --table-name "$table_name" \
        --query 'Table.TableStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$table_status" = "ACTIVE" ]; then
        log_success "DynamoDB table is active: $table_name"
        
        # Check table metrics
        local read_capacity=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/DynamoDB" \
            --metric-name "ConsumedReadCapacityUnits" \
            --dimensions Name=TableName,Value="$table_name" \
            --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
            --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "None")
        
        if [ "$read_capacity" != "None" ] && [ "$read_capacity" != "null" ]; then
            log_info "  Recent read capacity consumed: $read_capacity"
        fi
        
        # Check for throttling
        local throttles=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/DynamoDB" \
            --metric-name "ReadThrottledRequests" \
            --dimensions Name=TableName,Value="$table_name" \
            --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
            --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "None")
        
        if [ "$throttles" != "None" ] && [ "$throttles" != "null" ] && [ "$throttles" != "0" ]; then
            log_warning "  Throttling detected: $throttles"
        fi
        
    elif [ "$table_status" = "NOT_FOUND" ]; then
        log_error "DynamoDB table not found: $table_name"
        return 1
    else
        log_error "DynamoDB table is not active: $table_name (Status: $table_status)"
        return 1
    fi
    
    return 0
}

# Validate S3 bucket
validate_s3_bucket() {
    local env=$1
    local color=$2
    
    log_info "Validating S3 bucket..."
    
    local bucket_name="manga-platform-content-${env}"
    if [ -n "$color" ]; then
        bucket_name="${bucket_name}-${color}"
    fi
    
    log_info "Checking S3 bucket: $bucket_name"
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
        log_success "S3 bucket exists and is accessible: $bucket_name"
        
        # Check bucket encryption
        local encryption=$(aws s3api get-bucket-encryption \
            --bucket "$bucket_name" \
            --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
            --output text 2>/dev/null || echo "None")
        
        if [ "$encryption" != "None" ]; then
            log_success "  Bucket encryption enabled: $encryption"
        else
            log_warning "  Bucket encryption not configured"
        fi
        
        # Check public access block
        local public_access=$(aws s3api get-public-access-block \
            --bucket "$bucket_name" \
            --query 'PublicAccessBlockConfiguration.BlockPublicAcls' \
            --output text 2>/dev/null || echo "false")
        
        if [ "$public_access" = "true" ]; then
            log_success "  Public access blocked"
        else
            log_warning "  Public access not fully blocked"
        fi
        
    else
        log_error "S3 bucket not found or not accessible: $bucket_name"
        return 1
    fi
    
    return 0
}

# Validate EventBridge
validate_eventbridge() {
    local env=$1
    local color=$2
    
    log_info "Validating EventBridge..."
    
    local bus_name="manga-platform-bus-${env}"
    if [ -n "$color" ]; then
        bus_name="${bus_name}-${color}"
    fi
    
    log_info "Checking EventBridge bus: $bus_name"
    
    # Check if event bus exists
    if aws events describe-event-bus --name "$bus_name" > /dev/null 2>&1; then
        log_success "EventBridge bus exists: $bus_name"
        
        # Check recent events
        local events_count=$(aws cloudwatch get-metric-statistics \
            --namespace "AWS/Events" \
            --metric-name "InvocationsCount" \
            --dimensions Name=EventBusName,Value="$bus_name" \
            --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S)" \
            --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "None")
        
        if [ "$events_count" != "None" ] && [ "$events_count" != "null" ]; then
            log_info "  Recent events processed: $events_count"
        fi
        
    else
        log_error "EventBridge bus not found: $bus_name"
        return 1
    fi
    
    return 0
}

# Validate monitoring and alarms
validate_monitoring() {
    local env=$1
    local color=$2
    
    log_info "Validating monitoring setup..."
    
    # Check CloudWatch dashboard
    local dashboard_name="manga-platform-${env}"
    if [ -n "$color" ]; then
        dashboard_name="${dashboard_name}-${color}"
    fi
    
    if aws cloudwatch get-dashboard --dashboard-name "$dashboard_name" > /dev/null 2>&1; then
        log_success "CloudWatch dashboard exists: $dashboard_name"
    else
        log_warning "CloudWatch dashboard not found: $dashboard_name"
    fi
    
    # Check SNS topic for alerts
    local topic_name="manga-platform-alerts-${env}"
    local topic_arn=$(aws sns list-topics \
        --query "Topics[?contains(TopicArn, '$topic_name')].TopicArn" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$topic_arn" ]; then
        log_success "SNS alert topic exists: $topic_name"
        
        # Check subscriptions
        local subscriptions=$(aws sns list-subscriptions-by-topic \
            --topic-arn "$topic_arn" \
            --query 'Subscriptions | length(@)' \
            --output text 2>/dev/null || echo "0")
        
        log_info "  Alert subscriptions: $subscriptions"
    else
        log_warning "SNS alert topic not found: $topic_name"
    fi
    
    return 0
}

# Run end-to-end workflow test
validate_end_to_end_workflow() {
    local env=$1
    local color=$2
    
    log_info "Running end-to-end workflow validation..."
    
    # This would typically involve:
    # 1. Creating a test user
    # 2. Submitting test preferences
    # 3. Monitoring the generation pipeline
    # 4. Verifying content creation
    # 5. Cleaning up test data
    
    # For now, we'll do a basic API test
    local stack_name="GriotMangaApiStack-${env}"
    if [ -n "$color" ]; then
        stack_name="${stack_name}-${color}"
    fi
    
    local api_endpoint=$(get_stack_output "$stack_name" "ApiEndpoint")
    
    if [ -n "$api_endpoint" ]; then
        # Test unauthenticated endpoint (should return 401)
        local response_code=$(curl -s -o /dev/null -w "%{http_code}" \
            --max-time 30 \
            "$api_endpoint/preferences" \
            -X POST \
            -H "Content-Type: application/json" \
            -d '{"test": "data"}' || echo "000")
        
        if [ "$response_code" = "401" ]; then
            log_success "API correctly rejects unauthenticated requests"
        else
            log_warning "Unexpected response from API: HTTP $response_code"
        fi
    fi
    
    return 0
}

# Main validation function
run_validation() {
    local environment=$1
    local deployment_color=$2
    
    log_info "Starting deployment validation for environment: $environment"
    if [ -n "$deployment_color" ]; then
        log_info "Deployment color: $deployment_color"
    fi
    
    local validation_start_time=$(date +%s)
    local validation_errors=0
    
    # Run all validation checks
    local checks=(
        "validate_api_gateway"
        "validate_lambda_functions"
        "validate_dynamodb"
        "validate_s3_bucket"
        "validate_eventbridge"
        "validate_monitoring"
        "validate_end_to_end_workflow"
    )
    
    for check in "${checks[@]}"; do
        log_info "Running validation: $check"
        
        if $check "$environment" "$deployment_color"; then
            log_success "Validation passed: $check"
        else
            log_error "Validation failed: $check"
            ((validation_errors++))
        fi
        
        echo "---"
    done
    
    local validation_end_time=$(date +%s)
    local validation_duration=$((validation_end_time - validation_start_time))
    
    # Summary
    log_info "Validation Summary:"
    log_info "  Environment: $environment"
    if [ -n "$deployment_color" ]; then
        log_info "  Deployment Color: $deployment_color"
    fi
    log_info "  Duration: ${validation_duration}s"
    log_info "  Checks Run: ${#checks[@]}"
    log_info "  Errors: $validation_errors"
    
    if [ $validation_errors -eq 0 ]; then
        log_success "All validation checks passed!"
        return 0
    else
        log_error "$validation_errors validation check(s) failed!"
        return 1
    fi
}

# Script execution
main() {
    local environment=${1:-dev}
    local deployment_color=$2
    
    # Validate inputs
    if ! validate_environment "$environment"; then
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_error "AWS credentials not configured or invalid"
        exit 1
    fi
    
    # Run validation
    if run_validation "$environment" "$deployment_color"; then
        log_success "Deployment validation completed successfully!"
        exit 0
    else
        log_error "Deployment validation failed!"
        exit 1
    fi
}

# Execute main function if script is run directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi