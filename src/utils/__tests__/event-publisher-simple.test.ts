import { EventPublisher } from "../event-publisher";

// Mock AWS SDK
jest.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      FailedEntryCount: 0,
      Entries: [{ EventId: "test-event-id" }],
    }),
  })),
  PutEventsCommand: jest.fn(),
}));

describe("EventPublisher", () => {
  it("should create an instance", () => {
    const eventPublisher = new EventPublisher("test-bus");
    expect(eventPublisher).toBeInstanceOf(EventPublisher);
  });

  it("should publish story generation event", async () => {
    const eventPublisher = new EventPublisher("test-bus");
    const eventDetail = {
      userId: "user-123",
      requestId: "req-456",
      preferences: { genres: ["action"] },
      insights: { recommendations: [] },
      timestamp: "2024-01-01T00:00:00.000Z",
    };

    await expect(
      eventPublisher.publishStoryGenerationEvent(eventDetail)
    ).resolves.not.toThrow();
  });
});
