import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as xray from "aws-cdk-lib/aws-xray";
import { Construct } from "constructs";
import { EnvironmentConfig } from "../config/environment-config";

export interface MonitoringStackProps extends cdk.StackProps {
  environment: string;
  envConfig: EnvironmentConfig;
  deploymentColor?: string;
  deploymentId?: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  api: apigateway.RestApi;
  eventBus: events.EventBus;
  lambdaFunctions?: {
    postAuthTrigger?: lambda.Function;
    preferencesProcessing?: lambda.Function;
    storyGeneration?: lambda.Function;
    episodeGeneration?: lambda.Function;
    imageGeneration?: lambda.Function;
    contentRetrieval?: lambda.Function;
    statusCheck?: lambda.Function;
  };
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alertTopic: sns.Topic;
  public readonly xrayTracingConfig: xray.CfnSamplingRule;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS Topic for alerts
    this.alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: `manga-platform-alerts-${props.environment}`,
      displayName: `Manga Platform Alerts - ${props.environment}`,
    });

    // Add email subscription if provided
    if (props.alertEmail) {
      this.alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.alertEmail)
      );
    }

    // X-Ray Tracing Configuration
    this.xrayTracingConfig = new xray.CfnSamplingRule(this, "XRayTracingRule", {
      samplingRule: {
        ruleName: `manga-platform-tracing-${props.environment}`,
        priority: 9000,
        fixedRate: 0.1, // 10% sampling rate
        reservoirSize: 1,
        serviceName: "manga-platform",
        serviceType: "*",
        host: "*",
        httpMethod: "*",
        urlPath: "*",
        resourceArn: "*",
        version: 1,
      },
    });

    // Additional X-Ray sampling rules for new workflows
    new xray.CfnSamplingRule(this, "BatchWorkflowTracingRule", {
      samplingRule: {
        ruleName: `manga-batch-workflow-tracing-${props.environment}`,
        priority: 8000,
        fixedRate: 0.2, // 20% sampling rate for batch workflows
        reservoirSize: 2,
        serviceName: "manga-platform",
        serviceType: "*",
        host: "*",
        httpMethod: "POST",
        urlPath: "/workflow/start",
        resourceArn: "*",
        version: 1,
      },
    });

    new xray.CfnSamplingRule(this, "EpisodeContinuationTracingRule", {
      samplingRule: {
        ruleName: `manga-episode-continuation-${props.environment}`,
        priority: 8100,
        fixedRate: 0.15, // 15% sampling rate for episode continuations
        reservoirSize: 1,
        serviceName: "manga-platform",
        serviceType: "*",
        host: "*",
        httpMethod: "POST",
        urlPath: "/stories/*/episodes",
        resourceArn: "*",
        version: 1,
      },
    });

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, "MangaDashboard", {
      dashboardName: `manga-platform-${props.environment}`,
    });

    // Create comprehensive monitoring widgets
    this.createSystemOverviewWidgets(props);
    this.createBusinessMetricsWidgets(props);
    this.createBatchWorkflowWidgets(props);
    this.createEpisodeContinuationWidgets(props);
    this.createLambdaMetricsWidgets(props);
    this.createEventBridgeMetricsWidgets(props);
    this.createXRayMetricsWidgets(props);

    // Create comprehensive alarms
    this.createSystemAlarms(props);
    this.createBusinessAlarms(props);
    this.createBatchWorkflowAlarms(props);
    this.createEpisodeContinuationAlarms(props);
    this.createLambdaAlarms(props);

    // Create centralized log groups with structured logging
    this.createLogGroups(props);

    // Outputs
    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      exportName: `dashboard-url-${props.environment}`,
    });

    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: this.alertTopic.topicArn,
      exportName: `alert-topic-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, "XRayTracingRuleArn", {
      value: this.xrayTracingConfig.attrRuleArn,
      exportName: `xray-tracing-rule-arn-${props.environment}`,
    });
  }

  private createSystemOverviewWidgets(props: MonitoringStackProps): void {
    // API Gateway Metrics
    const apiRequestsWidget = new cloudwatch.GraphWidget({
      title: "API Gateway - Requests & Errors",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "Count",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "Sum",
          label: "Total Requests",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "4XXError",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "Sum",
          label: "4XX Errors",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "5XXError",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "Sum",
          label: "5XX Errors",
        }),
      ],
    });

    const apiLatencyWidget = new cloudwatch.GraphWidget({
      title: "API Gateway - Latency",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "Latency",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "Average",
          label: "Average Latency",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "Latency",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "p99",
          label: "P99 Latency",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "IntegrationLatency",
          dimensionsMap: { ApiName: props.api.restApiName },
          statistic: "Average",
          label: "Integration Latency",
        }),
      ],
    });

    // DynamoDB Metrics
    const dynamoPerformanceWidget = new cloudwatch.GraphWidget({
      title: "DynamoDB - Performance",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ConsumedReadCapacityUnits",
          dimensionsMap: { TableName: props.mangaTable.tableName },
          statistic: "Sum",
          label: "Read Capacity",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ConsumedWriteCapacityUnits",
          dimensionsMap: { TableName: props.mangaTable.tableName },
          statistic: "Sum",
          label: "Write Capacity",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ReadThrottledRequests",
          dimensionsMap: { TableName: props.mangaTable.tableName },
          statistic: "Sum",
          label: "Read Throttles",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "WriteThrottledRequests",
          dimensionsMap: { TableName: props.mangaTable.tableName },
          statistic: "Sum",
          label: "Write Throttles",
        }),
      ],
    });

    const s3Widget = new cloudwatch.GraphWidget({
      title: "S3 Storage - Usage",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/S3",
          metricName: "BucketSizeBytes",
          dimensionsMap: {
            BucketName: props.contentBucket.bucketName,
            StorageType: "StandardStorage",
          },
          statistic: "Average",
          label: "Storage Size (Bytes)",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/S3",
          metricName: "NumberOfObjects",
          dimensionsMap: {
            BucketName: props.contentBucket.bucketName,
            StorageType: "AllStorageTypes",
          },
          statistic: "Average",
          label: "Object Count",
        }),
      ],
    });

    this.dashboard.addWidgets(
      apiRequestsWidget,
      apiLatencyWidget,
      dynamoPerformanceWidget,
      s3Widget
    );
  }

  private createBusinessMetricsWidgets(props: MonitoringStackProps): void {
    // Custom business metrics
    const businessMetricsWidget = new cloudwatch.GraphWidget({
      title: "Business Metrics - Generation Pipeline",
      width: 24,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "StoryGenerationRequests",
          statistic: "Sum",
          label: "Story Requests",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "StoryGenerationSuccess",
          statistic: "Sum",
          label: "Story Success",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "EpisodeGenerationSuccess",
          statistic: "Sum",
          label: "Episode Success",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "ImageGenerationSuccess",
          statistic: "Sum",
          label: "Image Success",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "StoryGenerationFailures",
          statistic: "Sum",
          label: "Story Failures",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "EpisodeGenerationFailures",
          statistic: "Sum",
          label: "Episode Failures",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "ImageGenerationFailures",
          statistic: "Sum",
          label: "Image Failures",
        }),
      ],
    });

    const processingTimeWidget = new cloudwatch.GraphWidget({
      title: "Processing Times",
      width: 24,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "StoryGenerationDuration",
          statistic: "Average",
          label: "Avg Story Generation Time",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "EpisodeGenerationDuration",
          statistic: "Average",
          label: "Avg Episode Generation Time",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "ImageGenerationDuration",
          statistic: "Average",
          label: "Avg Image Generation Time",
        }),
      ],
    });

    this.dashboard.addWidgets(businessMetricsWidget, processingTimeWidget);
  }

  private createBatchWorkflowWidgets(props: MonitoringStackProps): void {
    // Batch Workflow Progress and Success Rate
    const batchWorkflowWidget = new cloudwatch.GraphWidget({
      title: "Batch Workflow - Progress & Success Rate",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "WorkflowStarts",
          statistic: "Sum",
          label: "Workflow Starts",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "WorkflowCompletions",
          statistic: "Sum",
          label: "Workflow Completions",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "BatchWorkflowSuccessRate",
          statistic: "Average",
          label: "Success Rate (%)",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "WorkflowFailures",
          statistic: "Sum",
          label: "Workflow Failures",
        }),
      ],
    });

    // Batch Processing Performance
    const batchPerformanceWidget = new cloudwatch.GraphWidget({
      title: "Batch Workflow - Performance",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "BatchWorkflowDuration",
          statistic: "Average",
          label: "Avg Workflow Duration",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "BatchWorkflowDuration",
          statistic: "p99",
          label: "P99 Workflow Duration",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "BatchStoryGenerations",
          statistic: "Sum",
          label: "Total Stories in Batches",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "BatchWorkflowProgress",
          statistic: "Average",
          label: "Avg Progress (%)",
        }),
      ],
    });

    this.dashboard.addWidgets(batchWorkflowWidget, batchPerformanceWidget);
  }

  private createEpisodeContinuationWidgets(props: MonitoringStackProps): void {
    // Episode Continuation Metrics
    const episodeContinuationWidget = new cloudwatch.GraphWidget({
      title: "Episode Continuation - Requests & Success",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "EpisodeContinuations",
          statistic: "Sum",
          label: "Continuation Requests",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "EpisodeContinuationSuccess",
          statistic: "Sum",
          label: "Successful Continuations",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Business",
          metricName: "EpisodeContinuationFailures",
          statistic: "Sum",
          label: "Failed Continuations",
        }),
      ],
    });

    // Episode Continuation Performance
    const episodePerformanceWidget = new cloudwatch.GraphWidget({
      title: "Episode Continuation - Performance",
      width: 12,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "EpisodeContinuationDuration",
          statistic: "Average",
          label: "Avg Continuation Duration",
        }),
        new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "EpisodeContinuationDuration",
          statistic: "p99",
          label: "P99 Continuation Duration",
        }),
      ],
    });

    this.dashboard.addWidgets(
      episodeContinuationWidget,
      episodePerformanceWidget
    );
  }

  private createLambdaMetricsWidgets(props: MonitoringStackProps): void {
    if (!props.lambdaFunctions) {
      // Avoid errors if lambdaFunctions is undefined
      return;
    }
    const lambdaFunctions = Object.entries(props.lambdaFunctions).filter(
      ([name, func]) => func !== undefined
    );

    // Create widgets for Lambda metrics
    const lambdaInvocationsWidget = new cloudwatch.GraphWidget({
      title: "Lambda - Invocations",
      width: 12,
      height: 6,
      left: lambdaFunctions.map(
        ([name, func]) =>
          new cloudwatch.Metric({
            namespace: "AWS/Lambda",
            metricName: "Invocations",
            dimensionsMap: { FunctionName: func.functionName },
            statistic: "Sum",
            label: name,
          })
      ),
    });

    const lambdaErrorsWidget = new cloudwatch.GraphWidget({
      title: "Lambda - Errors & Duration",
      width: 12,
      height: 6,
      left: lambdaFunctions.map(
        ([name, func]) =>
          new cloudwatch.Metric({
            namespace: "AWS/Lambda",
            metricName: "Errors",
            dimensionsMap: { FunctionName: func.functionName },
            statistic: "Sum",
            label: `${name} Errors`,
          })
      ),
      right: lambdaFunctions.map(
        ([name, func]) =>
          new cloudwatch.Metric({
            namespace: "AWS/Lambda",
            metricName: "Duration",
            dimensionsMap: { FunctionName: func.functionName },
            statistic: "Average",
            label: `${name} Duration`,
          })
      ),
    });

    const lambdaColdStartWidget = new cloudwatch.GraphWidget({
      title: "Lambda - Cold Starts & Throttles",
      width: 24,
      height: 6,
      left: lambdaFunctions.map(
        ([name, func]) =>
          new cloudwatch.Metric({
            namespace: "AWS/Lambda",
            metricName: "ConcurrentExecutions",
            dimensionsMap: { FunctionName: func.functionName },
            statistic: "Maximum",
            label: `${name} Concurrent`,
          })
      ),
      right: lambdaFunctions.map(
        ([name, func]) =>
          new cloudwatch.Metric({
            namespace: "AWS/Lambda",
            metricName: "Throttles",
            dimensionsMap: { FunctionName: func.functionName },
            statistic: "Sum",
            label: `${name} Throttles`,
          })
      ),
    });

    this.dashboard.addWidgets(
      lambdaInvocationsWidget,
      lambdaErrorsWidget,
      lambdaColdStartWidget
    );
  }

  private createEventBridgeMetricsWidgets(props: MonitoringStackProps): void {
    const eventBridgeWidget = new cloudwatch.GraphWidget({
      title: "EventBridge - Events",
      width: 24,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/Events",
          metricName: "SuccessfulInvocations",
          dimensionsMap: { EventBusName: props.eventBus.eventBusName },
          statistic: "Sum",
          label: "Successful Events",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/Events",
          metricName: "InvocationsCount",
          dimensionsMap: { EventBusName: props.eventBus.eventBusName },
          statistic: "Sum",
          label: "Total Invocations",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/Events",
          metricName: "FailedInvocations",
          dimensionsMap: { EventBusName: props.eventBus.eventBusName },
          statistic: "Sum",
          label: "Failed Events",
        }),
      ],
    });

    this.dashboard.addWidgets(eventBridgeWidget);
  }

  private createXRayMetricsWidgets(props: MonitoringStackProps): void {
    const xrayWidget = new cloudwatch.GraphWidget({
      title: "X-Ray - Distributed Tracing",
      width: 24,
      height: 6,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/X-Ray",
          metricName: "TracesReceived",
          statistic: "Sum",
          label: "Traces Received",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/X-Ray",
          metricName: "ResponseTime",
          statistic: "Average",
          label: "Response Time",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/X-Ray",
          metricName: "ErrorRate",
          statistic: "Average",
          label: "Error Rate",
        }),
      ],
    });

    this.dashboard.addWidgets(xrayWidget);
  }

  private createSystemAlarms(props: MonitoringStackProps): void {
    // API Gateway Error Rate Alarm
    const apiErrorAlarm = new cloudwatch.Alarm(this, "ApiErrorAlarm", {
      alarmName: `manga-api-errors-${props.environment}`,
      alarmDescription: "High error rate in API Gateway",
      metric: new cloudwatch.MathExpression({
        expression: "(errors4xx + errors5xx) / requests * 100",
        usingMetrics: {
          errors4xx: new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "4XXError",
            dimensionsMap: { ApiName: props.api.restApiName },
            statistic: "Sum",
          }),
          errors5xx: new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "5XXError",
            dimensionsMap: { ApiName: props.api.restApiName },
            statistic: "Sum",
          }),
          requests: new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "Count",
            dimensionsMap: { ApiName: props.api.restApiName },
            statistic: "Sum",
          }),
        },
      }),
      threshold: 5, // 5% error rate
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // API Gateway Latency Alarm
    const apiLatencyAlarm = new cloudwatch.Alarm(this, "ApiLatencyAlarm", {
      alarmName: `manga-api-latency-${props.environment}`,
      alarmDescription: "High latency in API Gateway",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "Latency",
        dimensionsMap: { ApiName: props.api.restApiName },
        statistic: "Average",
      }),
      threshold: 5000, // 5 seconds
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // DynamoDB Throttling Alarm
    const dynamoThrottleAlarm = new cloudwatch.Alarm(
      this,
      "DynamoThrottleAlarm",
      {
        alarmName: `manga-dynamo-throttle-${props.environment}`,
        alarmDescription: "DynamoDB throttling detected",
        metric: new cloudwatch.MathExpression({
          expression: "readThrottle + writeThrottle",
          usingMetrics: {
            readThrottle: new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "ReadThrottledRequests",
              dimensionsMap: { TableName: props.mangaTable.tableName },
              statistic: "Sum",
            }),
            writeThrottle: new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "WriteThrottledRequests",
              dimensionsMap: { TableName: props.mangaTable.tableName },
              statistic: "Sum",
            }),
          },
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }
    );

    // Add alarm actions
    [apiErrorAlarm, apiLatencyAlarm, dynamoThrottleAlarm].forEach((alarm) => {
      alarm.addAlarmAction({
        bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
      });
    });
  }

  private createBusinessAlarms(props: MonitoringStackProps): void {
    // Story Generation Failure Rate Alarm
    const storyFailureAlarm = new cloudwatch.Alarm(this, "StoryFailureAlarm", {
      alarmName: `manga-story-failures-${props.environment}`,
      alarmDescription: "High story generation failure rate",
      metric: new cloudwatch.MathExpression({
        expression: "failures / (successes + failures) * 100",
        usingMetrics: {
          failures: new cloudwatch.Metric({
            namespace: "MangaPlatform/Business",
            metricName: "StoryGenerationFailures",
            statistic: "Sum",
          }),
          successes: new cloudwatch.Metric({
            namespace: "MangaPlatform/Business",
            metricName: "StoryGenerationSuccess",
            statistic: "Sum",
          }),
        },
      }),
      threshold: 20, // 20% failure rate
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    storyFailureAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
    });
  }

  private createBatchWorkflowAlarms(props: MonitoringStackProps): void {
    // Batch Workflow Failure Rate Alarm
    const batchWorkflowFailureAlarm = new cloudwatch.Alarm(
      this,
      "BatchWorkflowFailureAlarm",
      {
        alarmName: `manga-batch-workflow-failures-${props.environment}`,
        alarmDescription: "High batch workflow failure rate",
        metric: new cloudwatch.MathExpression({
          expression: "failures / (successes + failures) * 100",
          usingMetrics: {
            failures: new cloudwatch.Metric({
              namespace: "MangaPlatform/Business",
              metricName: "WorkflowFailures",
              statistic: "Sum",
            }),
            successes: new cloudwatch.Metric({
              namespace: "MangaPlatform/Business",
              metricName: "WorkflowCompletions",
              statistic: "Sum",
            }),
          },
        }),
        threshold: 25, // 25% failure rate
        evaluationPeriods: 2,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );

    // Batch Workflow Duration Alarm
    const batchWorkflowDurationAlarm = new cloudwatch.Alarm(
      this,
      "BatchWorkflowDurationAlarm",
      {
        alarmName: `manga-batch-workflow-duration-${props.environment}`,
        alarmDescription: "Batch workflow taking too long",
        metric: new cloudwatch.Metric({
          namespace: "MangaPlatform/Performance",
          metricName: "BatchWorkflowDuration",
          statistic: "Average",
        }),
        threshold: 1800000, // 30 minutes in milliseconds
        evaluationPeriods: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }
    );

    [batchWorkflowFailureAlarm, batchWorkflowDurationAlarm].forEach((alarm) => {
      alarm.addAlarmAction({
        bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
      });
    });
  }

  private createEpisodeContinuationAlarms(props: MonitoringStackProps): void {
    // Episode Continuation Failure Rate Alarm
    const episodeContinuationFailureAlarm = new cloudwatch.Alarm(
      this,
      "EpisodeContinuationFailureAlarm",
      {
        alarmName: `manga-episode-continuation-failures-${props.environment}`,
        alarmDescription: "High episode continuation failure rate",
        metric: new cloudwatch.MathExpression({
          expression: "failures / (successes + failures) * 100",
          usingMetrics: {
            failures: new cloudwatch.Metric({
              namespace: "MangaPlatform/Business",
              metricName: "EpisodeContinuationFailures",
              statistic: "Sum",
            }),
            successes: new cloudwatch.Metric({
              namespace: "MangaPlatform/Business",
              metricName: "EpisodeContinuationSuccess",
              statistic: "Sum",
            }),
          },
        }),
        threshold: 15, // 15% failure rate
        evaluationPeriods: 2,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );

    episodeContinuationFailureAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
    });
  }

  private createLambdaAlarms(props: MonitoringStackProps): void {
    if (!props.lambdaFunctions) {
      return;
    }
    Object.entries(props.lambdaFunctions)
      .filter(([name, func]) => func !== undefined)
      .forEach(([name, func]) => {
        // Lambda Error Rate Alarm
        const errorAlarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
          alarmName: `manga-lambda-${name}-errors-${props.environment}`,
          alarmDescription: `High error rate in ${name} Lambda function`,
          metric: new cloudwatch.MathExpression({
            expression: "errors / invocations * 100",
            usingMetrics: {
              errors: new cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Errors",
                dimensionsMap: { FunctionName: func.functionName },
                statistic: "Sum",
              }),
              invocations: new cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Invocations",
                dimensionsMap: { FunctionName: func.functionName },
                statistic: "Sum",
              }),
            },
          }),
          threshold: 10, // 10% error rate
          evaluationPeriods: 2,
          comparisonOperator:
            cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Lambda Duration Alarm
        const durationAlarm = new cloudwatch.Alarm(
          this,
          `${name}DurationAlarm`,
          {
            alarmName: `manga-lambda-${name}-duration-${props.environment}`,
            alarmDescription: `High duration in ${name} Lambda function`,
            metric: new cloudwatch.Metric({
              namespace: "AWS/Lambda",
              metricName: "Duration",
              dimensionsMap: { FunctionName: func.functionName },
              statistic: "Average",
            }),
            threshold: 30000, // 30 seconds
            evaluationPeriods: 3,
            comparisonOperator:
              cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          }
        );

        [errorAlarm, durationAlarm].forEach((alarm) => {
          alarm.addAlarmAction({
            bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
          });
        });
      });
  }

  private createLogGroups(props: MonitoringStackProps): void {
    // Note: Log groups are now created automatically by AWS services
    // to avoid conflicts with existing log groups in other stacks.
    // If you need explicit log group management, uncomment the following:
    /*
    // API Gateway Log Group
    new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `/aws/apigateway/manga-platform-${props.environment}`,
      retention:
        props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Log Groups with structured logging
    if (props.lambdaFunctions) {
      Object.entries(props.lambdaFunctions)
        .filter(([name, func]) => func !== undefined)
        .forEach(([name, func]) => {
          new logs.LogGroup(this, `${name}LogGroup`, {
            logGroupName: `/aws/lambda/${func.functionName}`,
            retention:
              props.environment === "prod"
                ? logs.RetentionDays.ONE_MONTH
                : logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          });
        });
    }

    // EventBridge Log Group
    new logs.LogGroup(this, "EventBridgeLogGroup", {
      logGroupName: `/aws/events/manga-platform-${props.environment}`,
      retention:
        props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Application Log Group for custom metrics
    new logs.LogGroup(this, "ApplicationLogGroup", {
      logGroupName: `/manga-platform/application-${props.environment}`,
      retention:
        props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    */
  }
}
