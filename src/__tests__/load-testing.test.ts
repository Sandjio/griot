/**
 * Load testing scripts for performance validation
 * Tests system performance under various load conditions
 */

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler as preferencesHandler } from "../lambdas/preferences-processing/index";
import { handler as statusHandler } from "../lambdas/status-check/index";
import { handler as contentRetrievalHandler } from "../lambdas/content-retrieval/index";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  MockSetupUtils,
  PerformanceTestUtils,
  LoadTestUtils,
} from "./test-utils";

// Mock all dependencies for load testing
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");
jest.mock("../lambdas/preferences-processing/qloo-client");

import {
  UserPreferencesAccess,
  GenerationRequestAccess,
  StoryAccess,
} from "../database/access-patterns";
import { EventPublishingHelpers } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { QlooApiClient } from "../lambdas/preferences-processing/qloo-client";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;

describe("Load Testing Suite", () => {
  const mockContext = LambdaContextFactory.createContext("load-testing");

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupLoadTestMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupLoadTestMocks() {
    // Setup fast-responding mocks for load testing
    const mockQlooInstance = {
      fetchInsights: jest
        .fn()
        .mockResolvedValue(TestDataFactory.createQlooInsights()),
    };
    mockQlooApiClient.mockImplementation(() => mockQlooInstance as any);

    mockUserPreferencesAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.create.mockResolvedValue();
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();
    mockGenerationRequestAccess.getByRequestId.mockResolvedValue({
      PK: "USER#test-user-123",
      SK: "REQUEST#test-request-123",
      GSI1PK: "REQUEST#test-request-123",
      GSI1SK: "STATUS",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2024-01-01T00:00:00.000Z",
      requestId: "test-request-123",
      userId: "test-user-123",
      type: "STORY",
      status: "COMPLETED",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });

    mockStoryAccess.getByUserId.mockResolvedValue([
      TestDataFactory.createStory("test-user-123", "test-story-123"),
    ]);

    mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();
    mockS3Operations.generatePresignedUrl.mockResolvedValue(
      "https://test-url.com"
    );
  }

  describe("API Gateway Load Tests", () => {
    it("should handle concurrent preferences submissions", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      const testFunction = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        const result = await preferencesHandler(event, mockContext);
        expect(result.statusCode).toBe(200);
        return result;
      };

      const { results, totalDuration, averageDuration } =
        await PerformanceTestUtils.runConcurrentTests(
          testFunction,
          50 // 50 concurrent requests
        );

      expect(results).toHaveLength(50);
      expect(averageDuration).toBeLessThan(1000); // Average response time < 1 second
      expect(totalDuration).toBeLessThan(10000); // Total time < 10 seconds

      console.log(`Concurrent Preferences Test Results:
        - Total Requests: 50
        - Total Duration: ${totalDuration}ms
        - Average Duration: ${averageDuration}ms
        - Success Rate: ${(results.length / 50) * 100}%`);
    });

    it("should handle high-frequency status checks", async () => {
      const testFunction = async () => {
        const requestId = `request-${Math.random().toString(36).substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "GET",
          `/status/${requestId}`,
          null,
          "test-user-123"
        );
        event.pathParameters = { requestId };

        const result = await statusHandler(event, mockContext);
        expect(result.statusCode).toBe(200);
        return result;
      };

      const { results, averageDuration } =
        await PerformanceTestUtils.runConcurrentTests(
          testFunction,
          100 // 100 concurrent status checks
        );

      expect(results).toHaveLength(100);
      expect(averageDuration).toBeLessThan(500); // Status checks should be very fast

      console.log(`Concurrent Status Check Test Results:
        - Total Requests: 100
        - Average Duration: ${averageDuration}ms
        - Success Rate: ${(results.length / 100) * 100}%`);
    });

    it("should handle content retrieval under load", async () => {
      const testFunction = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "GET",
          "/stories",
          null,
          userId
        );

        const result = await contentRetrievalHandler(event, mockContext);
        expect(result.statusCode).toBe(200);
        return result;
      };

      const { results, averageDuration } =
        await PerformanceTestUtils.runConcurrentTests(
          testFunction,
          75 // 75 concurrent content retrievals
        );

      expect(results).toHaveLength(75);
      expect(averageDuration).toBeLessThan(2000); // Content retrieval < 2 seconds

      console.log(`Concurrent Content Retrieval Test Results:
        - Total Requests: 75
        - Average Duration: ${averageDuration}ms
        - Success Rate: ${(results.length / 75) * 100}%`);
    });
  });

  describe("Sustained Load Tests", () => {
    it("should handle sustained preferences load", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      const testFunction = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        const result = await preferencesHandler(event, mockContext);
        if (result.statusCode !== 200) {
          throw new Error(`Request failed with status ${result.statusCode}`);
        }
        return result;
      };

      const loadTestResults = await LoadTestUtils.simulateLoad(testFunction, {
        duration: 30000, // 30 seconds
        rampUpTime: 5000, // 5 seconds ramp up
        maxConcurrency: 20, // Max 20 concurrent requests
      });

      expect(loadTestResults.successfulRequests).toBeGreaterThan(0);
      expect(loadTestResults.failedRequests).toBe(0);
      expect(loadTestResults.averageResponseTime).toBeLessThan(2000);

      console.log(`Sustained Load Test Results:
        - Duration: 30 seconds
        - Total Requests: ${loadTestResults.totalRequests}
        - Successful: ${loadTestResults.successfulRequests}
        - Failed: ${loadTestResults.failedRequests}
        - Success Rate: ${(
          (loadTestResults.successfulRequests / loadTestResults.totalRequests) *
          100
        ).toFixed(2)}%
        - Average Response Time: ${loadTestResults.averageResponseTime.toFixed(
          2
        )}ms
        - Max Response Time: ${loadTestResults.maxResponseTime}ms
        - Min Response Time: ${loadTestResults.minResponseTime}ms`);
    });

    it("should handle mixed workload patterns", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Mixed workload: 60% preferences, 30% status checks, 10% content retrieval
      const testFunction = async () => {
        const random = Math.random();
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;

        if (random < 0.6) {
          // Preferences submission
          const event = APIGatewayEventFactory.createEvent(
            "POST",
            "/preferences",
            JSON.stringify(preferences),
            userId
          );
          return await preferencesHandler(event, mockContext);
        } else if (random < 0.9) {
          // Status check
          const event = APIGatewayEventFactory.createEvent(
            "GET",
            "/status/test-request-123",
            null,
            userId
          );
          event.pathParameters = { requestId: "test-request-123" };
          return await statusHandler(event, mockContext);
        } else {
          // Content retrieval
          const event = APIGatewayEventFactory.createEvent(
            "GET",
            "/stories",
            null,
            userId
          );
          return await contentRetrievalHandler(event, mockContext);
        }
      };

      const loadTestResults = await LoadTestUtils.simulateLoad(testFunction, {
        duration: 20000, // 20 seconds
        rampUpTime: 3000, // 3 seconds ramp up
        maxConcurrency: 15, // Max 15 concurrent requests
      });

      expect(loadTestResults.successfulRequests).toBeGreaterThan(0);
      expect(loadTestResults.averageResponseTime).toBeLessThan(3000);

      console.log(`Mixed Workload Test Results:
        - Duration: 20 seconds
        - Total Requests: ${loadTestResults.totalRequests}
        - Success Rate: ${(
          (loadTestResults.successfulRequests / loadTestResults.totalRequests) *
          100
        ).toFixed(2)}%
        - Average Response Time: ${loadTestResults.averageResponseTime.toFixed(
          2
        )}ms`);
    });
  });

  describe("Spike Load Tests", () => {
    it("should handle traffic spikes gracefully", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Simulate sudden spike in traffic
      const spikeTestFunction = async () => {
        const userId = `spike-user-${Math.random().toString(36).substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        const result = await preferencesHandler(event, mockContext);
        if (result.statusCode !== 200) {
          throw new Error(
            `Spike request failed with status ${result.statusCode}`
          );
        }
        return result;
      };

      // Sudden spike: 0 to 50 concurrent requests immediately
      const { results, totalDuration, averageDuration } =
        await PerformanceTestUtils.runConcurrentTests(spikeTestFunction, 50);

      expect(results).toHaveLength(50);
      expect(averageDuration).toBeLessThan(5000); // Allow higher response time during spike

      console.log(`Spike Load Test Results:
        - Concurrent Requests: 50
        - Total Duration: ${totalDuration}ms
        - Average Duration: ${averageDuration}ms
        - Success Rate: ${(results.length / 50) * 100}%`);
    });
  });

  describe("Memory and Resource Usage", () => {
    it("should not have memory leaks during extended operation", async () => {
      const preferences = TestDataFactory.createUserPreferences();
      const initialMemory = process.memoryUsage();

      // Run many sequential requests to check for memory leaks
      for (let i = 0; i < 100; i++) {
        const userId = `memory-test-user-${i}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        const result = await preferencesHandler(event, mockContext);
        expect(result.statusCode).toBe(200);

        // Force garbage collection periodically
        if (i % 20 === 0 && global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`Memory Usage Test Results:
        - Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB
        - Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB
        - Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);

      // Memory increase should be reasonable (less than 50MB for 100 requests)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it("should handle resource cleanup properly", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Track mock call counts to ensure proper cleanup
      const initialCallCount =
        mockUserPreferencesAccess.create.mock.calls.length;

      const testFunction = async () => {
        const userId = `cleanup-user-${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        return await preferencesHandler(event, mockContext);
      };

      await PerformanceTestUtils.runConcurrentTests(testFunction, 25);

      const finalCallCount = mockUserPreferencesAccess.create.mock.calls.length;
      const expectedCalls = finalCallCount - initialCallCount;

      expect(expectedCalls).toBe(25); // Should match the number of concurrent tests

      console.log(`Resource Cleanup Test Results:
        - Expected Database Calls: 25
        - Actual Database Calls: ${expectedCalls}
        - Resource Cleanup: ${expectedCalls === 25 ? "PASSED" : "FAILED"}`);
    });
  });

  describe("Error Rate Under Load", () => {
    it("should maintain low error rate under normal load", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Introduce occasional failures to test error handling
      let callCount = 0;
      mockUserPreferencesAccess.create.mockImplementation(() => {
        callCount++;
        // Fail 5% of requests randomly
        if (Math.random() < 0.05) {
          return Promise.reject(new Error("Simulated database error"));
        }
        return Promise.resolve();
      });

      const testFunction = async () => {
        const userId = `error-test-user-${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/preferences",
          JSON.stringify(preferences),
          userId
        );

        try {
          const result = await preferencesHandler(event, mockContext);
          return {
            success: result.statusCode === 200,
            statusCode: result.statusCode,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      };

      const { results } = await PerformanceTestUtils.runConcurrentTests(
        testFunction,
        100
      );

      const successfulRequests = results.filter((r) => r.success).length;
      const errorRate = ((100 - successfulRequests) / 100) * 100;

      console.log(`Error Rate Test Results:
        - Total Requests: 100
        - Successful Requests: ${successfulRequests}
        - Error Rate: ${errorRate.toFixed(2)}%`);

      // Error rate should be close to our simulated 5% failure rate
      expect(errorRate).toBeLessThan(10); // Allow some variance
      expect(successfulRequests).toBeGreaterThan(85); // At least 85% success rate
    });
  });

  describe("Performance Benchmarks", () => {
    it("should meet API response time requirements", async () => {
      const testCases = [
        {
          name: "Preferences Submission",
          handler: preferencesHandler,
          event: APIGatewayEventFactory.createEvent(
            "POST",
            "/preferences",
            JSON.stringify(TestDataFactory.createUserPreferences()),
            "benchmark-user"
          ),
          maxResponseTime: 5000, // 5 seconds
        },
        {
          name: "Status Check",
          handler: statusHandler,
          event: (() => {
            const event = APIGatewayEventFactory.createEvent(
              "GET",
              "/status/test-request",
              null,
              "benchmark-user"
            );
            event.pathParameters = { requestId: "test-request" };
            return event;
          })(),
          maxResponseTime: 1000, // 1 second
        },
        {
          name: "Content Retrieval",
          handler: contentRetrievalHandler,
          event: APIGatewayEventFactory.createEvent(
            "GET",
            "/stories",
            null,
            "benchmark-user"
          ),
          maxResponseTime: 3000, // 3 seconds
        },
      ];

      for (const testCase of testCases) {
        const { result, duration } =
          await PerformanceTestUtils.measureExecutionTime(() =>
            testCase.handler(testCase.event, mockContext)
          );

        expect(duration).toBeLessThan(testCase.maxResponseTime);

        console.log(`${testCase.name} Benchmark:
          - Response Time: ${duration}ms
          - Max Allowed: ${testCase.maxResponseTime}ms
          - Status: ${
            duration < testCase.maxResponseTime ? "PASSED" : "FAILED"
          }`);
      }
    });
  });
});
