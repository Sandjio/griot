/**
 * CloudWatch Metrics Utility Tests
 *
 * Tests for custom CloudWatch metrics publishing and business metrics tracking.
 */

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  PutMetricDataCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  CloudWatchMetrics,
  BusinessMetrics,
  ExternalAPIMetrics,
  PerformanceTimer,
  METRIC_NAMESPACES,
  BUSINESS_METRICS,
  PERFORMANCE_METRICS,
  EXTERNAL_API_METRICS,
} from "../cloudwatch-metrics";
import { CorrelationContext } from "../error-handler";

// Mock console methods
const mockConsoleLog = jest.spyOn(console, "log").mockImplementation();
const mockConsoleError = jest.spyOn(console, "error").mockImplementation();

describe("CloudWatchMetrics", () => {
  let metrics: CloudWatchMetrics;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    // Reset singleton instance
    (CloudWatchMetrics as any).instance = undefined;
    metrics = CloudWatchMetrics.getInstance();

    // Set up correlation context
    CorrelationContext.generateNew();
  });

  afterEach(() => {
    CorrelationContext.clear();
  });

  describe("publishMetric", () => {
    it("should publish a single metric successfully", async () => {
      await metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
        1,
        "Count",
        { UserId: "test-user" }
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.BUSINESS,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
                Value: 1,
                Unit: "Count",
                Dimensions: expect.arrayContaining([
                  { Name: "Environment", Value: "dev" },
                  { Name: "Service", Value: "manga-platform" },
                  { Name: "UserId", Value: "test-user" },
                ]),
              }),
            ]),
          }),
        })
      );
    });

    it("should handle CloudWatch API errors gracefully", async () => {
      const error = new Error("CloudWatch API Error");
      mockSend.mockRejectedValueOnce(error);

      // Should not throw
      await expect(
        metrics.publishMetric(
          METRIC_NAMESPACES.BUSINESS,
          BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
          1
        )
      ).resolves.toBeUndefined();

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Error occurred:",
        expect.stringContaining("CloudWatch API Error")
      );
    });

    it("should use default values for optional parameters", async () => {
      await metrics.publishMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
        1
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                Unit: "Count",
                Dimensions: expect.arrayContaining([
                  { Name: "Environment", Value: "dev" },
                  { Name: "Service", Value: "manga-platform" },
                ]),
              }),
            ]),
          }),
        })
      );
    });
  });

  describe("publishMetrics", () => {
    it("should publish multiple metrics in batch", async () => {
      const metricsToPublish = [
        {
          metricName: BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
          value: 1,
          dimensions: { UserId: "user1" },
        },
        {
          metricName: BUSINESS_METRICS.STORY_GENERATION_FAILURES,
          value: 1,
          dimensions: { UserId: "user2", ErrorType: "TIMEOUT" },
        },
      ];

      await metrics.publishMetrics(
        METRIC_NAMESPACES.BUSINESS,
        metricsToPublish
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.BUSINESS,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
                Value: 1,
                Dimensions: expect.arrayContaining([
                  { Name: "UserId", Value: "user1" },
                ]),
              }),
              expect.objectContaining({
                MetricName: BUSINESS_METRICS.STORY_GENERATION_FAILURES,
                Value: 1,
                Dimensions: expect.arrayContaining([
                  { Name: "UserId", Value: "user2" },
                  { Name: "ErrorType", Value: "TIMEOUT" },
                ]),
              }),
            ]),
          }),
        })
      );
    });

    it("should split large batches into multiple requests", async () => {
      // Create 25 metrics (exceeds batch size of 20)
      const metricsToPublish = Array.from({ length: 25 }, (_, i) => ({
        metricName: BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
        value: 1,
        dimensions: { UserId: `user${i}` },
      }));

      await metrics.publishMetrics(
        METRIC_NAMESPACES.BUSINESS,
        metricsToPublish
      );

      // Should make 2 API calls (20 + 5)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("bufferMetric and flushMetrics", () => {
    it("should buffer metrics and flush them", async () => {
      // Buffer some metrics
      metrics.bufferMetric(
        METRIC_NAMESPACES.BUSINESS,
        BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
        1,
        "Count",
        { UserId: "user1" }
      );

      metrics.bufferMetric(
        METRIC_NAMESPACES.PERFORMANCE,
        PERFORMANCE_METRICS.STORY_GENERATION_DURATION,
        1500,
        "Milliseconds",
        { UserId: "user1" }
      );

      // Flush buffered metrics
      await metrics.flushMetrics();

      // Should make 2 API calls (one per namespace)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should handle empty buffer gracefully", async () => {
      await metrics.flushMetrics();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});

describe("BusinessMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    // Reset singleton instance
    (CloudWatchMetrics as any).instance = undefined;
    CorrelationContext.generateNew();
  });

  afterEach(() => {
    CorrelationContext.clear();
  });

  describe("recordStoryGenerationSuccess", () => {
    it("should record story generation success with duration", async () => {
      await BusinessMetrics.recordStoryGenerationSuccess("test-user", 5000);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Check business metric
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.BUSINESS,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: BUSINESS_METRICS.STORY_GENERATION_SUCCESS,
                Value: 1,
                Unit: "Count",
              }),
            ]),
          }),
        })
      );

      // Check performance metric
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.PERFORMANCE,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: PERFORMANCE_METRICS.STORY_GENERATION_DURATION,
                Value: 5000,
                Unit: "Milliseconds",
              }),
            ]),
          }),
        })
      );
    });
  });

  describe("recordStoryGenerationFailure", () => {
    it("should record story generation failure with error type", async () => {
      await BusinessMetrics.recordStoryGenerationFailure(
        "test-user",
        "TIMEOUT_ERROR"
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.BUSINESS,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: BUSINESS_METRICS.STORY_GENERATION_FAILURES,
                Value: 1,
                Unit: "Count",
                Dimensions: expect.arrayContaining([
                  { Name: "UserId", Value: "test-user" },
                  { Name: "ErrorType", Value: "TIMEOUT_ERROR" },
                ]),
              }),
            ]),
          }),
        })
      );
    });
  });

  describe("recordImageGenerationSuccess", () => {
    it("should record image generation success with duration and image count", async () => {
      await BusinessMetrics.recordImageGenerationSuccess("test-user", 8000, 5);

      expect(mockSend).toHaveBeenCalledTimes(3);

      // Should record success, duration, and image count metrics
      const calls = mockSend.mock.calls;
      const namespaces = calls.map((call) => call[0].input.Namespace);

      expect(namespaces).toContain(METRIC_NAMESPACES.BUSINESS);
      expect(namespaces).toContain(METRIC_NAMESPACES.PERFORMANCE);
    });
  });
});

describe("ExternalAPIMetrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    // Reset singleton instance
    (CloudWatchMetrics as any).instance = undefined;
    CorrelationContext.generateNew();
  });

  afterEach(() => {
    CorrelationContext.clear();
  });

  describe("recordQlooAPICall", () => {
    it("should record Qloo API call with duration", async () => {
      await ExternalAPIMetrics.recordQlooAPICall(1200);

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Check API call count metric
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.EXTERNAL_APIS,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: EXTERNAL_API_METRICS.QLOO_API_CALLS,
                Value: 1,
                Unit: "Count",
              }),
            ]),
          }),
        })
      );

      // Check response time metric
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Namespace: METRIC_NAMESPACES.PERFORMANCE,
            MetricData: expect.arrayContaining([
              expect.objectContaining({
                MetricName: PERFORMANCE_METRICS.QLOO_API_RESPONSE_TIME,
                Value: 1200,
                Unit: "Milliseconds",
              }),
            ]),
          }),
        })
      );
    });
  });

  describe("recordBedrockAPIFailure", () => {
    it("should record Bedrock API failure with model and error type", async () => {
      await ExternalAPIMetrics.recordBedrockAPIFailure(
        "claude-3-sonnet",
        "RATE_LIMIT"
      );

      expect(mockSend).toHaveBeenCalledTimes(2);

      // Should record both external API failure and error metrics
      const calls = mockSend.mock.calls;
      const namespaces = calls.map((call) => call[0].input.Namespace);

      expect(namespaces).toContain(METRIC_NAMESPACES.EXTERNAL_APIS);
      expect(namespaces).toContain(METRIC_NAMESPACES.ERRORS);
    });
  });
});

describe("PerformanceTimer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});

    // Reset singleton instance
    (CloudWatchMetrics as any).instance = undefined;
    CorrelationContext.generateNew();
  });

  afterEach(() => {
    CorrelationContext.clear();
  });

  it("should measure operation duration", async () => {
    const timer = new PerformanceTimer("TestOperation");

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 100));

    const duration = timer.stop();

    expect(duration).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThan(200); // Allow some variance
  });

  it("should stop and publish performance metric", async () => {
    const timer = new PerformanceTimer("TestOperation");

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 50));

    const duration = await timer.stopAndPublish(
      METRIC_NAMESPACES.PERFORMANCE,
      "TestOperationDuration",
      { Operation: "Test" }
    );

    expect(duration).toBeGreaterThanOrEqual(40); // Allow for timing variance
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Namespace: METRIC_NAMESPACES.PERFORMANCE,
          MetricData: expect.arrayContaining([
            expect.objectContaining({
              MetricName: "TestOperationDuration",
              Value: duration,
              Unit: "Milliseconds",
              Dimensions: expect.arrayContaining([
                { Name: "Operation", Value: "Test" },
              ]),
            }),
          ]),
        }),
      })
    );
  });
});

describe("Metric Constants", () => {
  it("should have correct metric namespaces", () => {
    expect(METRIC_NAMESPACES.BUSINESS).toBe("MangaPlatform/Business");
    expect(METRIC_NAMESPACES.PERFORMANCE).toBe("MangaPlatform/Performance");
    expect(METRIC_NAMESPACES.ERRORS).toBe("MangaPlatform/Errors");
    expect(METRIC_NAMESPACES.EXTERNAL_APIS).toBe("MangaPlatform/ExternalAPIs");
  });

  it("should have correct business metric names", () => {
    expect(BUSINESS_METRICS.STORY_GENERATION_REQUESTS).toBe(
      "StoryGenerationRequests"
    );
    expect(BUSINESS_METRICS.STORY_GENERATION_SUCCESS).toBe(
      "StoryGenerationSuccess"
    );
    expect(BUSINESS_METRICS.STORY_GENERATION_FAILURES).toBe(
      "StoryGenerationFailures"
    );
    expect(BUSINESS_METRICS.USER_REGISTRATIONS).toBe("UserRegistrations");
  });

  it("should have correct performance metric names", () => {
    expect(PERFORMANCE_METRICS.STORY_GENERATION_DURATION).toBe(
      "StoryGenerationDuration"
    );
    expect(PERFORMANCE_METRICS.QLOO_API_RESPONSE_TIME).toBe(
      "QlooApiResponseTime"
    );
    expect(PERFORMANCE_METRICS.BEDROCK_API_RESPONSE_TIME).toBe(
      "BedrockApiResponseTime"
    );
  });

  it("should have correct external API metric names", () => {
    expect(EXTERNAL_API_METRICS.QLOO_API_CALLS).toBe("QlooApiCalls");
    expect(EXTERNAL_API_METRICS.BEDROCK_API_SUCCESS).toBe("BedrockApiSuccess");
    expect(EXTERNAL_API_METRICS.BEDROCK_API_FAILURES).toBe(
      "BedrockApiFailures"
    );
  });
});
