#!/bin/bash

# Configure EventBridge targets post-deployment to avoid circular dependencies
# This script adds Lambda function targets to EventBridge rules after both stacks are deployed

set -e

# Default environment
ENVIRONMENT=${1:-dev}

echo "🎯 Configuring EventBridge targets for environment: $ENVIRONMENT"

# Function to get Lambda function ARN
get_lambda_arn() {
    local function_name=$1
    aws lambda get-function --function-name "$function_name" --query 'Configuration.FunctionArn' --output text 2>/dev/null || echo ""
}

# Function to get SQS queue ARN
get_queue_arn() {
    local queue_name=$1
    aws sqs get-queue-attributes --queue-url "$(aws sqs get-queue-url --queue-name "$queue_name" --query 'QueueUrl' --output text)" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text 2>/dev/null || echo ""
}

# Function to check if target exists
target_exists() {
    local rule_name=$1
    local event_bus_name=$2
    local target_id=$3
    
    aws events list-targets-by-rule --rule "$rule_name" --event-bus-name "$event_bus_name" --query "Targets[?Id=='$target_id']" --output text | grep -q "$target_id"
}

# Function to add EventBridge target
add_eventbridge_target() {
    local rule_name=$1
    local event_bus_name=$2
    local lambda_arn=$3
    local dlq_arn=$4
    local target_id=$5
    local max_event_age=${6:-7200}  # 2 hours default
    local retry_attempts=${7:-3}    # 3 retries default
    
    if [ -z "$lambda_arn" ]; then
        echo "❌ Lambda ARN not found for rule $rule_name"
        return 1
    fi
    
    if target_exists "$rule_name" "$event_bus_name" "$target_id"; then
        echo "✅ Target already exists for rule $rule_name, skipping..."
        return 0
    fi
    
    echo "📤 Adding target to rule: $rule_name"
    
    # Build the target JSON
    local target_json="{
        \"Id\": \"$target_id\",
        \"Arn\": \"$lambda_arn\",
        \"RetryPolicy\": {
            \"MaximumRetryAttempts\": $retry_attempts,
            \"MaximumEventAgeInSeconds\": $max_event_age
        }"
    
    # Add DLQ if provided
    if [ -n "$dlq_arn" ]; then
        target_json="$target_json,
        \"DeadLetterConfig\": {
            \"Arn\": \"$dlq_arn\"
        }"
    fi
    
    target_json="$target_json}"
    
    # Add the target
    if aws events put-targets --rule "$rule_name" --event-bus-name "$event_bus_name" --targets "$target_json"; then
        echo "✅ Successfully added target to rule: $rule_name"
        
        # Add Lambda permission for EventBridge to invoke the function
        local statement_id="eventbridge-${rule_name}-${ENVIRONMENT}"
        aws lambda add-permission \
            --function-name "$lambda_arn" \
            --statement-id "$statement_id" \
            --action "lambda:InvokeFunction" \
            --principal "events.amazonaws.com" \
            --source-arn "arn:aws:events:$(aws configure get region):$(aws sts get-caller-identity --query Account --output text):rule/$event_bus_name/$rule_name" \
            2>/dev/null || echo "⚠️  Permission may already exist for $rule_name"
    else
        echo "❌ Failed to add target to rule: $rule_name"
        return 1
    fi
}

# Configuration
EVENT_BUS_NAME="manga-platform-events-$ENVIRONMENT"

# Lambda function names
STORY_LAMBDA="manga-story-generation-$ENVIRONMENT"
EPISODE_LAMBDA="manga-episode-generation-$ENVIRONMENT"
IMAGE_LAMBDA="manga-image-generation-$ENVIRONMENT"

# EventBridge rule names
STORY_RULE="manga-story-generation-rule-$ENVIRONMENT"
EPISODE_RULE="manga-episode-generation-rule-$ENVIRONMENT"
IMAGE_RULE="manga-image-generation-rule-$ENVIRONMENT"

# DLQ names
STORY_DLQ="manga-story-generation-dlq-$ENVIRONMENT"
EPISODE_DLQ="manga-episode-generation-dlq-$ENVIRONMENT"
IMAGE_DLQ="manga-image-generation-dlq-$ENVIRONMENT"

echo "📋 Configuration:"
echo "  Event Bus: $EVENT_BUS_NAME"
echo "  Story Lambda: $STORY_LAMBDA"
echo "  Episode Lambda: $EPISODE_LAMBDA"
echo "  Image Lambda: $IMAGE_LAMBDA"
echo ""

# Get Lambda ARNs
echo "🔍 Getting Lambda function ARNs..."
STORY_LAMBDA_ARN=$(get_lambda_arn "$STORY_LAMBDA")
EPISODE_LAMBDA_ARN=$(get_lambda_arn "$EPISODE_LAMBDA")
IMAGE_LAMBDA_ARN=$(get_lambda_arn "$IMAGE_LAMBDA")

# Get DLQ ARNs
echo "🔍 Getting DLQ ARNs..."
STORY_DLQ_ARN=$(get_queue_arn "$STORY_DLQ")
EPISODE_DLQ_ARN=$(get_queue_arn "$EPISODE_DLQ")
IMAGE_DLQ_ARN=$(get_queue_arn "$IMAGE_DLQ")

# Verify EventBridge bus exists
if ! aws events describe-event-bus --name "$EVENT_BUS_NAME" >/dev/null 2>&1; then
    echo "❌ EventBridge bus '$EVENT_BUS_NAME' not found!"
    echo "💡 Make sure the core infrastructure stack is deployed first."
    exit 1
fi

echo "✅ EventBridge bus found: $EVENT_BUS_NAME"

# Configure targets
echo ""
echo "🎯 Configuring EventBridge targets..."

# Story Generation Target
add_eventbridge_target "$STORY_RULE" "$EVENT_BUS_NAME" "$STORY_LAMBDA_ARN" "$STORY_DLQ_ARN" "1" 7200 3

# Episode Generation Target  
add_eventbridge_target "$EPISODE_RULE" "$EVENT_BUS_NAME" "$EPISODE_LAMBDA_ARN" "$EPISODE_DLQ_ARN" "1" 7200 3

# Image Generation Target
add_eventbridge_target "$IMAGE_RULE" "$EVENT_BUS_NAME" "$IMAGE_LAMBDA_ARN" "$IMAGE_DLQ_ARN" "1" 7200 1

echo ""
echo "🎉 EventBridge target configuration completed!"

# Verify configuration
echo ""
echo "🔍 Verifying configuration..."
for rule in "$STORY_RULE" "$EPISODE_RULE" "$IMAGE_RULE"; do
    target_count=$(aws events list-targets-by-rule --rule "$rule" --event-bus-name "$EVENT_BUS_NAME" --query 'length(Targets)' --output text)
    if [ "$target_count" -gt 0 ]; then
        echo "✅ Rule $rule has $target_count target(s)"
    else
        echo "❌ Rule $rule has no targets"
    fi
done

echo ""
echo "✅ Configuration complete! Your EventBridge rules should now trigger the Lambda functions."
echo ""
echo "🧪 To test the configuration:"
echo "  1. Trigger your preferences processing Lambda"
echo "  2. Check CloudWatch logs for the story generation Lambda"
echo "  3. Use the debug script: node ../debug-eventbridge.js"