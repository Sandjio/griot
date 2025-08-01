import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface EventBridgeConstructProps {
  eventBus: events.EventBus;
  environment: string;
  alertingTopic?: sns.Topic;
}

export class EventBridgeConstruct extends Construct {
  public readonly storyGenerationDLQ: sqs.Queue;
  public readonly episodeGenerationDLQ: sqs.Queue;
  public readonly imageGenerationDLQ: sqs.Queue;
  public readonly statusUpdateDLQ: sqs.Queue;

  public readonly storyGenerationRule: events.Rule;
  public readonly episodeGenerationRule: events.Rule;
  public readonly imageGenerationRule: events.Rule;
  public readonly statusUpdateRule: events.Rule;

  constructor(scope: Construct, id: string, props: EventBridgeConstructProps) {
    super(scope, id);

    // Create Dead Letter Queues for each event type with enhanced configuration
    this.storyGenerationDLQ = new sqs.Queue(this, "StoryGenerationDLQ", {
      queueName: `manga-story-generation-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: undefined, // DLQ doesn't need its own DLQ
    });

    this.episodeGenerationDLQ = new sqs.Queue(this, "EpisodeGenerationDLQ", {
      queueName: `manga-episode-generation-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
    });

    this.imageGenerationDLQ = new sqs.Queue(this, "ImageGenerationDLQ", {
      queueName: `manga-image-generation-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(5),
    });

    this.statusUpdateDLQ = new sqs.Queue(this, "StatusUpdateDLQ", {
      queueName: `manga-status-update-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(2),
    });

    // Create CloudWatch alarms for DLQ monitoring
    this.createDLQAlarms(props);

    // Create EventBridge Rules for each event type
    this.storyGenerationRule = new events.Rule(this, "StoryGenerationRule", {
      ruleName: `manga-story-generation-rule-${props.environment}`,
      eventBus: props.eventBus,
      eventPattern: {
        source: ["manga.preferences", "manga.workflow"],
        detailType: [
          "Story Generation Requested",
          "Batch Story Generation Requested",
        ],
      },
      description: "Route story generation events to Story Generation Lambda",
    });

    this.episodeGenerationRule = new events.Rule(
      this,
      "EpisodeGenerationRule",
      {
        ruleName: `manga-episode-generation-rule-${props.environment}`,
        eventBus: props.eventBus,
        eventPattern: {
          source: ["manga.story"],
          detailType: ["Episode Generation Requested"],
        },
        description:
          "Route episode generation events to Episode Generation Lambda",
      }
    );

    this.imageGenerationRule = new events.Rule(this, "ImageGenerationRule", {
      ruleName: `manga-image-generation-rule-${props.environment}`,
      eventBus: props.eventBus,
      eventPattern: {
        source: ["manga.episode"],
        detailType: ["Image Generation Requested"],
      },
      description: "Route image generation events to Image Generation Lambda",
    });

    this.statusUpdateRule = new events.Rule(this, "StatusUpdateRule", {
      ruleName: `manga-status-update-rule-${props.environment}`,
      eventBus: props.eventBus,
      eventPattern: {
        source: ["manga.generation"],
        detailType: ["Generation Status Updated"],
      },
      description:
        "Route status update events for monitoring and notifications",
    });

    // Output DLQ ARNs for monitoring
    new cdk.CfnOutput(this, "StoryGenerationDLQArn", {
      value: this.storyGenerationDLQ.queueArn,
      exportName: `story-generation-dlq-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "EpisodeGenerationDLQArn", {
      value: this.episodeGenerationDLQ.queueArn,
      exportName: `episode-generation-dlq-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "ImageGenerationDLQArn", {
      value: this.imageGenerationDLQ.queueArn,
      exportName: `image-generation-dlq-arn-${props.environment}`,
    });
  }

  /**
   * Add Lambda function as target to story generation rule
   */
  public addStoryGenerationTarget(lambdaFunction: lambda.Function): void {
    this.storyGenerationRule.addTarget(
      new targets.LambdaFunction(lambdaFunction, {
        deadLetterQueue: this.storyGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );
  }

  /**
   * Add Lambda function as target to episode generation rule
   */
  public addEpisodeGenerationTarget(lambdaFunction: lambda.Function): void {
    this.episodeGenerationRule.addTarget(
      new targets.LambdaFunction(lambdaFunction, {
        deadLetterQueue: this.episodeGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );
  }

  /**
   * Add Lambda function as target to image generation rule
   */
  public addImageGenerationTarget(lambdaFunction: lambda.Function): void {
    this.imageGenerationRule.addTarget(
      new targets.LambdaFunction(lambdaFunction, {
        deadLetterQueue: this.imageGenerationDLQ,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      })
    );
  }

  /**
   * Add Lambda function as target to status update rule
   */
  public addStatusUpdateTarget(lambdaFunction: lambda.Function): void {
    this.statusUpdateRule.addTarget(
      new targets.LambdaFunction(lambdaFunction, {
        deadLetterQueue: this.statusUpdateDLQ,
        maxEventAge: cdk.Duration.hours(1),
        retryAttempts: 2,
      })
    );
  }

  /**
   * Grant EventBridge permissions to Lambda functions
   */
  public grantEventBridgePermissions(
    lambdaFunction: lambda.Function,
    eventBus: events.EventBus
  ): void {
    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["events:PutEvents"],
        resources: [eventBus.eventBusArn],
      })
    );
  }

  /**
   * Create CloudWatch alarms for DLQ monitoring
   */
  private createDLQAlarms(props: EventBridgeConstructProps): void {
    const dlqConfigs = [
      {
        queue: this.storyGenerationDLQ,
        name: "StoryGenerationDLQ",
        threshold: 1,
      },
      {
        queue: this.episodeGenerationDLQ,
        name: "EpisodeGenerationDLQ",
        threshold: 1,
      },
      {
        queue: this.imageGenerationDLQ,
        name: "ImageGenerationDLQ",
        threshold: 1,
      },
      {
        queue: this.statusUpdateDLQ,
        name: "StatusUpdateDLQ",
        threshold: 5, // Higher threshold for status updates
      },
    ];

    dlqConfigs.forEach((config) => {
      // Create alarm for messages in DLQ
      const alarm = new cloudwatch.Alarm(this, `${config.name}Alarm`, {
        alarmName: `manga-${config.name.toLowerCase()}-messages-${
          props.environment
        }`,
        alarmDescription: `Alert when messages appear in ${config.name}`,
        metric: config.queue.metricApproximateNumberOfMessagesVisible({
          statistic: "Maximum",
          period: cdk.Duration.minutes(5),
        }),
        threshold: config.threshold,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Add SNS notification if alerting topic is provided
      if (props.alertingTopic) {
        alarm.addAlarmAction(
          new cloudwatchActions.SnsAction(props.alertingTopic)
        );
      }

      // Create alarm for old messages in DLQ
      const ageAlarm = new cloudwatch.Alarm(this, `${config.name}AgeAlarm`, {
        alarmName: `manga-${config.name.toLowerCase()}-age-${
          props.environment
        }`,
        alarmDescription: `Alert when messages in ${config.name} are getting old`,
        metric: config.queue.metricApproximateAgeOfOldestMessage({
          statistic: "Maximum",
          period: cdk.Duration.minutes(15),
        }),
        threshold: 3600, // 1 hour in seconds
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      if (props.alertingTopic) {
        ageAlarm.addAlarmAction(
          new cloudwatchActions.SnsAction(props.alertingTopic)
        );
      }
    });
  }

  /**
   * Get DLQ metrics for monitoring dashboard
   */
  public getDLQMetrics(): cloudwatch.IMetric[] {
    const queues = [
      { queue: this.storyGenerationDLQ, name: "StoryGeneration" },
      { queue: this.episodeGenerationDLQ, name: "EpisodeGeneration" },
      { queue: this.imageGenerationDLQ, name: "ImageGeneration" },
      { queue: this.statusUpdateDLQ, name: "StatusUpdate" },
    ];

    const metrics: cloudwatch.IMetric[] = [];

    queues.forEach((config) => {
      metrics.push(
        config.queue.metricApproximateNumberOfMessagesVisible({
          label: `${config.name} DLQ Messages`,
          statistic: "Maximum",
          period: cdk.Duration.minutes(5),
        }),
        config.queue.metricApproximateAgeOfOldestMessage({
          label: `${config.name} DLQ Age`,
          statistic: "Maximum",
          period: cdk.Duration.minutes(5),
        })
      );
    });

    return metrics;
  }
}
