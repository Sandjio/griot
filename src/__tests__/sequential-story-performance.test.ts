/**
 * Performance tests for sequential story generation
 * Tests system performance during batch story processing
 * Requirements: 6A.6
 */

import { EventBridgeEvent } from "aws-lambda";
import { handler as storyHandler } from "../lambdas/story-generation/index";
import {
  LambdaContextFactory,
  TestDataFactory,
  EventBridgeEventFactory,
  MockSetupUtils,
  PerformanceTestUtils,
  LoadTestUtils,
} from "./test-utils";

// Mock dependencies
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");
jest.mock("../lambdas/story-generation/bedrock-client");

import {
  GenerationRequestAccess,
  StoryAccess,
} from "../database/access-patterns";
import { EventPublisher } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { BedrockClient } from "../lambdas/story-generation/bedrock-client";

const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<typeof GenerationRequestAccess>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEventPublisher = EventPublisher as jest.MockedClass<typeof EventPublisher>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockBedrockClient = BedrockClient as jest.MockedClass<typeof BedrockClient>;

describe("Sequential Story Performance Tests", () => {
  const mockContext = LambdaContextFactory.createContext("story-performance");
  const testUserId = "perf-user-123";
  const testWorkflowId = "perf-workflow-456";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupPerformanceMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupPerformanceMocks() {
    // Fast mock responses for performance testing
    mockGenerationRequestAccess.updateStatus.mockResolvedValue();
    mockStoryAccess.create.mockResolvedValue();
    mockS3Operations.uploadText.mockResolvedValue("test-s3-key");

    const mockEventPublisherInstance = {
      publishEvent: jest.fn().mockResolvedValue(),
    };
    mockEventPublisher.mockImplementation(() => mockEventPublisherInstance as any);

    // Bedrock client with realistic response times
    const mockBedrockInstance = {
      generateStory: jest.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            title: `Generated Story ${Date.now()}`,
            content: "Story content with sufficient length to simulate real generation",
            metadata: { wordCount: 1500, estimatedReadingTime: 7 },
          }), 100) // 100ms to simulate Bedrock processing
        )
      ),
    };
    mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);
  }

  describe("Single Story Generation Performance", () => {
    it("should generate single story within 2 minutes", async () => {
      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

      const { result, duration } = await PerformanceTestUtils.measureExecutionTime(() =>
        storyHandler(storyEvent, mockContext)
      );

      expect(duration).toBeLessThan(120000); // 2 minutes
      expect(mockStoryAccess.create).toHaveBeenCalled();
    });

    it("should handle story generation with varying content sizes", async () => {
      const contentSizes = [500, 1000, 2000, 5000]; // Different word counts
      const results: { size: number; duration: number }[] = [];

      for (const size of contentSizes) {
        const mockBedrockInstance = {
          generateStory: jest.fn().mockResolvedValue({
            title: `Story ${size} words`,
            content: "word ".repeat(size),
            metadata: { wordCount: size },
          }),
        };
        mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

        const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);

        const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
          storyHandler(storyEvent, mockContext)
        );

        results.push({ size, duration });
      }

      // Verify performance scales reasonably with content size
      results.forEach(({ size, duration }) => {
        expect(duration).toBeLessThan(size * 0.1); // Max 0.1ms per word
      });

      // Larger content should not take exponentially longer
      const smallestDuration = Math.min(...results.map(r => r.duration));
      const largestDuration = Math.max(...results.map(r => r.duration));
      expect(largestDuration / smallestDuration).toBeLessThan(5); // Max 5x difference
    });
  });

  describe("Sequential Batch Processing Performance", () => {
    it("should process 5 stories sequentially within 10 minutes", async () => {
      const numberOfStories = 5;
      const storyDurations: number[] = [];

      for (let i = 1; i <= numberOfStories; i++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${i}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId: testWorkflowId,
            requestId: "test-request-123",
            numberOfStories,
            currentBatch: i,
            totalBatches: numberOfStories,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
          storyHandler(batchEvent, mockContext)
        );

        storyDurations.push(duration);
      }

      const totalDuration = storyDurations.reduce((sum, duration) => sum + duration, 0);
      const averageDuration = totalDuration / numberOfStories;

      expect(totalDuration).toBeLessThan(600000); // 10 minutes total
      expect(averageDuration).toBeLessThan(120000); // 2 minutes average per story

      // Verify all stories were created
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(numberOfStories);
    });

    it("should maintain consistent performance across batch", async () => {
      const numberOfStories = 10;
      const storyDurations: number[] = [];

      for (let i = 1; i <= numberOfStories; i++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${i}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId: testWorkflowId,
            requestId: "test-request-123",
            numberOfStories,
            currentBatch: i,
            totalBatches: numberOfStories,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
          storyHandler(batchEvent, mockContext)
        );

        storyDurations.push(duration);
      }

      // Check for performance degradation over time
      const firstHalf = storyDurations.slice(0, 5);
      const secondHalf = storyDurations.slice(5);

      const firstHalfAvg = firstHalf.reduce((sum, d) => sum + d, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, d) => sum + d, 0) / secondHalf.length;

      // Second half should not be significantly slower (max 50% increase)
      expect(secondHalfAvg / firstHalfAvg).toBeLessThan(1.5);

      // Standard deviation should be reasonable (consistent performance)
      const avgDuration = storyDurations.reduce((sum, d) => sum + d, 0) / storyDurations.length;
      const variance = storyDurations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / storyDurations.length;
      const stdDev = Math.sqrt(variance);

      expect(stdDev / avgDuration).toBeLessThan(0.3); // Coefficient of variation < 30%
    });

    it("should handle memory pressure during sequential processing", async () => {
      const initialMemory = process.memoryUsage();
      const numberOfStories = 8;

      // Generate stories with larger content to pressure memory
      const mockBedrockInstance = {
        generateStory: jest.fn().mockImplementation(() => 
          Promise.resolve({
            title: `Large Story ${Date.now()}`,
            content: "word ".repeat(10000), // 10k words
            metadata: { wordCount: 10000 },
          })
        ),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      for (let i = 1; i <= numberOfStories; i++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${i}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId: testWorkflowId,
            requestId: "test-request-123",
            numberOfStories,
            currentBatch: i,
            totalBatches: numberOfStories,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        await storyHandler(batchEvent, mockContext);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 100MB)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);

      // Verify all stories were still created despite memory pressure
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(numberOfStories);
    });
  });

  describe("Concurrent Story Generation Performance", () => {
    it("should handle multiple concurrent story generations", async () => {
      const concurrentStories = 5;
      
      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(userId);
        return await storyHandler(storyEvent, mockContext);
      };

      const { results, totalDuration, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, concurrentStories);

      expect(results).toHaveLength(concurrentStories);
      expect(totalDuration).toBeLessThan(180000); // 3 minutes total for concurrent execution
      expect(averageDuration).toBeLessThan(150000); // 2.5 minutes average (accounting for concurrency)

      // Verify all stories were created
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(concurrentStories);
    });

    it("should maintain performance under database connection pressure", async () => {
      // Simulate database connection delays
      mockStoryAccess.create.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 50)) // 50ms delay
      );

      const concurrentStories = 10;
      
      const testFn = async () => {
        const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
        const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(userId);
        return await storyHandler(storyEvent, mockContext);
      };

      const { results, averageDuration } = 
        await PerformanceTestUtils.runConcurrentTests(testFn, concurrentStories);

      expect(results).toHaveLength(concurrentStories);
      expect(averageDuration).toBeLessThan(200000); // Should handle delays gracefully

      // All should succeed despite database delays
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(concurrentStories);
    });
  });

  describe("Resource Utilization Performance", () => {
    it("should efficiently utilize CPU during story generation", async () => {
      const numberOfStories = 5;
      const cpuUsageSamples: number[] = [];

      // Mock CPU-intensive story generation
      const mockBedrockInstance = {
        generateStory: jest.fn().mockImplementation(() => {
          const startTime = process.hrtime.bigint();
          
          // Simulate CPU work
          let result = 0;
          for (let i = 0; i < 1000000; i++) {
            result += Math.random();
          }
          
          const endTime = process.hrtime.bigint();
          const cpuTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
          cpuUsageSamples.push(cpuTime);

          return Promise.resolve({
            title: `CPU Story ${result}`,
            content: "Generated content",
            metadata: { wordCount: 1000 },
          });
        }),
      };
      mockBedrockClient.mockImplementation(() => mockBedrockInstance as any);

      for (let i = 1; i <= numberOfStories; i++) {
        const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);
        await storyHandler(storyEvent, mockContext);
      }

      // CPU usage should be consistent
      const avgCpuTime = cpuUsageSamples.reduce((sum, time) => sum + time, 0) / cpuUsageSamples.length;
      const maxCpuTime = Math.max(...cpuUsageSamples);
      const minCpuTime = Math.min(...cpuUsageSamples);

      expect(maxCpuTime / minCpuTime).toBeLessThan(2); // Max 2x variation in CPU time
      expect(avgCpuTime).toBeLessThan(1000); // Average CPU time < 1 second
    });

    it("should handle I/O intensive operations efficiently", async () => {
      const numberOfStories = 3;
      const ioTimes: number[] = [];

      // Mock I/O intensive operations
      mockS3Operations.uploadText.mockImplementation((key, content) => {
        const startTime = Date.now();
        return new Promise(resolve => {
          setTimeout(() => {
            const ioTime = Date.now() - startTime;
            ioTimes.push(ioTime);
            resolve(`s3-key-${Date.now()}`);
          }, 200); // 200ms I/O delay
        });
      });

      for (let i = 1; i <= numberOfStories; i++) {
        const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(testUserId);
        await storyHandler(storyEvent, mockContext);
      }

      // I/O times should be consistent
      const avgIoTime = ioTimes.reduce((sum, time) => sum + time, 0) / ioTimes.length;
      expect(avgIoTime).toBeGreaterThan(180); // Should include the 200ms delay
      expect(avgIoTime).toBeLessThan(250); // But not much more

      // Verify all uploads completed
      expect(mockS3Operations.uploadText).toHaveBeenCalledTimes(numberOfStories);
    });
  });

  describe("Scalability Performance", () => {
    it("should scale linearly with batch size", async () => {
      const batchSizes = [1, 3, 5, 8];
      const scalabilityResults: { batchSize: number; totalDuration: number; avgDuration: number }[] = [];

      for (const batchSize of batchSizes) {
        const startTime = Date.now();

        for (let i = 1; i <= batchSize; i++) {
          const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
            version: "0",
            id: `test-event-${i}`,
            "detail-type": "Batch Story Generation Requested",
            source: "manga.workflow",
            account: "123456789012",
            time: "2024-01-01T00:00:00Z",
            region: "us-east-1",
            resources: [],
            detail: {
              userId: testUserId,
              workflowId: testWorkflowId,
              requestId: `test-request-${batchSize}`,
              numberOfStories: batchSize,
              currentBatch: i,
              totalBatches: batchSize,
              preferences: TestDataFactory.createUserPreferences(),
              insights: TestDataFactory.createQlooInsights(),
              timestamp: "2024-01-01T00:00:00Z",
            },
          };

          await storyHandler(batchEvent, mockContext);
        }

        const totalDuration = Date.now() - startTime;
        const avgDuration = totalDuration / batchSize;

        scalabilityResults.push({ batchSize, totalDuration, avgDuration });
      }

      // Average duration per story should remain relatively constant
      const avgDurations = scalabilityResults.map(r => r.avgDuration);
      const minAvgDuration = Math.min(...avgDurations);
      const maxAvgDuration = Math.max(...avgDurations);

      expect(maxAvgDuration / minAvgDuration).toBeLessThan(1.5); // Max 50% variation

      // Total duration should scale roughly linearly
      scalabilityResults.forEach(({ batchSize, totalDuration }) => {
        const expectedMaxDuration = batchSize * 150000; // 2.5 minutes per story max
        expect(totalDuration).toBeLessThan(expectedMaxDuration);
      });
    });

    it("should handle maximum batch size efficiently", async () => {
      const maxBatchSize = 10;
      const startTime = Date.now();

      for (let i = 1; i <= maxBatchSize; i++) {
        const batchEvent: EventBridgeEvent<"Batch Story Generation Requested", any> = {
          version: "0",
          id: `test-event-${i}`,
          "detail-type": "Batch Story Generation Requested",
          source: "manga.workflow",
          account: "123456789012",
          time: "2024-01-01T00:00:00Z",
          region: "us-east-1",
          resources: [],
          detail: {
            userId: testUserId,
            workflowId: testWorkflowId,
            requestId: "test-request-max",
            numberOfStories: maxBatchSize,
            currentBatch: i,
            totalBatches: maxBatchSize,
            preferences: TestDataFactory.createUserPreferences(),
            insights: TestDataFactory.createQlooInsights(),
            timestamp: "2024-01-01T00:00:00Z",
          },
        };

        await storyHandler(batchEvent, mockContext);
      }

      const totalDuration = Date.now() - startTime;
      const avgDuration = totalDuration / maxBatchSize;

      // Should complete maximum batch within 25 minutes (2.5 min per story)
      expect(totalDuration).toBeLessThan(1500000); // 25 minutes
      expect(avgDuration).toBeLessThan(150000); // 2.5 minutes per story

      // Verify all stories were created
      expect(mockStoryAccess.create).toHaveBeenCalledTimes(maxBatchSize);
    });
  });
});