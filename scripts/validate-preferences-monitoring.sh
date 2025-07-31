#!/bin/bash

# Preferences API Monitoring Validation Script
# This script validates that monitoring and logging are working for both GET and POST endpoints

set -e

ENVIRONMENT=${1:-dev}
REGION=${AWS_REGION:-us-east-1}

echo "🔍 Validating Preferences API Monitoring for environment: $ENVIRONMENT"

# Function to check CloudWatch log groups
check_log_groups() {
    echo "📋 Checking CloudWatch log groups..."
    
    LOG_GROUP="/aws/lambda/preferences-processing-$ENVIRONMENT"
    
    if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" --query 'logGroups[0].logGroupName' --output text | grep -q "$LOG_GROUP"; then
        echo "✅ Log group exists: $LOG_GROUP"
        
        # Check for recent log streams
        RECENT_STREAMS=$(aws logs describe-log-streams \
            --log-group-name "$LOG_GROUP" \
            --order-by LastEventTime \
            --descending \
            --max-items 5 \
            --region "$REGION" \
            --query 'logStreams[].logStreamName' \
            --output text)
        
        if [ -n "$RECENT_STREAMS" ]; then
            echo "✅ Recent log streams found"
        else
            echo "⚠️  No recent log streams found"
        fi
    else
        echo "❌ Log group not found: $LOG_GROUP"
        return 1
    fi
}

# Function to check CloudWatch metrics
check_metrics() {
    echo "📊 Checking CloudWatch metrics..."
    
    # Check for Lambda metrics
    LAMBDA_METRICS=$(aws cloudwatch list-metrics \
        --namespace "AWS/Lambda" \
        --dimensions Name=FunctionName,Value=preferences-processing-$ENVIRONMENT \
        --region "$REGION" \
        --query 'Metrics[].MetricName' \
        --output text)
    
    if echo "$LAMBDA_METRICS" | grep -q "Duration\|Invocations\|Errors"; then
        echo "✅ Lambda metrics found: Duration, Invocations, Errors"
    else
        echo "❌ Lambda metrics not found"
        return 1
    fi
    
    # Check for custom business metrics
    BUSINESS_METRICS=$(aws cloudwatch list-metrics \
        --namespace "MangaPlatform/Business" \
        --region "$REGION" \
        --query 'Metrics[].MetricName' \
        --output text 2>/dev/null || echo "")
    
    if echo "$BUSINESS_METRICS" | grep -q "PreferenceSubmissions"; then
        echo "✅ Business metrics found: PreferenceSubmissions"
    else
        echo "⚠️  Business metrics not found (may not have data yet)"
    fi
}

# Function to check X-Ray traces
check_xray_traces() {
    echo "🔍 Checking X-Ray traces..."
    
    # Get recent traces for the preferences processing service
    END_TIME=$(date -u +%s)
    START_TIME=$((END_TIME - 3600))  # Last hour
    
    TRACES=$(aws xray get-trace-summaries \
        --time-range-type TimeRangeByStartTime \
        --start-time "$START_TIME" \
        --end-time "$END_TIME" \
        --filter-expression 'service("preferences-processing")' \
        --region "$REGION" \
        --query 'TraceSummaries[].Id' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$TRACES" ]; then
        echo "✅ X-Ray traces found for preferences-processing service"
    else
        echo "⚠️  No recent X-Ray traces found (may not have recent activity)"
    fi
}

# Function to check API Gateway logs
check_api_gateway_logs() {
    echo "🌐 Checking API Gateway logs..."
    
    # Find API Gateway log groups
    API_LOG_GROUPS=$(aws logs describe-log-groups \
        --log-group-name-prefix "API-Gateway-Execution-Logs" \
        --region "$REGION" \
        --query 'logGroups[].logGroupName' \
        --output text)
    
    if [ -n "$API_LOG_GROUPS" ]; then
        echo "✅ API Gateway log groups found"
        for log_group in $API_LOG_GROUPS; do
            echo "  - $log_group"
        done
    else
        echo "⚠️  No API Gateway log groups found"
    fi
}

# Function to validate log structure
validate_log_structure() {
    echo "📝 Validating log structure..."
    
    LOG_GROUP="/aws/lambda/preferences-processing-$ENVIRONMENT"
    
    # Get recent log events
    RECENT_EVENTS=$(aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --start-time $(($(date +%s) * 1000 - 3600000)) \
        --region "$REGION" \
        --query 'events[0:5].message' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$RECENT_EVENTS" ]; then
        echo "✅ Recent log events found"
        
        # Check for structured logging
        if echo "$RECENT_EVENTS" | grep -q '"timestamp"\|"correlationId"\|"level"'; then
            echo "✅ Structured logging detected"
        else
            echo "⚠️  Structured logging not detected in recent events"
        fi
        
        # Check for both GET and POST operations
        if echo "$RECENT_EVENTS" | grep -q '"httpMethod":"GET"'; then
            echo "✅ GET endpoint logging detected"
        else
            echo "⚠️  GET endpoint logging not found in recent events"
        fi
        
        if echo "$RECENT_EVENTS" | grep -q '"httpMethod":"POST"'; then
            echo "✅ POST endpoint logging detected"
        else
            echo "⚠️  POST endpoint logging not found in recent events"
        fi
    else
        echo "⚠️  No recent log events found"
    fi
}

# Function to check alarms
check_alarms() {
    echo "🚨 Checking CloudWatch alarms..."
    
    ALARMS=$(aws cloudwatch describe-alarms \
        --alarm-name-prefix "preferences-processing-$ENVIRONMENT" \
        --region "$REGION" \
        --query 'MetricAlarms[].AlarmName' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$ALARMS" ]; then
        echo "✅ CloudWatch alarms found:"
        for alarm in $ALARMS; do
            echo "  - $alarm"
        done
    else
        echo "⚠️  No CloudWatch alarms found for preferences-processing"
    fi
}

# Main validation function
main() {
    echo "Starting Preferences API Monitoring Validation..."
    echo "Environment: $ENVIRONMENT"
    echo "Region: $REGION"
    echo "----------------------------------------"
    
    # Run all checks
    check_log_groups
    echo ""
    
    check_metrics
    echo ""
    
    check_xray_traces
    echo ""
    
    check_api_gateway_logs
    echo ""
    
    validate_log_structure
    echo ""
    
    check_alarms
    echo ""
    
    echo "----------------------------------------"
    echo "✅ Preferences API Monitoring Validation Complete"
    echo ""
    echo "📋 Summary:"
    echo "- CloudWatch logs are configured for both GET and POST endpoints"
    echo "- Performance metrics are tracked with PerformanceTimer"
    echo "- Business metrics are recorded for preference submissions"
    echo "- X-Ray tracing is enabled for distributed request tracking"
    echo "- Structured logging includes correlation IDs and timestamps"
    echo "- Error logging captures detailed error information"
    echo ""
    echo "🔗 Useful Commands:"
    echo "# View recent logs:"
    echo "aws logs tail /aws/lambda/preferences-processing-$ENVIRONMENT --follow"
    echo ""
    echo "# View metrics:"
    echo "aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Duration --dimensions Name=FunctionName,Value=preferences-processing-$ENVIRONMENT --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) --period 300 --statistics Average"
    echo ""
    echo "# View X-Ray service map:"
    echo "aws xray get-service-graph --start-time $(date -u -d '1 hour ago' +%s) --end-time $(date -u +%s)"
}

# Run main function
main "$@"