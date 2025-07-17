/**
 * CloudWatch Custom Metrics Utility
 *
 * Provides utilities for publishing custom business metrics to CloudWatch
 * for monitoring manga generation pipeline performance and business operations.
 *
 * Requirements: 10.6, 9.4
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { CorrelationContext, ErrorLogger } from "./error-handler";

// CloudWatch client singleton
let cloudWatchClient: CloudWatchClient | null = null;

function getCloudWatchClient(): CloudWatchClient {
  if (!cloudWatchClient) {
    cloudWatchClient = new CloudWatchClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return cloudWatchClient;
}

// Metric namespaces
export const METRIC_NAMESPACES = {
  BUSINESS: "MangaPlatform/Business",
  PERFORMANCE: "MangaPlatform/Performance",
  ERRORS: "MangaPlatform/Errors",
  EXTERNAL_APIS: "MangaPlatform/ExternalAPIs",
} as const;

// Metric names
export const BUSINESS_METRICS = {
  STORY_GENERATION_REQUESTS: "StoryGenerationRequests",
  STORY_GENERATION_SUCCESS: "StoryGenerationSuccess",
  STORY_GENERATION_FAILURES: "StoryGenerationFailures",
  EPISODE_GENERATION_SUCCESS: "EpisodeGenerationSuccess",
  EPISODE_GENERATION_FAILURES: "EpisodeGenerationFailures",
  IMAGE_GENERATION_SUCCESS: "ImageGenerationSuccess",
  IMAGE_GENERATION_FAILURES: "ImageGenerationFailures",
  USER_REGISTRATIONS: "UserRegistrations",
  PREFERENCE_SUBMISSIONS: "PreferenceSubmissions",
  CONTENT_RETRIEVALS: "ContentRetrievals",
} as const;

export const PERFORMANCE_METRICS = {
  STORY_GENERATION_DURATION: "StoryGenerationDuration",
  EPISODE_GENERATION_DURATION: "EpisodeGenerationDuration",
  IMAGE_GENERATION_DURATION: "ImageGenerationDuration",
  PDF_GENERATION_DURATION: "PDFGenerationDuration",
  QLOO_API_RESPONSE_TIME: "QlooApiResponseTime",
  BEDROCK_API_RESPONSE_TIME: "BedrockApiResponseTime",
  S3_UPLOAD_DURATION: "S3UploadDuration",
  DYNAMODB_OPERATION_DURATION: "DynamoDBOperationDuration",
} as const;

export const ERROR_METRICS = {
  QLOO_API_ERRORS: "QlooApiErrors",
  BEDROCK_API_ERRORS: "BedrockApiErrors",
  S3_OPERATION_ERRORS: "S3OperationErrors",
  DYNAMODB_OPERATION_ERRORS: "DynamoDBOperationErrors",
  VALIDATION_ERRORS: "ValidationErrors",
  CIRCUIT_BREAKER_TRIPS: "CircuitBreakerTrips",
} as const;

export const EXTERNAL_API_METRICS = {
  QLOO_API_CALLS: "QlooApiCalls",
  QLOO_API_SUCCESS: "QlooApiSuccess",
  QLOO_API_FAILURES: "QlooApiFailures",
  BEDROCK_API_CALLS: "BedrockApiCalls",
  BEDROCK_API_SUCCESS: "BedrockApiSuccess",
  BEDROCK_API_FAILURES: "BedrockApiFailures",
} as const;

// Metric dimensions interface
export interface MetricDimensions {
  [key: string]: string;
}

// Common dimensions
export const COMMON_DIMENSIONS = {
  Environment: process.env.ENVIRONMENT || "dev",
  Service: "manga-platform",
} as const;

/**
 * CloudWatch Metrics Publisher
 */
export class CloudWatchMetrics {
  private static instance: CloudWatchMetrics;
  private readonly client: CloudWatchClient;
  private readonly batchSize = 20; // CloudWatch limit
  private readonly metricBuffer: Array<{
    namespace: string;
    metricName: string;
    value: number;
    unit: string;
    dimensions: MetricDimensions;
    timestamp: Date;
  }> = [];

  private constructor() {
    this.client = getCloudWatchClient();
  }

  static getInstance(): CloudWatchMetrics {
    if (!CloudWatchMetrics.instance) {
      CloudWatchMetrics.instance = new CloudWatchMetrics();
    }
    return CloudWatchMetrics.instance;
  }

  /**
   * Publish a single metric to CloudWatch
   */
  async publishMetric(
    namespace: string,
    metricName: string,
    value: number,
    unit: string = "Count",
    dimensions: MetricDimensions = {},
    timestamp?: Date
  ): Promise<void> {
    const correlationId = CorrelationContext.getCorrelationId();

    try {
      const metricData = {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: timestamp || new Date(),
        Dimensions: Object.entries({ ...COMMON_DIMENSIONS, ...dimensions }).map(
          ([Name, Value]) => ({ Name, Value })
        ),
      };

      const command = new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: [metricData],
      });

      await this.client.send(command);

      ErrorLogger.logInfo(
        "Published CloudWatch metric",
        {
          namespace,
          metricName,
          value,
          unit,
          dimensions,
          correlationId,
        },
        "CloudWatchMetrics"
      );
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          namespace,
          metricName,
          value,
          unit,
          dimensions,
          correlationId,
        },
        "CloudWatchMetrics"
      );
      // Don't throw - metrics publishing should not break the main flow
    }
  }

  /**
   * Publish multiple metrics in batch
   */
  async publishMetrics(
    namespace: string,
    metrics: Array<{
      metricName: string;
      value: number;
      unit?: string;
      dimensions?: MetricDimensions;
      timestamp?: Date;
    }>
  ): Promise<void> {
    const correlationId = CorrelationContext.getCorrelationId();

    try {
      // Split into batches of 20 (CloudWatch limit)
      const batches = [];
      for (let i = 0; i < metrics.length; i += this.batchSize) {
        batches.push(metrics.slice(i, i + this.batchSize));
      }

      for (const batch of batches) {
        const metricData = batch.map((metric) => ({
          MetricName: metric.metricName,
          Value: metric.value,
          Unit: metric.unit || "Count",
          Timestamp: metric.timestamp || new Date(),
          Dimensions: Object.entries({
            ...COMMON_DIMENSIONS,
            ...metric.dimensions,
          }).map(([Name, Value]) => ({ Name, Value })),
        }));

        const command = new PutMetricDataCommand({
          Namespace: namespace,
          MetricData: metricData,
        });

        await this.client.send(command);
      }

      ErrorLogger.logInfo(
        "Published CloudWatch metrics batch",
        {
          namespace,
          metricCount: metrics.length,
          batchCount: batches.length,
          correlationId,
        },
        "CloudWatchMetrics"
      );
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          namespace,
          metricCount: metrics.length,
          correlationId,
        },
        "CloudWatchMetrics"
      );
      // Don't throw - metrics publishing should not break the main flow
    }
  }

  /**
   * Add metric to buffer for batch publishing
   */
  bufferMetric(
    namespace: string,
    metricName: string,
    value: number,
    unit: string = "Count",
    dimensions: MetricDimensions = {},
    timestamp?: Date
  ): void {
    this.metricBuffer.push({
      namespace,
      metricName,
      value,
      unit,
      dimensions,
      timestamp: timestamp || new Date(),
    });
  }

  /**
   * Flush buffered metrics to CloudWatch
   */
  async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) {
      return;
    }

    const correlationId = CorrelationContext.getCorrelationId();

    try {
      // Group metrics by namespace
      const metricsByNamespace = new Map<string, typeof this.metricBuffer>();

      for (const metric of this.metricBuffer) {
        if (!metricsByNamespace.has(metric.namespace)) {
          metricsByNamespace.set(metric.namespace, []);
        }
        metricsByNamespace.get(metric.namespace)!.push(metric);
      }

      // Publish each namespace separately
      for (const [namespace, metrics] of metricsByNamespace) {
        await this.publishMetrics(
          namespace,
          metrics.map((m) => ({
            metricName: m.metricName,
            value: m.value,
            unit: m.unit,
            dimensions: m.dimensions,
            timestamp: m.timestamp,
          }))
        );
      }

      // Clear buffer
      this.metricBuffer.length = 0;

      ErrorLogger.logInfo(
        "Flushed buffered metrics",
        {
          totalMetrics: this.metricBuffer.length,
          namespaces: Array.from(metricsByNamespace.keys()),
          correlationId,
        },
        "CloudWatchMetrics"
      );
    } catch (error) {
      ErrorLogger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          bufferedMetrics: this.metricBuffer.length,
          correlationId,
        },
        "CloudWatchMetrics"
      );
      // Clear buffer even on error to prevent memory leaks
      this.metricBuffer.length = 0;
    }
  }
}

/**
 * Business Metrics Helper Functions
 */
export class BusinessMetrics {
  private static metrics = CloudWatchMetrics.getInstance();

  // Story Generation Metrics
  static async recordStoryGenerationRequest(userId: string): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.STORY_GENERATION_REQUESTS,
      1,
      "Count",
      { UserId: userId }
    );
  }

  static async recordStoryGenerationSuccess(
    userId: string,
    duration: number
  ): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
        1,
        "Count",
        { UserId: userId }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.STORY_GENERATION_DURATION,
        duration,
        "Milliseconds",
        { UserId: userId }
      ),
    ]);
  }

  static async recordStoryGenerationFailure(
    userId: string,
    errorType: string
  ): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.STORY_GENERATION_FAILURES,
      1,
      "Count",
      { UserId: userId, ErrorType: errorType }
    );
  }

  // Episode Generation Metrics
  static async recordEpisodeGenerationSuccess(
    userId: string,
    duration: number
  ): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.EPISODE_GENERATION_SUCCESS,
        1,
        "Count",
        { UserId: userId }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.EPISODE_GENERATION_DURATION,
        duration,
        "Milliseconds",
        { UserId: userId }
      ),
    ]);
  }

  static async recordEpisodeGenerationFailure(
    userId: string,
    errorType: string
  ): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.EPISODE_GENERATION_FAILURES,
      1,
      "Count",
      { UserId: userId, ErrorType: errorType }
    );
  }

  // Image Generation Metrics
  static async recordImageGenerationSuccess(
    userId: string,
    duration: number,
    imageCount: number
  ): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.IMAGE_GENERATION_SUCCESS,
        1,
        "Count",
        { UserId: userId }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.IMAGE_GENERATION_DURATION,
        duration,
        "Milliseconds",
        { UserId: userId }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        "ImagesGenerated",
        imageCount,
        "Count",
        { UserId: userId }
      ),
    ]);
  }

  static async recordImageGenerationFailure(
    userId: string,
    errorType: string
  ): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.IMAGE_GENERATION_FAILURES,
      1,
      "Count",
      { UserId: userId, ErrorType: errorType }
    );
  }

  // User Activity Metrics
  static async recordUserRegistration(): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.USER_REGISTRATIONS,
      1
    );
  }

  static async recordPreferenceSubmission(userId: string): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.PREFERENCE_SUBMISSIONS,
      1,
      "Count",
      { UserId: userId }
    );
  }

  static async recordContentRetrieval(
    userId: string,
    contentType: string
  ): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.BUSINESS,
      BUSINESS_METRICS.CONTENT_RETRIEVALS,
      1,
      "Count",
      { UserId: userId, ContentType: contentType }
    );
  }
}

/**
 * External API Metrics Helper Functions
 */
export class ExternalAPIMetrics {
  private static metrics = CloudWatchMetrics.getInstance();

  // Qloo API Metrics
  static async recordQlooAPICall(duration: number): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.EXTERNAL_APIS,
        EXTERNAL_API_METRICS.QLOO_API_CALLS,
        1
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.QLOO_API_RESPONSE_TIME,
        duration,
        "Milliseconds"
      ),
    ]);
  }

  static async recordQlooAPISuccess(): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.EXTERNAL_APIS,
      EXTERNAL_API_METRICS.QLOO_API_SUCCESS,
      1
    );
  }

  static async recordQlooAPIFailure(errorType: string): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.EXTERNAL_APIS,
        EXTERNAL_API_METRICS.QLOO_API_FAILURES,
        1,
        "Count",
        { ErrorType: errorType }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.ERRORS,
        ERROR_METRICS.QLOO_API_ERRORS,
        1,
        "Count",
        { ErrorType: errorType }
      ),
    ]);
  }

  // Bedrock API Metrics
  static async recordBedrockAPICall(
    modelId: string,
    duration: number
  ): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.EXTERNAL_APIS,
        EXTERNAL_API_METRICS.BEDROCK_API_CALLS,
        1,
        "Count",
        { ModelId: modelId }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.BEDROCK_API_RESPONSE_TIME,
        duration,
        "Milliseconds",
        { ModelId: modelId }
      ),
    ]);
  }

  static async recordBedrockAPISuccess(modelId: string): Promise<void> {
    await this.metrics.publishMetric(
      METRIC_NAMESPACES.EXTERNAL_APIS,
      EXTERNAL_API_METRICS.BEDROCK_API_SUCCESS,
      1,
      "Count",
      { ModelId: modelId }
    );
  }

  static async recordBedrockAPIFailure(
    modelId: string,
    errorType: string
  ): Promise<void> {
    await Promise.all([
      this.metrics.publishMetric(
        METRIC_NAMESPACES.EXTERNAL_APIS,
        EXTERNAL_API_METRICS.BEDROCK_API_FAILURES,
        1,
        "Count",
        { ModelId: modelId, ErrorType: errorType }
      ),
      this.metrics.publishMetric(
        METRIC_NAMESPACES.ERRORS,
        ERROR_METRICS.BEDROCK_API_ERRORS,
        1,
        "Count",
        { ModelId: modelId, ErrorType: errorType }
      ),
    ]);
  }
}

/**
 * Performance Timer Utility
 */
export class PerformanceTimer {
  private startTime: number;
  private readonly operation: string;

  constructor(operation: string) {
    this.operation = operation;
    this.startTime = Date.now();
  }

  /**
   * Stop the timer and return duration in milliseconds
   */
  stop(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Stop the timer and publish performance metric
   */
  async stopAndPublish(
    namespace: string,
    metricName: string,
    dimensions?: MetricDimensions
  ): Promise<number> {
    const duration = this.stop();
    const metrics = CloudWatchMetrics.getInstance();

    await metrics.publishMetric(
      namespace,
      metricName,
      duration,
      "Milliseconds",
      dimensions
    );

    return duration;
  }
}

// Export singleton instance for convenience
export const cloudWatchMetrics = CloudWatchMetrics.getInstance();
