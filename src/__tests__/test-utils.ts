/**
 * Test utilities for comprehensive test suite
 * Provides common test data, mocks, and helper functions
 */

import { APIGatewayProxyEvent, Context, EventBridgeEvent } from "aws-lambda";
import {
  UserPreferencesData,
  QlooInsights,
  Story,
  Episode,
  UserProfile,
} from "../types/data-models";

// Test data factories
export class TestDataFactory {
  static createUserPreferences(): UserPreferencesData {
    return {
      genres: ["Action", "Adventure"],
      themes: ["Friendship", "Growth"],
      artStyle: "Modern",
      targetAudience: "Young Adults",
      contentRating: "PG-13",
    };
  }

  static createQlooInsights(): QlooInsights {
    return {
      recommendations: [
        {
          category: "Action",
          score: 0.9,
          attributes: { intensity: "high" },
        },
        {
          category: "Adventure",
          score: 0.8,
          attributes: { setting: "fantasy" },
        },
      ],
      trends: [
        {
          topic: "Friendship",
          popularity: 0.95,
        },
        {
          topic: "Growth",
          popularity: 0.85,
        },
      ],
    };
  }

  static createUserProfile(userId: string = "test-user-123"): UserProfile {
    return {
      PK: `USER#${userId}`,
      SK: "PROFILE",
      GSI1PK: `USER#${userId}`,
      GSI1SK: "PROFILE",
      email: "test@example.com",
      status: "ACTIVE",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
  }

  static createStory(
    userId: string = "test-user-123",
    storyId: string = "test-story-123"
  ): Story {
    return {
      PK: `USER#${userId}`,
      SK: `STORY#${storyId}`,
      GSI1PK: `STORY#${storyId}`,
      GSI1SK: "METADATA",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2024-01-01T00:00:00.000Z",
      storyId,
      title: "Test Adventure Story",
      s3Key: `stories/${userId}/${storyId}/story.md`,
      status: "COMPLETED",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
  }

  static createEpisode(
    storyId: string = "test-story-123",
    episodeNumber: number = 1
  ): Episode {
    const episodeId = `${storyId}-ep-${episodeNumber}`;
    return {
      PK: `STORY#${storyId}`,
      SK: `EPISODE#${episodeNumber}`,
      GSI1PK: `EPISODE#${episodeId}`,
      GSI1SK: "METADATA",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2024-01-01T00:00:00.000Z",
      episodeId,
      s3Key: `episodes/test-user-123/${storyId}/${episodeNumber}/episode.md`,
      pdfS3Key: `episodes/test-user-123/${storyId}/${episodeNumber}/episode.pdf`,
      status: "COMPLETED",
      createdAt: "2024-01-01T00:00:00.000Z",
    };
  }
}

// API Gateway event factory
export class APIGatewayEventFactory {
  static createEvent(
    httpMethod: string = "POST",
    path: string = "/preferences",
    body: string | null = null,
    userId: string = "test-user-123",
    headers: Record<string, string> = {}
  ): APIGatewayProxyEvent {
    return {
      httpMethod,
      path,
      pathParameters: null,
      queryStringParameters: null,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body,
      isBase64Encoded: false,
      requestContext: {
        requestId: "test-request-id",
        stage: "test",
        resourceId: "test-resource",
        resourcePath: path,
        httpMethod,
        requestTime: "01/Jan/2024:00:00:00 +0000",
        requestTimeEpoch: 1704067200000,
        path: `/test${path}`,
        accountId: "123456789012",
        protocol: "HTTP/1.1",
        identity: {
          accessKey: null,
          accountId: null,
          apiKey: null,
          apiKeyId: null,
          caller: null,
          cognitoAuthenticationProvider: null,
          cognitoAuthenticationType: null,
          cognitoIdentityId: null,
          cognitoIdentityPoolId: null,
          principalOrgId: null,
          sourceIp: "127.0.0.1",
          user: null,
          userAgent: "test-agent",
          userArn: null,
          clientCert: null,
        },
        authorizer: userId
          ? {
              claims: {
                sub: userId,
                email: "test@example.com",
              },
            }
          : undefined,
        apiId: "test-api-id",
      },
      resource: path,
      stageVariables: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
    };
  }

  static createUnauthenticatedEvent(
    httpMethod: string = "POST",
    path: string = "/preferences",
    body: string | null = null
  ): APIGatewayProxyEvent {
    const event = this.createEvent(httpMethod, path, body, "");
    event.requestContext.authorizer = undefined;
    return event;
  }
}

// EventBridge event factory
export class EventBridgeEventFactory {
  static createStoryGenerationEvent(
    userId: string = "test-user-123",
    requestId: string = "test-request-456"
  ): EventBridgeEvent<"Story Generation Requested", any> {
    return {
      version: "0",
      id: "test-event-id",
      "detail-type": "Story Generation Requested",
      source: "manga.preferences",
      account: "123456789012",
      time: "2024-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail: {
        userId,
        requestId,
        preferences: TestDataFactory.createUserPreferences(),
        insights: TestDataFactory.createQlooInsights(),
        timestamp: "2024-01-01T00:00:00Z",
      },
    };
  }

  static createEpisodeGenerationEvent(
    userId: string = "test-user-123",
    storyId: string = "test-story-123"
  ): EventBridgeEvent<"Episode Generation Requested", any> {
    return {
      version: "0",
      id: "test-event-id",
      "detail-type": "Episode Generation Requested",
      source: "manga.story",
      account: "123456789012",
      time: "2024-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail: {
        userId,
        storyId,
        storyS3Key: `stories/${userId}/${storyId}/story.md`,
        episodeNumber: 1,
        timestamp: "2024-01-01T00:00:00Z",
      },
    };
  }

  static createImageGenerationEvent(
    userId: string = "test-user-123",
    episodeId: string = "test-episode-123"
  ): EventBridgeEvent<"Image Generation Requested", any> {
    return {
      version: "0",
      id: "test-event-id",
      "detail-type": "Image Generation Requested",
      source: "manga.episode",
      account: "123456789012",
      time: "2024-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      detail: {
        userId,
        episodeId,
        episodeS3Key: `episodes/${userId}/test-story-123/1/episode.md`,
        timestamp: "2024-01-01T00:00:00Z",
      },
    };
  }
}

// Lambda context factory
export class LambdaContextFactory {
  static createContext(functionName: string = "test-function"): Context {
    return {
      callbackWaitsForEmptyEventLoop: false,
      functionName,
      functionVersion: "1",
      invokedFunctionArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}`,
      memoryLimitInMB: "256",
      awsRequestId: "test-aws-request-id",
      logGroupName: `/aws/lambda/${functionName}`,
      logStreamName: "2024/01/01/[$LATEST]test-stream",
      getRemainingTimeInMillis: () => 30000,
    };
  }
}

// Mock setup utilities
export class MockSetupUtils {
  static setupConsoleMocks() {
    const mockConsoleLog = jest.fn();
    const mockConsoleWarn = jest.fn();
    const mockConsoleError = jest.fn();

    console.log = mockConsoleLog;
    console.warn = mockConsoleWarn;
    console.error = mockConsoleError;

    return {
      mockConsoleLog,
      mockConsoleWarn,
      mockConsoleError,
    };
  }

  static setupAWSMocks() {
    // Common AWS SDK mocks setup
    const mockSend = jest.fn();

    return {
      mockSend,
    };
  }

  static setupEnvironmentVariables() {
    process.env.DYNAMODB_TABLE_NAME = "test-table";
    process.env.S3_BUCKET_NAME = "test-bucket";
    process.env.EVENTBRIDGE_BUS_NAME = "test-bus";
    process.env.QLOO_API_KEY = "test-api-key";
    process.env.QLOO_API_URL = "https://test-qloo-api.com";
  }

  static cleanupEnvironmentVariables() {
    delete process.env.DYNAMODB_TABLE_NAME;
    delete process.env.S3_BUCKET_NAME;
    delete process.env.EVENTBRIDGE_BUS_NAME;
    delete process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_URL;
  }
}

// Test assertion helpers
export class TestAssertions {
  static expectValidAPIResponse(
    response: any,
    expectedStatusCode: number = 200
  ) {
    expect(response).toHaveProperty("statusCode", expectedStatusCode);
    expect(response).toHaveProperty("headers");
    expect(response).toHaveProperty("body");
    expect(typeof response.body).toBe("string");
  }

  static expectValidErrorResponse(
    response: any,
    expectedCode: string,
    expectedStatusCode: number = 400
  ) {
    this.expectValidAPIResponse(response, expectedStatusCode);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty("error");
    expect(body.error).toHaveProperty("code", expectedCode);
    expect(body.error).toHaveProperty("message");
    expect(body.error).toHaveProperty("timestamp");
  }

  static expectValidSuccessResponse(response: any, expectedData?: any) {
    this.expectValidAPIResponse(response, 200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("data");
    if (expectedData) {
      expect(body.data).toMatchObject(expectedData);
    }
  }

  static expectSecurityHeaders(headers: Record<string, string>) {
    expect(headers).toHaveProperty("X-Content-Type-Options", "nosniff");
    expect(headers).toHaveProperty("X-Frame-Options", "DENY");
    expect(headers).toHaveProperty("X-XSS-Protection", "1; mode=block");
    expect(headers).toHaveProperty("Strict-Transport-Security");
    expect(headers).toHaveProperty("Content-Security-Policy");
  }
}

// Performance testing utilities
export class PerformanceTestUtils {
  static async measureExecutionTime<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  }

  static async runConcurrentTests<T>(
    testFn: () => Promise<T>,
    concurrency: number = 10
  ): Promise<{ results: T[]; totalDuration: number; averageDuration: number }> {
    const start = Date.now();
    const promises = Array(concurrency)
      .fill(null)
      .map(() => testFn());
    const results = await Promise.all(promises);
    const totalDuration = Date.now() - start;
    const averageDuration = totalDuration / concurrency;

    return {
      results,
      totalDuration,
      averageDuration,
    };
  }
}

// Load testing utilities
export class LoadTestUtils {
  static async simulateLoad(
    testFn: () => Promise<any>,
    options: {
      duration: number; // in milliseconds
      rampUpTime: number; // in milliseconds
      maxConcurrency: number;
    }
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
  }> {
    const results: { success: boolean; duration: number }[] = [];
    const startTime = Date.now();
    const endTime = startTime + options.duration;

    let currentConcurrency = 1;
    const concurrencyIncrement =
      options.maxConcurrency / (options.rampUpTime / 1000);

    while (Date.now() < endTime) {
      const batchPromises: Promise<void>[] = [];

      for (let i = 0; i < Math.floor(currentConcurrency); i++) {
        batchPromises.push(
          (async () => {
            const requestStart = Date.now();
            try {
              await testFn();
              results.push({
                success: true,
                duration: Date.now() - requestStart,
              });
            } catch (error) {
              results.push({
                success: false,
                duration: Date.now() - requestStart,
              });
            }
          })()
        );
      }

      await Promise.all(batchPromises);

      // Ramp up concurrency
      if (Date.now() - startTime < options.rampUpTime) {
        currentConcurrency = Math.min(
          options.maxConcurrency,
          currentConcurrency + concurrencyIncrement
        );
      }

      // Small delay to prevent overwhelming
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const successfulRequests = results.filter((r) => r.success).length;
    const failedRequests = results.filter((r) => !r.success).length;
    const durations = results.map((r) => r.duration);

    return {
      totalRequests: results.length,
      successfulRequests,
      failedRequests,
      averageResponseTime:
        durations.reduce((a, b) => a + b, 0) / durations.length,
      maxResponseTime: Math.max(...durations),
      minResponseTime: Math.min(...durations),
    };
  }
}
