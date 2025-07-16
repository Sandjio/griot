import { PostAuthenticationTriggerEvent } from "aws-lambda";

// Mock AWS SDK before importing the handler
const mockSend = jest.fn();

// Create mock command classes
const MockGetCommand = jest.fn();
const MockPutCommand = jest.fn();

// Create ConditionalCheckFailedException class
class ConditionalCheckFailedException extends Error {
  constructor(options: any) {
    super(options.message);
    this.name = "ConditionalCheckFailedException";
  }
}

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: mockSend,
    }),
  },
  PutCommand: MockPutCommand,
  GetCommand: MockGetCommand,
  ConditionalCheckFailedException,
}));

// Mock error utilities
jest.mock("../../../types/error-types", () => ({
  ErrorUtils: {
    createError: jest.fn((code, message, details, requestId) => ({
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    })),
    createValidationError: jest.fn((message, fieldErrors, requestId) => ({
      code: "VALIDATION_ERROR",
      message,
      details: fieldErrors,
      requestId,
      timestamp: new Date().toISOString(),
    })),
    logError: jest.fn(),
  },
}));

// Import handler after mocking
import { handler } from "../index";
import { ErrorUtils } from "../../../types/error-types";

describe("Post Authentication Trigger", () => {
  const mockEvent: PostAuthenticationTriggerEvent = {
    version: "1",
    region: "us-east-1",
    userPoolId: "us-east-1_test123",
    userName: "testuser",
    callerContext: {
      awsSdkVersion: "1.0.0",
      clientId: "test-client-id",
    },
    triggerSource: "PostAuthentication_Authentication",
    request: {
      userAttributes: {
        sub: "test-user-id-123",
        email: "test@example.com",
        email_verified: "true",
      },
      newDeviceUsed: false,
      clientMetadata: {},
    },
    response: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MANGA_TABLE_NAME = "manga-platform-table-test";
  });

  afterEach(() => {
    delete process.env.MANGA_TABLE_NAME;
  });

  describe("Successful user profile creation", () => {
    it("should create user profile when user does not exist", async () => {
      // Mock that user doesn't exist
      mockSend.mockResolvedValueOnce({ Item: null });
      // Mock successful profile creation
      mockSend.mockResolvedValueOnce({});

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Verify GetCommand was called first
      expect(MockGetCommand).toHaveBeenCalledWith({
        TableName: "manga-platform-table-test",
        Key: {
          PK: "USER#test-user-id-123",
          SK: "PROFILE",
        },
      });

      // Verify PutCommand was called to create user profile
      expect(MockPutCommand).toHaveBeenCalledWith({
        TableName: "manga-platform-table-test",
        Item: expect.objectContaining({
          PK: "USER#test-user-id-123",
          SK: "PROFILE",
          GSI1PK: "USER#test-user-id-123",
          GSI1SK: "PROFILE",
          email: "test@example.com",
          status: "ACTIVE",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
        ConditionExpression: "attribute_not_exists(PK)",
      });
    });

    it("should not create user profile when user already exists", async () => {
      // Mock that user already exists
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: "USER#test-user-id-123",
          SK: "PROFILE",
          email: "test@example.com",
          status: "ACTIVE",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      });

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Only GetCommand should be called, no PutCommand
      expect(MockGetCommand).toHaveBeenCalledWith({
        TableName: "manga-platform-table-test",
        Key: {
          PK: "USER#test-user-id-123",
          SK: "PROFILE",
        },
      });
      expect(MockPutCommand).not.toHaveBeenCalled();
    });
  });

  describe("Input validation", () => {
    it("should handle missing sub attribute gracefully", async () => {
      const eventWithMissingSub = {
        ...mockEvent,
        request: {
          ...mockEvent.request,
          userAttributes: {
            email: "test@example.com",
            // Missing sub
          },
        },
      };

      const result = await handler(eventWithMissingSub);

      expect(result).toEqual(eventWithMissingSub);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ErrorUtils.createValidationError).toHaveBeenCalledWith(
        "Missing required user attributes",
        [{ field: "sub", value: undefined, constraint: "required" }],
        expect.any(String)
      );
      expect(ErrorUtils.logError).toHaveBeenCalled();
    });

    it("should handle missing email attribute gracefully", async () => {
      const eventWithMissingEmail = {
        ...mockEvent,
        request: {
          ...mockEvent.request,
          userAttributes: {
            sub: "test-user-id-123",
            // Missing email
          },
        },
      };

      const result = await handler(eventWithMissingEmail);

      expect(result).toEqual(eventWithMissingEmail);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ErrorUtils.createValidationError).toHaveBeenCalledWith(
        "Missing required user attributes",
        [{ field: "email", value: undefined, constraint: "required" }],
        expect.any(String)
      );
    });

    it("should handle missing both sub and email attributes", async () => {
      const eventWithMissingAttributes = {
        ...mockEvent,
        request: {
          ...mockEvent.request,
          userAttributes: {},
        },
      };

      const result = await handler(eventWithMissingAttributes);

      expect(result).toEqual(eventWithMissingAttributes);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ErrorUtils.createValidationError).toHaveBeenCalledWith(
        "Missing required user attributes",
        [
          { field: "sub", value: undefined, constraint: "required" },
          { field: "email", value: undefined, constraint: "required" },
        ],
        expect.any(String)
      );
    });

    it("should handle invalid email format gracefully", async () => {
      const eventWithInvalidEmail = {
        ...mockEvent,
        request: {
          ...mockEvent.request,
          userAttributes: {
            sub: "test-user-id-123",
            email: "invalid-email-format",
          },
        },
      };

      const result = await handler(eventWithInvalidEmail);

      expect(result).toEqual(eventWithInvalidEmail);
      expect(mockSend).not.toHaveBeenCalled();
      expect(ErrorUtils.createValidationError).toHaveBeenCalledWith(
        "Invalid email format",
        [
          {
            field: "email",
            value: "invalid-email-format",
            constraint: "valid email format",
          },
        ],
        expect.any(String)
      );
    });
  });

  describe("Error handling", () => {
    it("should handle DynamoDB GetCommand errors gracefully", async () => {
      // Mock DynamoDB error on GetCommand
      mockSend.mockRejectedValueOnce(new Error("DynamoDB GetCommand error"));

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(ErrorUtils.createError).toHaveBeenCalledWith(
        "INTERNAL_ERROR",
        "Failed to process post authentication trigger",
        expect.objectContaining({
          component: "PostAuthenticationTrigger",
          operation: "createUserProfile",
          originalError: "DynamoDB GetCommand error",
        }),
        expect.any(String)
      );
      expect(ErrorUtils.logError).toHaveBeenCalled();
    });

    it("should handle DynamoDB PutCommand errors gracefully", async () => {
      // Mock that user doesn't exist
      mockSend.mockResolvedValueOnce({ Item: null });
      // Mock DynamoDB error on PutCommand
      mockSend.mockRejectedValueOnce(new Error("DynamoDB PutCommand error"));

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(ErrorUtils.createError).toHaveBeenCalledWith(
        "INTERNAL_ERROR",
        "Failed to process post authentication trigger",
        expect.objectContaining({
          component: "PostAuthenticationTrigger",
          operation: "createUserProfile",
          originalError: "DynamoDB PutCommand error",
        }),
        expect.any(String)
      );
    });

    it("should handle ConditionalCheckFailedException gracefully (race condition)", async () => {
      // Mock that user doesn't exist
      mockSend.mockResolvedValueOnce({ Item: null });
      // Mock conditional check failed (race condition)
      const conditionalCheckError = new ConditionalCheckFailedException({
        message: "The conditional request failed",
        $metadata: {},
      });
      mockSend.mockRejectedValueOnce(conditionalCheckError);

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(2);
      // Should not call ErrorUtils.createError for ConditionalCheckFailedException
      expect(ErrorUtils.createError).not.toHaveBeenCalled();
    });
  });

  describe("Request ID handling", () => {
    it("should use request ID from client metadata when available", async () => {
      const eventWithRequestId = {
        ...mockEvent,
        request: {
          ...mockEvent.request,
          clientMetadata: {
            requestId: "custom-request-id-123",
          },
        },
      };

      // Mock that user doesn't exist
      mockSend.mockResolvedValueOnce({ Item: null });
      // Mock successful profile creation
      mockSend.mockResolvedValueOnce({});

      const result = await handler(eventWithRequestId);

      expect(result).toEqual(eventWithRequestId);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should generate request ID when not provided in client metadata", async () => {
      // Mock that user doesn't exist
      mockSend.mockResolvedValueOnce({ Item: null });
      // Mock successful profile creation
      mockSend.mockResolvedValueOnce({});

      const result = await handler(mockEvent);

      expect(result).toEqual(mockEvent);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("Environment variable validation", () => {
    it("should throw error when MANGA_TABLE_NAME is not set", async () => {
      delete process.env.MANGA_TABLE_NAME;

      // Re-import the module to trigger environment validation
      jest.resetModules();

      await expect(async () => {
        await import("../index");
      }).rejects.toThrow("MANGA_TABLE_NAME environment variable is required");
    });
  });
});
