/**
 * Unit tests for Status Check Lambda function
 */

import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { handler } from "../index";
import { GenerationRequestAccess } from "../../../database/access-patterns";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestAssertions,
} from "../../../__tests__/test-utils";

// Mock dependencies
jest.mock("../../../database/access-patterns");

const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;

describe("Status Check Lambda", () => {
  const mockContext = LambdaContextFactory.createContext("status-check");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      const event = APIGatewayEventFactory.createUnauthenticatedEvent(
        "GET",
        "/status/test-request-123"
      );

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "UNAUTHORIZED", 401);
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when requestId is missing", async () => {
      const event = APIGatewayEventFactory.createEvent("GET", "/status");
      event.pathParameters = null;

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INVALID_REQUEST", 400);
    });

    it("should return 400 when requestId is empty", async () => {
      const event = APIGatewayEventFactory.createEvent("GET", "/status/");
      event.pathParameters = { requestId: "" };

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INVALID_REQUEST", 400);
    });
  });

  describe("Successful Status Retrieval", () => {
    it("should return status for pending request", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
        PK: "USER#test-user-123",
        SK: "REQUEST#test-request-123",
        GSI1PK: "REQUEST#test-request-123",
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PENDING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: "test-request-123",
        userId: "test-user-123",
        type: "STORY",
        status: "PENDING",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidSuccessResponse(result, {
        requestId: "test-request-123",
        status: "PENDING",
        type: "STORY",
      });

      expect(mockGenerationRequestAccess.getByRequestId).toHaveBeenCalledWith(
        "test-request-123"
      );
    });

    it("should return status for processing request", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
        PK: "USER#test-user-123",
        SK: "REQUEST#test-request-123",
        GSI1PK: "REQUEST#test-request-123",
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PROCESSING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: "test-request-123",
        userId: "test-user-123",
        type: "STORY",
        status: "PROCESSING",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        currentStep: "STORY_GENERATION",
        progress: 25,
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidSuccessResponse(result, {
        requestId: "test-request-123",
        status: "PROCESSING",
        type: "STORY",
        currentStep: "STORY_GENERATION",
        progress: 25,
      });
    });

    it("should return status for completed request", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
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
        completedAt: "2024-01-01T00:05:00.000Z",
        result: {
          storyId: "test-story-123",
          episodeCount: 3,
        },
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidSuccessResponse(result, {
        requestId: "test-request-123",
        status: "COMPLETED",
        type: "STORY",
        completedAt: "2024-01-01T00:05:00.000Z",
        result: {
          storyId: "test-story-123",
          episodeCount: 3,
        },
      });
    });

    it("should return status for failed request", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
        PK: "USER#test-user-123",
        SK: "REQUEST#test-request-123",
        GSI1PK: "REQUEST#test-request-123",
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#FAILED",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: "test-request-123",
        userId: "test-user-123",
        type: "STORY",
        status: "FAILED",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        failedAt: "2024-01-01T00:02:00.000Z",
        errorMessage: "Bedrock API error",
        errorDetails: {
          code: "BEDROCK_ERROR",
          retryable: true,
        },
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidSuccessResponse(result, {
        requestId: "test-request-123",
        status: "FAILED",
        type: "STORY",
        failedAt: "2024-01-01T00:02:00.000Z",
        errorMessage: "Bedrock API error",
      });
    });
  });

  describe("Authorization", () => {
    it("should return 403 when user tries to access another user's request", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123",
        null,
        "different-user-456"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
        PK: "USER#test-user-123",
        SK: "REQUEST#test-request-123",
        GSI1PK: "REQUEST#test-request-123",
        GSI1SK: "STATUS",
        GSI2PK: "STATUS#PENDING",
        GSI2SK: "2024-01-01T00:00:00.000Z",
        requestId: "test-request-123",
        userId: "test-user-123",
        type: "STORY",
        status: "PENDING",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "FORBIDDEN", 403);
    });
  });

  describe("Error Handling", () => {
    it("should return 404 when request is not found", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/non-existent-request"
      );
      event.pathParameters = { requestId: "non-existent-request" };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(null);

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "NOT_FOUND", 404);
    });

    it("should handle database errors", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      mockGenerationRequestAccess.getByRequestId.mockRejectedValue(
        new Error("Database error")
      );

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "DATABASE_ERROR", 500);
    });

    it("should handle unexpected errors", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      mockGenerationRequestAccess.getByRequestId.mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      const result = await handler(event, mockContext);

      TestAssertions.expectValidErrorResponse(result, "INTERNAL_ERROR", 500);
    });
  });

  describe("Response Headers", () => {
    it("should include security headers in all responses", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(null);

      const result = await handler(event, mockContext);

      TestAssertions.expectSecurityHeaders(result.headers);
    });
  });

  describe("Performance", () => {
    it("should respond within acceptable time limits", async () => {
      const event = APIGatewayEventFactory.createEvent(
        "GET",
        "/status/test-request-123"
      );
      event.pathParameters = { requestId: "test-request-123" };

      const mockRequest = {
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
      };

      mockGenerationRequestAccess.getByRequestId.mockResolvedValue(mockRequest);

      const start = Date.now();
      await handler(event, mockContext);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should respond within 1 second
    });
  });
});
