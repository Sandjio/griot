#!/usr/bin/env node

/**
 * Debug script to test EventBridge configuration
 * Run this to check if EventBridge events are being published correctly
 */

const {
  EventBridgeClient,
  PutEventsCommand,
} = require("@aws-sdk/client-eventbridge");

async function testEventBridge() {
  console.log("🔍 Testing EventBridge Configuration...\n");

  // Check environment variables
  console.log("📋 Environment Variables:");
  console.log(`  EVENT_BUS_NAME: "${process.env.EVENT_BUS_NAME || "NOT SET"}"`);
  console.log(`  AWS_REGION: "${process.env.AWS_REGION || "NOT SET"}"`);
  console.log(`  AWS_PROFILE: "${process.env.AWS_PROFILE || "NOT SET"}"`);
  console.log("");

  // Initialize EventBridge client
  const eventBridgeClient = new EventBridgeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const eventBusName = process.env.EVENT_BUS_NAME || "";

  console.log(`🎯 Target EventBridge Bus: "${eventBusName}"`);
  if (!eventBusName) {
    console.log(
      "⚠️  WARNING: EVENT_BUS_NAME is empty - events will go to default bus!"
    );
  }
  console.log("");

  // Test event
  const testEvent = {
    source: "manga.preferences",
    "detail-type": "Story Generation Requested",
    detail: {
      userId: "test-user-123",
      requestId: "test-request-456",
      preferences: {
        genres: ["action", "adventure"],
        themes: ["friendship", "courage"],
        artStyle: "manga",
        targetAudience: "teen",
        contentRating: "PG-13",
      },
      insights: {
        recommendations: ["test-recommendation"],
        trends: ["test-trend"],
      },
      timestamp: new Date().toISOString(),
    },
  };

  try {
    console.log("📤 Publishing test event...");

    const command = new PutEventsCommand({
      Entries: [
        {
          Source: testEvent.source,
          DetailType: testEvent["detail-type"],
          Detail: JSON.stringify(testEvent.detail),
          EventBusName: eventBusName,
          Time: new Date(),
        },
      ],
    });

    const response = await eventBridgeClient.send(command);

    console.log("✅ Event published successfully!");
    console.log(`   Event ID: ${response.Entries?.[0]?.EventId}`);
    console.log(`   Failed entries: ${response.FailedEntryCount || 0}`);

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.log(
        "❌ Failed entries:",
        JSON.stringify(
          response.Entries?.filter((e) => e.ErrorCode),
          null,
          2
        )
      );
    }
  } catch (error) {
    console.log("❌ Error publishing event:");
    console.log(`   Error: ${error.message}`);
    console.log(`   Code: ${error.name}`);

    if (error.message.includes("does not exist")) {
      console.log("\n💡 Possible solutions:");
      console.log(
        "   1. Check if the EventBridge bus exists in your AWS account"
      );
      console.log("   2. Verify the EVENT_BUS_NAME environment variable");
      console.log("   3. Ensure you have the correct AWS credentials/profile");
    }

    if (
      error.message.includes("AccessDenied") ||
      error.message.includes("UnauthorizedOperation")
    ) {
      console.log("\n💡 Possible solutions:");
      console.log("   1. Check IAM permissions for events:PutEvents");
      console.log(
        "   2. Verify the EventBridge resource ARN in your IAM policy"
      );
      console.log(
        "   3. Ensure your AWS credentials have the necessary permissions"
      );
    }
  }

  console.log("\n🔧 Next steps:");
  console.log("   1. Check CloudWatch Logs for your Lambda function");
  console.log("   2. Verify EventBridge rules and targets are configured");
  console.log("   3. Check if events are reaching the intended targets");
  console.log(
    "   4. Use AWS CLI: aws events list-rules --event-bus-name <bus-name>"
  );
}

// Run the test
testEventBridge().catch(console.error);
