#!/bin/bash

# Rollback Script for Manga Platform
# This script provides rollback capabilities for failed deployments
# Usage: ./scripts/rollback.sh [environment] [rollback-type] [options]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

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

# Get current deployment color
get_current_deployment_color() {
    local env=$1
    
    local current_color=$(aws ssm get-parameter \
        --name "/manga-platform/$env/active-deployment" \
        --query "Parameter.Value" \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$current_color" ]; then
        log_warning "No active deployment color found for $env"
        echo "blue"  # Default to blue
    else
        echo "$current_color"
    fi
}

# Get previous deployment color
get_previous_deployment_color() {
    local current_color=$1
    
    if [ "$current_color" = "blue" ]; then
        echo "green"
    else
        echo "blue"
    fi
}

# List available stack versions
list_stack_versions() {
    local env=$1
    
    log_info "Available stack versions for environment: $env"
    
    # List stacks with the environment prefix
    aws cloudformation list-stacks \
        --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
        --query "StackSummaries[?contains(StackName, '$env')].{Name:StackName,Status:StackStatus,Created:CreationTime}" \
        --output table
}

# Traffic rollback (for blue-green deployments)
traffic_rollback() {
    local env=$1
    local target_color=$2
    
    log_info "Rolling back traffic to $target_color environment..."
    
    # Update the active deployment parameter
    if aws ssm put-parameter \
        --name "/manga-platform/$env/active-deployment" \
        --value "$target_color" \
        --type "String" \
        --overwrite; then
        
        log_success "Traffic switched to $target_color environment"
        
        # Wait for traffic switch to take effect
        log_info "Waiting for traffic switch to take effect..."
        sleep 30
        
        # Validate the rollback
        if validate_rollback "$env" "$target_color"; then
            log_success "Traffic rollback completed successfully"
            return 0
        else
            log_error "Traffic rollback validation failed"
            return 1
        fi
    else
        log_error "Failed to switch traffic to $target_color environment"
        return 1
    fi
}

# Stack rollback (CloudFormation level)
stack_rollback() {
    local env=$1
    local stack_name=$2
    local rollback_type=$3
    
    log_info "Rolling back stack: $stack_name"
    
    case $rollback_type in
        cancel-update)
            log_info "Canceling stack update..."
            if aws cloudformation cancel-update-stack --stack-name "$stack_name"; then
                log_success "Stack update canceled"
                wait_for_stack_operation "$stack_name" "UPDATE_ROLLBACK_COMPLETE"
            else
                log_error "Failed to cancel stack update"
                return 1
            fi
            ;;
        delete-stack)
            log_warning "Deleting failed stack: $stack_name"
            if aws cloudformation delete-stack --stack-name "$stack_name"; then
                log_success "Stack deletion initiated"
                wait_for_stack_operation "$stack_name" "DELETE_COMPLETE"
            else
                log_error "Failed to delete stack"
                return 1
            fi
            ;;
        redeploy-previous)
            log_info "Redeploying previous version..."
            # This would involve redeploying from a previous commit or backup
            log_warning "Manual intervention required for redeploying previous version"
            return 1
            ;;
        *)
            log_error "Invalid rollback type: $rollback_type"
            return 1
            ;;
    esac
}

# Wait for CloudFormation stack operation to complete
wait_for_stack_operation() {
    local stack_name=$1
    local expected_status=$2
    local timeout=${3:-1800}  # 30 minutes default
    
    log_info "Waiting for stack operation to complete: $stack_name"
    log_info "Expected status: $expected_status"
    
    local start_time=$(date +%s)
    local current_time=$start_time
    
    while [ $((current_time - start_time)) -lt $timeout ]; do
        local stack_status=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --query "Stacks[0].StackStatus" \
            --output text 2>/dev/null || echo "STACK_NOT_FOUND")
        
        log_info "Current stack status: $stack_status"
        
        case $stack_status in
            "$expected_status")
                log_success "Stack operation completed successfully"
                return 0
                ;;
            *FAILED*|*ROLLBACK_FAILED*)
                log_error "Stack operation failed with status: $stack_status"
                return 1
                ;;
            "STACK_NOT_FOUND")
                if [ "$expected_status" = "DELETE_COMPLETE" ]; then
                    log_success "Stack deleted successfully"
                    return 0
                else
                    log_error "Stack not found"
                    return 1
                fi
                ;;
            *IN_PROGRESS*)
                log_info "Stack operation in progress, waiting..."
                sleep 30
                ;;
            *)
                log_warning "Unexpected stack status: $stack_status"
                sleep 30
                ;;
        esac
        
        current_time=$(date +%s)
    done
    
    log_error "Stack operation timed out after $timeout seconds"
    return 1
}

# Validate rollback
validate_rollback() {
    local env=$1
    local target_color=$2
    
    log_info "Validating rollback for environment: $env"
    
    # Run deployment validation script
    if "$SCRIPT_DIR/deployment-validation.sh" "$env" "$target_color"; then
        log_success "Rollback validation passed"
        return 0
    else
        log_error "Rollback validation failed"
        return 1
    fi
}

# Database rollback (if needed)
database_rollback() {
    local env=$1
    local backup_timestamp=$2
    
    log_warning "Database rollback requested for environment: $env"
    log_warning "This operation is destructive and should be used with extreme caution"
    
    # For DynamoDB, we would typically:
    # 1. Create a backup of current state
    # 2. Restore from point-in-time or backup
    # 3. Validate data integrity
    
    log_error "Database rollback not implemented - manual intervention required"
    log_info "Consider using DynamoDB point-in-time recovery or backups"
    
    return 1
}

# Cleanup failed deployment
cleanup_failed_deployment() {
    local env=$1
    local failed_color=$2
    
    log_info "Cleaning up failed deployment: $env-$failed_color"
    
    # List stacks to clean up
    local stacks_to_cleanup=(
        "GriotCoreStack-${env}-${failed_color}"
        "GriotMangaApiStack-${env}-${failed_color}"
        "GriotMangaProcessingStack-${env}-${failed_color}"
        "GriotMangaMonitoringStack-${env}-${failed_color}"
    )
    
    for stack in "${stacks_to_cleanup[@]}"; do
        log_info "Checking stack: $stack"
        
        if aws cloudformation describe-stacks --stack-name "$stack" > /dev/null 2>&1; then
            log_info "Deleting failed stack: $stack"
            
            if aws cloudformation delete-stack --stack-name "$stack"; then
                log_success "Stack deletion initiated: $stack"
            else
                log_error "Failed to delete stack: $stack"
            fi
        else
            log_info "Stack not found (already cleaned up): $stack"
        fi
    done
    
    # Wait for all deletions to complete
    for stack in "${stacks_to_cleanup[@]}"; do
        if aws cloudformation describe-stacks --stack-name "$stack" > /dev/null 2>&1; then
            log_info "Waiting for stack deletion: $stack"
            wait_for_stack_operation "$stack" "DELETE_COMPLETE" 900  # 15 minutes
        fi
    done
    
    log_success "Cleanup completed"
}

# Interactive rollback menu
interactive_rollback() {
    local env=$1
    
    log_info "Interactive rollback for environment: $env"
    
    # Show current deployment status
    local current_color=$(get_current_deployment_color "$env")
    local previous_color=$(get_previous_deployment_color "$current_color")
    
    echo
    log_info "Current deployment status:"
    log_info "  Environment: $env"
    log_info "  Active color: $current_color"
    log_info "  Previous color: $previous_color"
    echo
    
    # Show available rollback options
    echo "Available rollback options:"
    echo "1. Traffic rollback (switch to previous deployment)"
    echo "2. Stack rollback (cancel current update)"
    echo "3. Delete failed stacks"
    echo "4. Full cleanup and redeploy"
    echo "5. List stack versions"
    echo "6. Exit"
    echo
    
    read -p "Select rollback option (1-6): " choice
    
    case $choice in
        1)
            log_info "Performing traffic rollback..."
            traffic_rollback "$env" "$previous_color"
            ;;
        2)
            read -p "Enter stack name to rollback: " stack_name
            stack_rollback "$env" "$stack_name" "cancel-update"
            ;;
        3)
            cleanup_failed_deployment "$env" "$current_color"
            ;;
        4)
            log_warning "Full cleanup and redeploy requires manual intervention"
            cleanup_failed_deployment "$env" "$current_color"
            log_info "After cleanup, run: ./scripts/deploy-pipeline.sh $env blue-green"
            ;;
        5)
            list_stack_versions "$env"
            interactive_rollback "$env"  # Show menu again
            ;;
        6)
            log_info "Exiting rollback script"
            exit 0
            ;;
        *)
            log_error "Invalid option: $choice"
            interactive_rollback "$env"  # Show menu again
            ;;
    esac
}

# Emergency rollback (automated)
emergency_rollback() {
    local env=$1
    
    log_warning "EMERGENCY ROLLBACK INITIATED for environment: $env"
    
    local current_color=$(get_current_deployment_color "$env")
    local previous_color=$(get_previous_deployment_color "$current_color")
    
    log_info "Switching traffic from $current_color to $previous_color"
    
    # Immediate traffic switch
    if traffic_rollback "$env" "$previous_color"; then
        log_success "Emergency traffic rollback completed"
        
        # Clean up failed deployment
        cleanup_failed_deployment "$env" "$current_color"
        
        # Send notification (implement as needed)
        log_warning "EMERGENCY ROLLBACK COMPLETED - Please investigate the cause"
        
        return 0
    else
        log_error "EMERGENCY ROLLBACK FAILED - Manual intervention required"
        return 1
    fi
}

# Main rollback function
main() {
    local environment=$1
    local rollback_type=${2:-interactive}
    local options=$3
    
    log_info "Starting rollback process..."
    log_info "Environment: $environment"
    log_info "Rollback type: $rollback_type"
    
    # Validate inputs
    if ! validate_environment "$environment"; then
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_error "AWS credentials not configured or invalid"
        exit 1
    fi
    
    # Change to project directory
    cd "$PROJECT_ROOT"
    
    # Execute rollback based on type
    case $rollback_type in
        interactive)
            interactive_rollback "$environment"
            ;;
        traffic)
            local target_color=${options:-$(get_previous_deployment_color $(get_current_deployment_color "$environment"))}
            traffic_rollback "$environment" "$target_color"
            ;;
        stack)
            local stack_name=$options
            if [ -z "$stack_name" ]; then
                log_error "Stack name required for stack rollback"
                exit 1
            fi
            stack_rollback "$environment" "$stack_name" "cancel-update"
            ;;
        cleanup)
            local failed_color=${options:-$(get_current_deployment_color "$environment")}
            cleanup_failed_deployment "$environment" "$failed_color"
            ;;
        emergency)
            emergency_rollback "$environment"
            ;;
        *)
            log_error "Invalid rollback type: $rollback_type"
            log_error "Valid types: interactive, traffic, stack, cleanup, emergency"
            exit 1
            ;;
    esac
    
    log_success "Rollback process completed!"
}

# Script execution
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi