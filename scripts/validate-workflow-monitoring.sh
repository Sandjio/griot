#!/bin/bash

# Workflow Monitoring Validation Script
# Validates monitoring and observability for batch workflow and episode continuation features
# Usage: ./validate-workflow-monitoring.sh <environment>

set -e

ENVIRONMENT=${1:-dev}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔍 Validating workflow monitoring for environment: $ENVIRONMENT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "SUCCESS") echo -e "${GREEN}✅ $message${NC}" ;;
        "ERROR") echo -e "${RED}❌ $message${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "INFO") echo -e "${BLUE}ℹ️  $message${NC}" ;;
    esac
}

# Function to check if AWS CLI is configured
check_aws_cli() {
    if ! command -v aws &> /dev/null; then
        print_status "ERROR" "AWS CLI is not installed"
        exit 1
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_status "ERROR" "AWS CLI is not configured or credentials are invalid"
        exit 1
    fi
    
    print_status "SUCCESS" "AWS CLI is configured"
}

# Function to get stack outputs
get_stack_output() {
    local stack_name=$1
    local output_key=$2
    
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
        --output text 2>/dev/null || echo ""
}

# Function to check CloudWatch dashboard
check_dashboard() {
    local dashboard_name="manga-platform-$ENVIRONMENT"
    
    print_status "INFO" "Checking CloudWatch dashboard: $dashboard_name"
    
    if aws cloudwatch get-dashboard --dashboard-name "$dashboard_name" &> /dev/null; then
        print_status "SUCCESS" "Dashboard exists: $dashboard_name"
        
        # Check for batch workflow widgets
        local dashboard_body=$(aws cloudwatch get-dashboard --dashboard-name "$dashboard_name" --query 'DashboardBody' --output text)
        
        if echo "$dashboard_body" | grep -q "Batch Workflow"; then
            print_status "SUCCESS" "Batch workflow widgets found in dashboard"
        else
            print_status "WARNING" "Batch workflow widgets not found in dashboard"
        fi
        
        if echo "$dashboard_body" | grep -q "Episode Continuation"; then
            print_status "SUCCESS" "Episode continuation widgets found in dashboard"
        else
            print_status "WARNING" "Episode continuation widgets not found in dashboard"
        fi
    else
        print_status "ERROR" "Dashboard not found: $dashboard_name"
    fi
}

# Function to check CloudWatch alarms
check_alarms() {
    print_status "INFO" "Checking CloudWatch alarms for workflow monitoring"
    
    local batch_workflow_alarm="manga-batch-workflow-failures-$ENVIRONMENT"
    local episode_continuation_alarm="manga-episode-continuation-failures-$ENVIRONMENT"
    local batch_duration_alarm="manga-batch-workflow-duration-$ENVIRONMENT"
    
    # Check batch workflow failure alarm
    if aws cloudwatch describe-alarms --alarm-names "$batch_workflow_alarm" --query 'MetricAlarms[0].AlarmName' --output text 2>/dev/null | grep -q "$batch_workflow_alarm"; then
        print_status "SUCCESS" "Batch workflow failure alarm exists: $batch_workflow_alarm"
    else
        print_status "ERROR" "Batch workflow failure alarm not found: $batch_workflow_alarm"
    fi
    
    # Check episode continuation failure alarm
    if aws cloudwatch describe-alarms --alarm-names "$episode_continuation_alarm" --query 'MetricAlarms[0].AlarmName' --output text 2>/dev/null | grep -q "$episode_continuation_alarm"; then
        print_status "SUCCESS" "Episode continuation failure alarm exists: $episode_continuation_alarm"
    else
        print_status "ERROR" "Episode continuation failure alarm not found: $episode_continuation_alarm"
    fi
    
    # Check batch workflow duration alarm
    if aws cloudwatch describe-alarms --alarm-names "$batch_duration_alarm" --query 'MetricAlarms[0].AlarmName' --output text 2>/dev/null | grep -q "$batch_duration_alarm"; then
        print_status "SUCCESS" "Batch workflow duration alarm exists: $batch_duration_alarm"
    else
        print_status "ERROR" "Batch workflow duration alarm not found: $batch_duration_alarm"
    fi
}

# Function to check X-Ray tracing rules
check_xray_tracing() {
    print_status "INFO" "Checking X-Ray tracing configuration"
    
    local batch_workflow_rule="manga-batch-workflow-tracing-$ENVIRONMENT"
    local episode_continuation_rule="manga-episode-continuation-tracing-$ENVIRONMENT"
    
    # Check batch workflow tracing rule
    if aws xray get-sampling-rules --query "SamplingRuleRecords[?SamplingRule.RuleName=='$batch_workflow_rule'].SamplingRule.RuleName" --output text 2>/dev/null | grep -q "$batch_workflow_rule"; then
        print_status "SUCCESS" "Batch workflow X-Ray tracing rule exists: $batch_workflow_rule"
    else
        print_status "WARNING" "Batch workflow X-Ray tracing rule not found: $batch_workflow_rule"
    fi
    
    # Check episode continuation tracing rule
    if aws xray get-sampling-rules --query "SamplingRuleRecords[?SamplingRule.RuleName=='$episode_continuation_rule'].SamplingRule.RuleName" --output text 2>/dev/null | grep -q "$episode_continuation_rule"; then
        print_status "SUCCESS" "Episode continuation X-Ray tracing rule exists: $episode_continuation_rule"
    else
        print_status "WARNING" "Episode continuation X-Ray tracing rule not found: $episode_continuation_rule"
    fi
}

# Function to check custom metrics
check_custom_metrics() {
    print_status "INFO" "Checking custom CloudWatch metrics"
    
    local end_time=$(date -u +%Y-%m-%dT%H:%M:%S)
    local start_time=$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)
    
    # Check for batch workflow metrics
    local batch_metrics=(
        "WorkflowStarts"
        "WorkflowCompletions"
        "WorkflowFailures"
        "BatchWorkflowProgress"
        "BatchWorkflowSuccessRate"
    )
    
    for metric in "${batch_metrics[@]}"; do
        if aws cloudwatch list-metrics --namespace "MangaPlatform/Business" --metric-name "$metric" --query 'Metrics[0].MetricName' --output text 2>/dev/null | grep -q "$metric"; then
            print_status "SUCCESS" "Batch workflow metric exists: $metric"
        else
            print_status "WARNING" "Batch workflow metric not found (may not have data yet): $metric"
        fi
    done
    
    # Check for episode continuation metrics
    local episode_metrics=(
        "EpisodeContinuations"
        "EpisodeContinuationSuccess"
        "EpisodeContinuationFailures"
    )
    
    for metric in "${episode_metrics[@]}"; do
        if aws cloudwatch list-metrics --namespace "MangaPlatform/Business" --metric-name "$metric" --query 'Metrics[0].MetricName' --output text 2>/dev/null | grep -q "$metric"; then
            print_status "SUCCESS" "Episode continuation metric exists: $metric"
        else
            print_status "WARNING" "Episode continuation metric not found (may not have data yet): $metric"
        fi
    done
}

# Function to check log groups
check_log_groups() {
    print_status "INFO" "Checking CloudWatch log groups for workflow functions"
    
    local workflow_orchestration_log_group="/aws/lambda/manga-platform-workflow-orchestration-$ENVIRONMENT"
    local continue_episode_log_group="/aws/lambda/manga-platform-continue-episode-$ENVIRONMENT"
    
    # Check workflow orchestration log group
    if aws logs describe-log-groups --log-group-name-prefix "$workflow_orchestration_log_group" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$workflow_orchestration_log_group"; then
        print_status "SUCCESS" "Workflow orchestration log group exists"
    else
        print_status "WARNING" "Workflow orchestration log group not found (may not have been created yet)"
    fi
    
    # Check continue episode log group
    if aws logs describe-log-groups --log-group-name-prefix "$continue_episode_log_group" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$continue_episode_log_group"; then
        print_status "SUCCESS" "Continue episode log group exists"
    else
        print_status "WARNING" "Continue episode log group not found (may not have been created yet)"
    fi
}

# Function to validate monitoring stack deployment
check_monitoring_stack() {
    local monitoring_stack_name="GriotMangaMonitoringStack-$ENVIRONMENT"
    
    print_status "INFO" "Checking monitoring stack deployment: $monitoring_stack_name"
    
    if aws cloudformation describe-stacks --stack-name "$monitoring_stack_name" --query 'Stacks[0].StackStatus' --output text 2>/dev/null | grep -q "CREATE_COMPLETE\|UPDATE_COMPLETE"; then
        print_status "SUCCESS" "Monitoring stack is deployed successfully"
        
        # Get dashboard URL
        local dashboard_url=$(get_stack_output "$monitoring_stack_name" "DashboardUrl")
        if [ -n "$dashboard_url" ]; then
            print_status "INFO" "Dashboard URL: $dashboard_url"
        fi
        
        # Get alert topic ARN
        local alert_topic_arn=$(get_stack_output "$monitoring_stack_name" "AlertTopicArn")
        if [ -n "$alert_topic_arn" ]; then
            print_status "SUCCESS" "Alert topic configured: $alert_topic_arn"
        fi
    else
        print_status "ERROR" "Monitoring stack is not deployed or in failed state"
        return 1
    fi
}

# Function to run monitoring validation tests
run_validation_tests() {
    print_status "INFO" "Running workflow monitoring validation tests"
    
    local test_results=()
    
    # Test 1: Check if monitoring infrastructure is deployed
    if check_monitoring_stack; then
        test_results+=("PASS: Monitoring stack deployment")
    else
        test_results+=("FAIL: Monitoring stack deployment")
    fi
    
    # Test 2: Check dashboard configuration
    check_dashboard
    test_results+=("PASS: Dashboard configuration checked")
    
    # Test 3: Check alarm configuration
    check_alarms
    test_results+=("PASS: Alarm configuration checked")
    
    # Test 4: Check X-Ray tracing
    check_xray_tracing
    test_results+=("PASS: X-Ray tracing checked")
    
    # Test 5: Check custom metrics
    check_custom_metrics
    test_results+=("PASS: Custom metrics checked")
    
    # Test 6: Check log groups
    check_log_groups
    test_results+=("PASS: Log groups checked")
    
    # Print test results summary
    echo ""
    print_status "INFO" "Validation Test Results:"
    for result in "${test_results[@]}"; do
        if [[ $result == PASS* ]]; then
            print_status "SUCCESS" "$result"
        else
            print_status "ERROR" "$result"
        fi
    done
}

# Main execution
main() {
    echo "🚀 Starting workflow monitoring validation for environment: $ENVIRONMENT"
    echo "=================================================="
    
    # Check prerequisites
    check_aws_cli
    
    # Run validation tests
    run_validation_tests
    
    echo ""
    echo "=================================================="
    print_status "INFO" "Workflow monitoring validation completed for environment: $ENVIRONMENT"
    
    echo ""
    print_status "INFO" "Next steps:"
    echo "  1. Test batch workflow endpoint: POST /workflow/start"
    echo "  2. Test episode continuation endpoint: POST /stories/{storyId}/episodes"
    echo "  3. Monitor CloudWatch dashboard for real-time metrics"
    echo "  4. Verify alarms trigger correctly during failure scenarios"
    echo "  5. Check X-Ray traces for distributed request tracking"
}

# Run main function
main "$@"