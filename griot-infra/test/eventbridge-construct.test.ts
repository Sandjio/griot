import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Template } from "aws-cdk-lib/assertions";
import { EventBridgeConstruct } from "../lib/constructs/eventbridge-construct";

describe("EventBridgeConstruct", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let eventBus: events.EventBus;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack");
    eventBus = new events.EventBus(stack, "TestEventBus", {
      eventBusName: "test-event-bus",
    });
  });

  test("creates all required DLQs", () => {
    new EventBridgeConstruct(stack, "TestEventBridge", {
      eventBus,
      environment: "test",
    });

    const template = Template.fromStack(stack);

    // Check that all DLQs are created
    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "manga-story-generation-dlq-test",
      MessageRetentionPeriod: 1209600, // 14 days in seconds
    });

    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "manga-episode-generation-dlq-test",
      MessageRetentionPeriod: 1209600,
    });

    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "manga-image-generation-dlq-test",
      MessageRetentionPeriod: 1209600,
    });

    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "manga-status-update-dlq-test",
      MessageRetentionPeriod: 1209600,
    });
  });

  test("creates all EventBridge rules with correct patterns", () => {
    new EventBridgeConstruct(stack, "TestEventBridge", {
      eventBus,
      environment: "test",
    });

    const template = Template.fromStack(stack);

    // Story Generation Rule
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "manga-story-generation-rule-test",
      EventPattern: {
        source: ["manga.preferences"],
        "detail-type": ["Story Generation Requested"],
      },
      Description: "Route story generation events to Story Generation Lambda",
    });

    // Episode Generation Rule
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "manga-episode-generation-rule-test",
      EventPattern: {
        source: ["manga.story"],
        "detail-type": ["Episode Generation Requested"],
      },
      Description:
        "Route episode generation events to Episode Generation Lambda",
    });

    // Image Generation Rule
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "manga-image-generation-rule-test",
      EventPattern: {
        source: ["manga.episode"],
        "detail-type": ["Image Generation Requested"],
      },
      Description: "Route image generation events to Image Generation Lambda",
    });

    // Status Update Rule
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "manga-status-update-rule-test",
      EventPattern: {
        source: ["manga.generation"],
        "detail-type": ["Generation Status Updated"],
      },
      Description:
        "Route status update events for monitoring and notifications",
    });
  });

  test("adds Lambda targets with DLQ configuration", () => {
    const eventBridgeConstruct = new EventBridgeConstruct(
      stack,
      "TestEventBridge",
      {
        eventBus,
        environment: "test",
      }
    );

    // Create a test Lambda function
    const testLambda = new lambda.Function(stack, "TestLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {};"),
    });

    // Add Lambda as target
    eventBridgeConstruct.addStoryGenerationTarget(testLambda);

    const template = Template.fromStack(stack);

    // Check that Lambda permission is created
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
    });
  });

  test("grants EventBridge permissions to Lambda", () => {
    const eventBridgeConstruct = new EventBridgeConstruct(
      stack,
      "TestEventBridge",
      {
        eventBus,
        environment: "test",
      }
    );

    const testLambda = new lambda.Function(stack, "TestLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {};"),
    });

    eventBridgeConstruct.grantEventBridgePermissions(testLambda, eventBus);

    const template = Template.fromStack(stack);

    // Check that IAM policy is created with EventBridge permissions
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "events:PutEvents",
          },
        ],
      },
    });
  });

  test("exposes DLQ properties for external access", () => {
    const eventBridgeConstruct = new EventBridgeConstruct(
      stack,
      "TestEventBridge",
      {
        eventBus,
        environment: "test",
      }
    );

    // Check that DLQ properties are accessible
    expect(eventBridgeConstruct.storyGenerationDLQ).toBeDefined();
    expect(eventBridgeConstruct.episodeGenerationDLQ).toBeDefined();
    expect(eventBridgeConstruct.imageGenerationDLQ).toBeDefined();
    expect(eventBridgeConstruct.statusUpdateDLQ).toBeDefined();
  });

  test("configures DLQ encryption", () => {
    new EventBridgeConstruct(stack, "TestEventBridge", {
      eventBus,
      environment: "test",
    });

    const template = Template.fromStack(stack);

    // Check that all queues have SQS managed encryption
    template.hasResourceProperties("AWS::SQS::Queue", {
      SqsManagedSseEnabled: true,
    });
  });

  test("all target methods work correctly", () => {
    const eventBridgeConstruct = new EventBridgeConstruct(
      stack,
      "TestEventBridge",
      {
        eventBus,
        environment: "test",
      }
    );

    const testLambda = new lambda.Function(stack, "TestLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {};"),
    });

    // Test all target addition methods
    expect(() => {
      eventBridgeConstruct.addStoryGenerationTarget(testLambda);
      eventBridgeConstruct.addEpisodeGenerationTarget(testLambda);
      eventBridgeConstruct.addImageGenerationTarget(testLambda);
      eventBridgeConstruct.addStatusUpdateTarget(testLambda);
    }).not.toThrow();

    const template = Template.fromStack(stack);

    // Should have multiple Lambda permissions (one for each rule)
    template.resourceCountIs("AWS::Lambda::Permission", 4);
  });
});
