import { PostAuthenticationTriggerEvent } from "aws-lambda";

// Mock AWS SDK before importing the handler
const mockSend = jest.fn();
const mockDocClient = {
  send: mockSend,
};

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue(mockDocClient),
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
}));

// Import handler after mocking
import { handler } from "../index";

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
    process.env.MANGA_TABLE_NAME = "test-manga-table";
  });

  afterEach(() => {
    delete process.env.MANGA_TABLE_NAME;
  });

  it("should create user profile when user does not exist", async () => {
    // Mock that user doesn't exist
    mockSend.mockResolvedValueOnce({ Item: null });
    // Mock successful profile creation
    mockSend.mockResolvedValueOnce({});

    const result = await handler(mockEvent);

    expect(result).toEqual(mockEvent);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("should not create user profile when user already exists", async () => {
    // Mock that user already exists
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: "USER#test-user-id-123",
        SK: "PROFILE",
        userId: "test-user-id-123",
        email: "test@example.com",
      },
    });

    const result = await handler(mockEvent);

    expect(result).toEqual(mockEvent);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should handle missing user attributes gracefully", async () => {
    const eventWithMissingAttributes = {
      ...mockEvent,
      request: {
        ...mockEvent.request,
        userAttributes: {
          // Missing sub and email
        },
      },
    };

    const result = await handler(eventWithMissingAttributes);

    expect(result).toEqual(eventWithMissingAttributes);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("should handle DynamoDB errors gracefully", async () => {
    // Mock DynamoDB error
    mockSend.mockRejectedValueOnce(new Error("DynamoDB error"));

    const result = await handler(mockEvent);

    expect(result).toEqual(mockEvent);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should handle conditional check failed error gracefully", async () => {
    // Mock that user doesn't exist
    mockSend.mockResolvedValueOnce({ Item: null });
    // Mock conditional check failed (race condition)
    const conditionalCheckError = new Error("ConditionalCheckFailedException");
    conditionalCheckError.name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(conditionalCheckError);

    const result = await handler(mockEvent);

    expect(result).toEqual(mockEvent);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
