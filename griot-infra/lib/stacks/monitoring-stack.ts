import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";

export interface MonitoringStackProps extends cdk.StackProps {
  environment: string;
  mangaTable: dynamodb.Table;
  contentBucket: s3.Bucket;
  api: apigateway.RestApi;
  alertEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alertTopic: sns.Topic;

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

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, "MangaDashboard", {
      dashboardName: `manga-platform-${props.environment}`,
    });

    // API Gateway Metrics
    const apiRequestsWidget = new cloudwatch.GraphWidget({
      title: "API Gateway Requests",
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "Count",
          dimensionsMap: {
            ApiName: props.api.restApiName,
          },
          statistic: "Sum",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "4XXError",
          dimensionsMap: {
            ApiName: props.api.restApiName,
          },
          statistic: "Sum",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "5XXError",
          dimensionsMap: {
            ApiName: props.api.restApiName,
          },
          statistic: "Sum",
        }),
      ],
    });

    const apiLatencyWidget = new cloudwatch.GraphWidget({
      title: "API Gateway Latency",
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "Latency",
          dimensionsMap: {
            ApiName: props.api.restApiName,
          },
          statistic: "Average",
        }),
        new cloudwatch.Metric({
          namespace: "AWS/ApiGateway",
          metricName: "IntegrationLatency",
          dimensionsMap: {
            ApiName: props.api.restApiName,
          },
          statistic: "Average",
        }),
      ],
    });

    // DynamoDB Metrics
    const dynamoReadWidget = new cloudwatch.GraphWidget({
      title: "DynamoDB Read Metrics",
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ConsumedReadCapacityUnits",
          dimensionsMap: {
            TableName: props.mangaTable.tableName,
          },
          statistic: "Sum",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ReadThrottledRequests",
          dimensionsMap: {
            TableName: props.mangaTable.tableName,
          },
          statistic: "Sum",
        }),
      ],
    });

    const dynamoWriteWidget = new cloudwatch.GraphWidget({
      title: "DynamoDB Write Metrics",
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "ConsumedWriteCapacityUnits",
          dimensionsMap: {
            TableName: props.mangaTable.tableName,
          },
          statistic: "Sum",
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/DynamoDB",
          metricName: "WriteThrottledRequests",
          dimensionsMap: {
            TableName: props.mangaTable.tableName,
          },
          statistic: "Sum",
        }),
      ],
    });

    // S3 Metrics
    const s3Widget = new cloudwatch.GraphWidget({
      title: "S3 Storage Metrics",
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/S3",
          metricName: "BucketSizeBytes",
          dimensionsMap: {
            BucketName: props.contentBucket.bucketName,
            StorageType: "StandardStorage",
          },
          statistic: "Average",
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
        }),
      ],
    });

    // Add widgets to dashboard
    this.dashboard.addWidgets(
      apiRequestsWidget,
      apiLatencyWidget,
      dynamoReadWidget,
      dynamoWriteWidget,
      s3Widget
    );

    // CloudWatch Alarms
    const apiErrorAlarm = new cloudwatch.Alarm(this, "ApiErrorAlarm", {
      alarmName: `manga-api-errors-${props.environment}`,
      alarmDescription: "High error rate in API Gateway",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5XXError",
        dimensionsMap: {
          ApiName: props.api.restApiName,
        },
        statistic: "Sum",
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    apiErrorAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
    });

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
              dimensionsMap: {
                TableName: props.mangaTable.tableName,
              },
              statistic: "Sum",
            }),
            writeThrottle: new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "WriteThrottledRequests",
              dimensionsMap: {
                TableName: props.mangaTable.tableName,
              },
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

    dynamoThrottleAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: this.alertTopic.topicArn }),
    });

    // Log Groups for centralized logging
    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `/aws/apigateway/manga-platform-${props.environment}`,
      retention:
        props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
      logGroupName: `/aws/lambda/manga-platform-${props.environment}`,
      retention:
        props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Outputs
    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
      exportName: `dashboard-url-${props.environment}`,
    });

    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: this.alertTopic.topicArn,
      exportName: `alert-topic-arn-${props.environment}`,
    });
  }
}
