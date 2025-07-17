/**
 * Lambda Monitoring Construct
 *
 * Provides standardized monitoring, logging, and X-Ray tracing configuration
 * for all Lambda functions in the manga generation platform.
 *
 * Requirements: 10.6, 9.4
 */

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export interface LambdaMonitoringProps {
  functionName: string;
  environment: string;
  enableXRay?: boolean;
  logRetentionDays?: logs.RetentionDays;
  enableInsights?: boolean;
  customMetricsNamespace?: string;
}

export class LambdaMonitoringConstruct extends Construct {
  public readonly logGroup: logs.LogGroup;
  public readonly xrayPolicy?: iam.PolicyStatement;
  public readonly cloudWatchMetricsPolicy: iam.PolicyStatement;

  constructor(scope: Construct, id: string, props: LambdaMonitoringProps) {
    super(scope, id);

    // Create CloudWatch Log Group with structured logging
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${props.functionName}`,
      retention:
        props.logRetentionDays ||
        (props.environment === "prod"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // CloudWatch Metrics Policy
    this.cloudWatchMetricsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudwatch:PutMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
      ],
      resources: ["*"],
      conditions: {
        StringEquals: {
          "cloudwatch:namespace": [
            "MangaPlatform/Business",
            "MangaPlatform/Performance",
            "MangaPlatform/Errors",
            "MangaPlatform/ExternalAPIs",
            props.customMetricsNamespace || "MangaPlatform/Custom",
          ],
        },
      },
    });

    // X-Ray Tracing Policy (if enabled)
    if (props.enableXRay !== false) {
      this.xrayPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
          "xray:GetSamplingStatisticSummaries",
        ],
        resources: ["*"],
      });
    }

    // CloudWatch Insights (if enabled)
    if (props.enableInsights) {
      new logs.CfnQueryDefinition(this, "InsightsQuery", {
        name: `${props.functionName}-errors`,
        logGroupNames: [this.logGroup.logGroupName],
        queryString: `
          fields @timestamp, @message, correlationId, operationName, error.message
          | filter @message like /Error occurred/
          | sort @timestamp desc
          | limit 100
        `,
      });

      new logs.CfnQueryDefinition(this, "PerformanceQuery", {
        name: `${props.functionName}-performance`,
        logGroupNames: [this.logGroup.logGroupName],
        queryString: `
          fields @timestamp, @message, correlationId, operationName, context.duration
          | filter @message like /completed/
          | stats avg(context.duration) by bin(5m)
          | sort @timestamp desc
        `,
      });
    }
  }

  /**
   * Apply monitoring configuration to a Lambda function
   */
  public applyToFunction(lambdaFunction: lambda.Function): void {
    // Add CloudWatch Metrics permissions
    lambdaFunction.addToRolePolicy(this.cloudWatchMetricsPolicy);

    // Add X-Ray permissions if enabled
    if (this.xrayPolicy) {
      lambdaFunction.addToRolePolicy(this.xrayPolicy);
    }

    // Set environment variables for monitoring
    lambdaFunction.addEnvironment("LOG_LEVEL", "INFO");
    lambdaFunction.addEnvironment(
      "ENABLE_XRAY",
      this.xrayPolicy ? "true" : "false"
    );
    lambdaFunction.addEnvironment("METRICS_NAMESPACE", "MangaPlatform");
    lambdaFunction.addEnvironment(
      "ENVIRONMENT",
      this.node.tryGetContext("environment") || "dev"
    );

    // Configure X-Ray tracing
    if (this.xrayPolicy) {
      lambdaFunction.addEnvironment("_X_AMZN_TRACE_ID", "");
      // Note: X-Ray tracing mode is set at the function level in CDK
    }
  }

  /**
   * Create standard CloudWatch alarms for a Lambda function
   */
  public createStandardAlarms(
    lambdaFunction: lambda.Function,
    alertTopic: cdk.aws_sns.Topic,
    environment: string
  ): cloudwatch.Alarm[] {
    const alarms: cloudwatch.Alarm[] = [];

    // Error Rate Alarm
    const errorAlarm = new cloudwatch.Alarm(this, "ErrorAlarm", {
      alarmName: `${lambdaFunction.functionName}-errors-${environment}`,
      alarmDescription: `High error rate in ${lambdaFunction.functionName}`,
      metric: new cloudwatch.MathExpression({
        expression: "errors / invocations * 100",
        usingMetrics: {
          errors: lambdaFunction.metricErrors({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          invocations: lambdaFunction.metricInvocations({
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
        },
      }),
      threshold: 10, // 10% error rate
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    errorAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: alertTopic.topicArn }),
    });

    alarms.push(errorAlarm);

    // Duration Alarm
    const durationAlarm = new cloudwatch.Alarm(this, "DurationAlarm", {
      alarmName: `${lambdaFunction.functionName}-duration-${environment}`,
      alarmDescription: `High duration in ${lambdaFunction.functionName}`,
      metric: lambdaFunction.metricDuration({
        statistic: "Average",
        period: cdk.Duration.minutes(5),
      }),
      threshold: lambdaFunction.timeout?.toMilliseconds() || 30000, // Use function timeout or 30s
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    durationAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: alertTopic.topicArn }),
    });

    alarms.push(durationAlarm);

    // Throttle Alarm
    const throttleAlarm = new cloudwatch.Alarm(this, "ThrottleAlarm", {
      alarmName: `${lambdaFunction.functionName}-throttles-${environment}`,
      alarmDescription: `Throttling detected in ${lambdaFunction.functionName}`,
      metric: lambdaFunction.metricThrottles({
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    throttleAlarm.addAlarmAction({
      bind: () => ({ alarmActionArn: alertTopic.topicArn }),
    });

    alarms.push(throttleAlarm);

    return alarms;
  }

  /**
   * Create custom business metric alarms
   */
  public createBusinessMetricAlarms(
    functionName: string,
    alertTopic: cdk.aws_sns.Topic,
    environment: string
  ): cloudwatch.Alarm[] {
    const alarms: cloudwatch.Alarm[] = [];

    // Business operation failure rate alarm
    if (functionName.includes("story-generation")) {
      const storyFailureAlarm = new cloudwatch.Alarm(
        this,
        "StoryFailureAlarm",
        {
          alarmName: `${functionName}-story-failures-${environment}`,
          alarmDescription: "High story generation failure rate",
          metric: new cloudwatch.MathExpression({
            expression: "failures / (successes + failures) * 100",
            usingMetrics: {
              failures: new cloudwatch.Metric({
                namespace: "MangaPlatform/Business",
                metricName: "StoryGenerationFailures",
                statistic: "Sum",
                period: cdk.Duration.minutes(10),
              }),
              successes: new cloudwatch.Metric({
                namespace: "MangaPlatform/Business",
                metricName: "StoryGenerationSuccess",
                statistic: "Sum",
                period: cdk.Duration.minutes(10),
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

      storyFailureAlarm.addAlarmAction({
        bind: () => ({ alarmActionArn: alertTopic.topicArn }),
      });

      alarms.push(storyFailureAlarm);
    }

    // External API failure alarms
    if (
      functionName.includes("preferences") ||
      functionName.includes("story-generation")
    ) {
      const externalApiFailureAlarm = new cloudwatch.Alarm(
        this,
        "ExternalApiFailureAlarm",
        {
          alarmName: `${functionName}-external-api-failures-${environment}`,
          alarmDescription: "High external API failure rate",
          metric: new cloudwatch.MathExpression({
            expression: "qlooFailures + bedrockFailures",
            usingMetrics: {
              qlooFailures: new cloudwatch.Metric({
                namespace: "MangaPlatform/ExternalAPIs",
                metricName: "QlooApiFailures",
                statistic: "Sum",
                period: cdk.Duration.minutes(5),
              }),
              bedrockFailures: new cloudwatch.Metric({
                namespace: "MangaPlatform/ExternalAPIs",
                metricName: "BedrockApiFailures",
                statistic: "Sum",
                period: cdk.Duration.minutes(5),
              }),
            },
          }),
          threshold: 10,
          evaluationPeriods: 2,
          comparisonOperator:
            cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }
      );

      externalApiFailureAlarm.addAlarmAction({
        bind: () => ({ alarmActionArn: alertTopic.topicArn }),
      });

      alarms.push(externalApiFailureAlarm);
    }

    return alarms;
  }
}

/**
 * Helper function to create monitoring configuration for Lambda functions
 */
export function createLambdaWithMonitoring(
  scope: Construct,
  id: string,
  props: lambda.FunctionProps & {
    monitoringProps: LambdaMonitoringProps;
    alertTopic: cdk.aws_sns.Topic;
  }
): {
  function: lambda.Function;
  monitoring: LambdaMonitoringConstruct;
  alarms: cloudwatch.Alarm[];
} {
  // Create the Lambda function with X-Ray tracing enabled
  const lambdaFunction = new lambda.Function(scope, id, {
    ...props,
    tracing:
      props.monitoringProps.enableXRay !== false
        ? lambda.Tracing.ACTIVE
        : lambda.Tracing.DISABLED,
    logRetention: props.monitoringProps.logRetentionDays,
    environment: {
      ...props.environment,
      LOG_LEVEL: "INFO",
      ENABLE_XRAY:
        props.monitoringProps.enableXRay !== false ? "true" : "false",
      METRICS_NAMESPACE: "MangaPlatform",
      ENVIRONMENT: props.monitoringProps.environment,
    },
  });

  // Create monitoring construct
  const monitoring = new LambdaMonitoringConstruct(
    scope,
    `${id}Monitoring`,
    props.monitoringProps
  );

  // Apply monitoring configuration
  monitoring.applyToFunction(lambdaFunction);

  // Create standard alarms
  const standardAlarms = monitoring.createStandardAlarms(
    lambdaFunction,
    props.alertTopic,
    props.monitoringProps.environment
  );

  // Create business metric alarms
  const businessAlarms = monitoring.createBusinessMetricAlarms(
    props.monitoringProps.functionName,
    props.alertTopic,
    props.monitoringProps.environment
  );

  return {
    function: lambdaFunction,
    monitoring,
    alarms: [...standardAlarms, ...businessAlarms],
  };
}
