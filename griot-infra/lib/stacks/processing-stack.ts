import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { SecurityConstruct } from "../constructs/security-construct";
import { LambdaMonitoringConstruct } from "../constructs/lambda-monitoring-construct";
import { EventBridgeConstruct } from "../constructs/eventbridge-construct";
import { EnvironmentConfig } from "../config/environment-config";

export interface ProcessingStackProps extends cdk.StackProps {
  environment: string;
  envConfig: EnvironmentConfig;
  deploymentColor?: string;
  deploymentId?: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  eventBus: events.EventBus;
  eventBridgeConstruct: EventBridgeConstruct;
  securityConstruct: SecurityConstruct;
  vpc?: ec2.Vpc;
}

/**
 * Processing Stack that contains all the content generation Lambda functions
 * with comprehensive security configurations and monitoring.
 *
 * Requirements: 9.3, 6.6
 */
export class ProcessingStack extends cdk.Stack {
  public readonly securityConstruct: SecurityConstruct;
  public readonly lambdaFunctions: { [key: string]: lambda.Function } = {};
  public readonly monitoringConstructs: {
    [key: string]: LambdaMonitoringConstruct;
  } = {};

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    // Use Security Construct from props
    this.securityConstruct = props.securityConstruct;

    // Create Lambda functions with security configurations
    this.createStoryGenerationLambda(props);
    this.createEpisodeGenerationLambda(props);
    this.createImageGenerationLambda(props);

    // Configure EventBridge rules to trigger Lambda functions
    // Note: EventBridge targets are configured post-deployment to avoid circular dependencies
    // See scripts/configure-eventbridge-targets.sh
  }

  /**
   * Create Story Generation Lambda function with security configuration
   */
  private createStoryGenerationLambda(props: ProcessingStackProps): void {
    // Create monitoring construct
    this.monitoringConstructs.storyGeneration = new LambdaMonitoringConstruct(
      this,
      "StoryGenerationMonitoring",
      {
        functionName: `manga-story-generation-${props.environment}`,
        environment: props.environment,
        enableXRay: true,
      }
    );

    // Create Lambda function
    const storyGenerationLambda = new lambda.Function(
      this,
      "StoryGenerationLambda",
      {
        functionName: `manga-story-generation-${props.environment}`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("../src/lambdas/story-generation"),
        role: this.securityConstruct.storyGenerationRole,
        environment: {
          MANGA_TABLE_NAME: props.mangaTable.tableName,
          CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
          EVENT_BUS_NAME: props.eventBus.eventBusName,
          ENVIRONMENT: props.environment,
          // Security-related environment variables
          ENABLE_SECURITY_LOGGING: "true",
          SECURITY_CONTEXT: "storyGeneration",
          // Bedrock configuration
          BEDROCK_REGION: this.region,
          BEDROCK_MODEL_ID: "anthropic.claude-3-sonnet-20240229-v1:0",
        },
        timeout: cdk.Duration.minutes(5), // Story generation can take longer
        memorySize: 1024, // More memory for AI processing
        // Enable X-Ray tracing
        tracing: lambda.Tracing.ACTIVE,
        // VPC configuration if provided
        ...(props.vpc
          ? {
              vpc: props.vpc,
              vpcSubnets: {
                subnets: props.vpc.privateSubnets,
              },
            }
          : {}),
        // Dead letter queue configuration
        deadLetterQueue: props.eventBridgeConstruct.storyGenerationDLQ,
        deadLetterQueueEnabled: true,
        // Retry configuration
        retryAttempts: 2,
      }
    );

    // Apply monitoring configuration
    this.monitoringConstructs.storyGeneration.applyToFunction(
      storyGenerationLambda
    );

    // Store Lambda function reference
    this.lambdaFunctions.storyGeneration = storyGenerationLambda;
  }

  /**
   * Create Episode Generation Lambda function with security configuration
   */
  private createEpisodeGenerationLambda(props: ProcessingStackProps): void {
    // Create monitoring construct
    this.monitoringConstructs.episodeGeneration = new LambdaMonitoringConstruct(
      this,
      "EpisodeGenerationMonitoring",
      {
        functionName: `manga-episode-generation-${props.environment}`,
        environment: props.environment,
        enableXRay: true,
      }
    );

    // Create Lambda function
    const episodeGenerationLambda = new lambda.Function(
      this,
      "EpisodeGenerationLambda",
      {
        functionName: `manga-episode-generation-${props.environment}`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("../src/lambdas/episode-generation"),
        role: this.securityConstruct.episodeGenerationRole,
        environment: {
          MANGA_TABLE_NAME: props.mangaTable.tableName,
          CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
          EVENT_BUS_NAME: props.eventBus.eventBusName,
          ENVIRONMENT: props.environment,
          // Security-related environment variables
          ENABLE_SECURITY_LOGGING: "true",
          SECURITY_CONTEXT: "episodeGeneration",
          // Bedrock configuration
          BEDROCK_REGION: this.region,
          BEDROCK_MODEL_ID: "anthropic.claude-3-sonnet-20240229-v1:0",
        },
        timeout: cdk.Duration.minutes(3), // Episode generation timeout
        memorySize: 1024, // More memory for AI processing
        // Enable X-Ray tracing
        tracing: lambda.Tracing.ACTIVE,
        // VPC configuration if provided
        ...(props.vpc
          ? {
              vpc: props.vpc,
              vpcSubnets: {
                subnets: props.vpc.privateSubnets,
              },
            }
          : {}),
        // Dead letter queue configuration
        deadLetterQueue: props.eventBridgeConstruct.episodeGenerationDLQ,
        deadLetterQueueEnabled: true,
        // Retry configuration
        retryAttempts: 2,
      }
    );

    // Apply monitoring configuration
    this.monitoringConstructs.episodeGeneration.applyToFunction(
      episodeGenerationLambda
    );

    // Store Lambda function reference
    this.lambdaFunctions.episodeGeneration = episodeGenerationLambda;
  }

  /**
   * Create Image Generation Lambda function with security configuration
   */
  private createImageGenerationLambda(props: ProcessingStackProps): void {
    // Create monitoring construct
    this.monitoringConstructs.imageGeneration = new LambdaMonitoringConstruct(
      this,
      "ImageGenerationMonitoring",
      {
        functionName: `manga-image-generation-${props.environment}`,
        environment: props.environment,
        enableXRay: true,
      }
    );

    // Create Lambda function
    const imageGenerationLambda = new lambda.Function(
      this,
      "ImageGenerationLambda",
      {
        functionName: `manga-image-generation-${props.environment}`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset("../src/lambdas/image-generation"),
        role: this.securityConstruct.imageGenerationRole,
        environment: {
          MANGA_TABLE_NAME: props.mangaTable.tableName,
          CONTENT_BUCKET_NAME: props.contentBucket.bucketName,
          EVENT_BUS_NAME: props.eventBus.eventBusName,
          ENVIRONMENT: props.environment,
          // Security-related environment variables
          ENABLE_SECURITY_LOGGING: "true",
          SECURITY_CONTEXT: "imageGeneration",
          // Bedrock configuration
          BEDROCK_REGION: this.region,
          BEDROCK_IMAGE_MODEL_ID: "stability.stable-diffusion-xl-v1",
        },
        timeout: cdk.Duration.minutes(10), // Image generation can take longer
        memorySize: 2048, // More memory for image processing
        // Enable X-Ray tracing
        tracing: lambda.Tracing.ACTIVE,
        // VPC configuration if provided
        ...(props.vpc
          ? {
              vpc: props.vpc,
              vpcSubnets: {
                subnets: props.vpc.privateSubnets,
              },
            }
          : {}),
        // Dead letter queue configuration
        deadLetterQueue: props.eventBridgeConstruct.imageGenerationDLQ,
        deadLetterQueueEnabled: true,
        // Retry configuration
        retryAttempts: 1, // Fewer retries for expensive image generation
      }
    );

    // Apply monitoring configuration
    this.monitoringConstructs.imageGeneration.applyToFunction(
      imageGenerationLambda
    );

    // Store Lambda function reference
    this.lambdaFunctions.imageGeneration = imageGenerationLambda;
  }

  /**
   * Configure EventBridge targets directly to avoid circular dependencies
   */
  private configureEventBridgeTargetsDirectly(
    props: ProcessingStackProps
  ): void {
    // Add Lambda targets directly to the EventBridge rules
    props.eventBridgeConstruct.storyGenerationRule.addTarget(
      new targets.LambdaFunction(this.lambdaFunctions.storyGeneration, {
        deadLetterQueue: props.eventBridgeConstruct.storyGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );

    props.eventBridgeConstruct.episodeGenerationRule.addTarget(
      new targets.LambdaFunction(this.lambdaFunctions.episodeGeneration, {
        deadLetterQueue: props.eventBridgeConstruct.episodeGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );

    props.eventBridgeConstruct.imageGenerationRule.addTarget(
      new targets.LambdaFunction(this.lambdaFunctions.imageGeneration, {
        deadLetterQueue: props.eventBridgeConstruct.imageGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );
  }

  /**
   * Configure EventBridge rules to trigger Lambda functions
   */
  private configureEventBridgeRules(props: ProcessingStackProps): void {
    // Configure EventBridge rules to trigger the Lambda functions
    props.eventBridgeConstruct.addStoryGenerationTarget(
      this.lambdaFunctions.storyGeneration
    );
    props.eventBridgeConstruct.addEpisodeGenerationTarget(
      this.lambdaFunctions.episodeGeneration
    );
    props.eventBridgeConstruct.addImageGenerationTarget(
      this.lambdaFunctions.imageGeneration
    );
  }

  /**
   * Configure EventBridge targets after stack creation to avoid circular dependencies
   */
  public configureEventBridgeTargets(
    eventBridgeConstruct: EventBridgeConstruct
  ): void {
    // Configure EventBridge rules to trigger the Lambda functions
    eventBridgeConstruct.addStoryGenerationTarget(
      this.lambdaFunctions.storyGeneration
    );
    eventBridgeConstruct.addEpisodeGenerationTarget(
      this.lambdaFunctions.episodeGeneration
    );
    eventBridgeConstruct.addImageGenerationTarget(
      this.lambdaFunctions.imageGeneration
    );
  }

  /**
   * Get all Lambda functions for monitoring stack integration
   */
  public getAllLambdaFunctions(): { [key: string]: lambda.Function } {
    return this.lambdaFunctions;
  }
}
