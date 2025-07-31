/**
 * Load tests for batch processing scenarios
 * Tests system performance under various load conditions
 * Requirements: 6A.3, 6A.6
 */

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler as workflowHandler } from "../lambdas/workflow-orchestration/index";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  MockSetupUtils,
  LoadTestUtils,
  PerformanceTestUtils,
} from "./test-utils";

// Mock dependencies
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");

import {
  UserPreferencesAccess,
  GenerationRequestAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<typeof UserPreferencesAccess>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;

describe("Batch Workflow Load Tests", () => {
  const mockContext = LambdaContextFactory.createContext("batch-load-test");

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupLoadTestMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupLoadTestMocks() {
    // Fast mock responses for load testing
    mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
      preferences: TestDataFactory.createUserPreferences(),
      insights: TestDataFactory.createQlooInsights(),
    });

    mockGenerationRequestAccess.create.mockResolvedValue();

    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);
  }

  describe("Concurrent Workflow Starts", () => {
    it("should handle 10 concurrent workflow start requests", async () => {
      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 2 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        expect(result.statusCode).toBe(202);
        return result;
      };

      const { results, totalDuration, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, 10);

      expect(results).toHaveLength(10);
      expect(totalDuration).toBeLessThan(10000); // 10 seconds total
      expect(averageDuration).toBeLessThan(2000); // 2 seconds average
    });

    it("should handle 50 concurrent workflow requests with rate limiting", async () => {
      const userId = "load-test-user-123";
      const testFn = async () => {
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        return await workflowHandler(event, mockContext);
      };

      const { results } = await PerformanceTestUtils.runConcurrentTests(testFn, 50);

      const successfulRequests = results.filter(r => r.statusCode === 202);
      const rateLimitedRequests = results.filter(r => r.statusCode === 429);

      // Should have some successful requests and some rate limited
      expect(successfulRequests.length).toBeGreaterThan(0);
      expect(rateLimitedRequests.length).toBeGreaterThan(0);
      expect(successfulRequests.length + rateLimitedRequests.length).toBe(50);
    });
  });

  describe("Sustained Load Testing", () => {
    it("should handle sustained load over 30 seconds", async () => {
      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        return result;
      };

      const loadResults = await LoadTestUtils.simulateLoad(testFn, {
        duration: 30000, // 30 seconds
        rampUpTime: 5000, // 5 seconds ramp up
        maxConcurrency: 20,
      });

      expect(loadResults.totalRequests).toBeGreaterThan(50);
      expect(loadResults.successfulRequests).toBeGreaterThan(0);
      expect(loadResults.averageResponseTime).toBeLessThan(3000);
      expect(loadResults.maxResponseTime).toBeLessThan(10000);

      // Success rate should be reasonable (accounting for rate limiting)
      const successRate = loadResults.successfulRequests / loadResults.totalRequests;
      expect(successRate).toBeGreaterThan(0.3); // At least 30% success rate
    });

    it("should maintain performance under memory pressure", async () => {
      // Create large request payloads to simulate memory pressure
      const largePreferences = {
        ...TestDataFactory.createUserPreferences(),
        additionalData: "x".repeat(10000), // 10KB of extra data
      };

      mockUserPreferencesAccess.getLatestWithMetadata.mockResolvedValue({
        preferences: largePreferences,
        insights: TestDataFactory.createQlooInsights(),
      });

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 5 }; // Larger batch
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        return result;
      };

      const { results, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, 10);

      const successfulResults = results.filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBeGreaterThan(0);
      expect(averageDuration).toBeLessThan(5000); // Should still complete within 5 seconds
    });
  });

  describe("Database Load Testing", () => {
    it("should handle database connection pressure", async () => {
      // Simulate slow database responses
      mockUserPreferencesAccess.getLatestWithMetadata.mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve({
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
          }), 100) // 100ms delay
        )
      );

      mockGenerationRequestAccess.create.mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve(), 50) // 50ms delay
        )
      );

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        return result;
      };

      const { results, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, 20);

      const successfulResults = results.filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBe(20); // All should succeed despite delays
      expect(averageDuration).toBeLessThan(1000); // Should handle delays gracefully
    });

    it("should handle database timeout scenarios", async () => {
      let callCount = 0;
      mockUserPreferencesAccess.getLatestWithMetadata.mockImplementation(() => {
        callCount++;
        if (callCount % 5 === 0) {
          // Every 5th call times out
          return new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Database timeout")), 1000)
          );
        }
        return Promise.resolve({
          preferences: TestDataFactory.createUserPreferences(),
          insights: TestDataFactory.createQlooInsights(),
        });
      });

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        try {
          const result = await workflowHandler(event, mockContext);
          return result;
        } catch (error) {
          return { statusCode: 500, body: JSON.stringify({ error: "timeout" }) };
        }
      };

      const { results } = await PerformanceTestUtils.runConcurrentTests(testFn, 25);

      const successfulResults = results.filter(r => r.statusCode === 202);
      const errorResults = results.filter(r => r.statusCode === 500);

      expect(successfulResults.length).toBeGreaterThan(15); // Most should succeed
      expect(errorResults.length).toBeGreaterThan(0); // Some should timeout
    });
  });

  describe("EventBridge Load Testing", () => {
    it("should handle high volume event publishing", async () => {
      const publishDelays: number[] = [];
      const mockEventPublisherInstance = {
        publishEvent: jest.fn().mockImplementation(() => {
          const delay = Math.random() * 100; // Random delay up to 100ms
          publishDelays.push(delay);
          return new Promise(resolve => setTimeout(resolve, delay));
        }),
      };
      mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 3 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        return result;
      };

      const { results } = await PerformanceTestUtils.runConcurrentTests(testFn, 30);

      const successfulResults = results.filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBe(30);

      // Verify all events were published
      expect(mockEventPublisherInstance.publishEvent).toHaveBeenCalledTimes(30);

      // Check average publish delay
      const averageDelay = publishDelays.reduce((a, b) => a + b, 0) / publishDelays.length;
      expect(averageDelay).toBeLessThan(100);
    });

    it("should handle event publishing failures gracefully", async () => {
      let publishCount = 0;
      const mockEventPublisherInstance = {
        publishEvent: jest.fn().mockImplementation(() => {
          publishCount++;
          if (publishCount % 4 === 0) {
            // Every 4th publish fails
            throw new Error("EventBridge publish failed");
          }
          return Promise.resolve();
        }),
      };
      mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        try {
          const result = await workflowHandler(event, mockContext);
          return result;
        } catch (error) {
          return { statusCode: 500, body: JSON.stringify({ error: "publish_failed" }) };
        }
      };

      const { results } = await PerformanceTestUtils.runConcurrentTests(testFn, 20);

      const successfulResults = results.filter(r => r.statusCode === 202);
      const errorResults = results.filter(r => r.statusCode === 500);

      expect(successfulResults.length).toBeGreaterThan(10); // Most should succeed
      expect(errorResults.length).toBeGreaterThan(0); // Some should fail
    });
  });

  describe("Resource Utilization", () => {
    it("should maintain reasonable memory usage under load", async () => {
      const initialMemory = process.memoryUsage();

      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 2 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        return result;
      };

      await PerformanceTestUtils.runConcurrentTests(testFn, 50);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });

    it("should handle garbage collection pressure", async () => {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const testFn = async () => {
        // Create temporary objects to pressure GC
        const tempData = Array(1000).fill(null).map(() => ({
          id: Math.random().toString(36),
          data: "x".repeat(1000),
        }));

        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const workflowRequest = { numberOfStories: 1 };
        const event = APIGatewayEventFactory.createEvent(
          "POST",
          "/workflow/start",
          JSON.stringify(workflowRequest),
          userId
        );

        const result = await workflowHandler(event, mockContext);
        
        // Clear temp data
        tempData.length = 0;
        
        return result;
      };

      const { results, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, 20);

      const successfulResults = results.filter(r => r.statusCode === 202);
      expect(successfulResults.length).toBe(20);
      expect(averageDuration).toBeLessThan(3000); // Should handle GC pressure
    });
  });
});