/**
 * End-to-End tests for complete manga generation workflow
 * Tests the entire user journey from preferences submission to final PDF generation
 */

import { APIGatewayProxyEvent } from "aws-lambda";
import { handler as preferencesHandler } from "../lambdas/preferences-processing/index";
import { handler as statusHandler } from "../lambdas/status-check/index";
import { handler as contentRetrievalHandler } from "../lambdas/content-retrieval/index";
import { handler as storyGenerationHandler } from "../lambdas/story-generation/index";
import { handler as episodeGenerationHandler } from "../lambdas/episode-generation/index";
import { handler as imageGenerationHandler } from "../lambdas/image-generation/index";
import {
  APIGatewayEventFactory,
  LambdaContextFactory,
  TestDataFactory,
  EventBridgeEventFactory,
  MockSetupUtils,
  PerformanceTestUtils,
} from "./test-utils";

// Mock all external dependencies
jest.mock("../database/access-patterns");
jest.mock("../utils/event-publisher");
jest.mock("../storage/s3-client");
jest.mock("../lambdas/preferences-processing/qloo-client");
jest.mock("../lambdas/story-generation/bedrock-client");
jest.mock("../lambdas/episode-generation/bedrock-client");
jest.mock("../lambdas/image-generation/bedrock-client");

// Import mocked modules
import {
  UserPreferencesAccess,
  GenerationRequestAccess,
  StoryAccess,
  EpisodeAccess,
} from "../database/access-patterns";
import { EventPublishingHelpers } from "../utils/event-publisher";
import { S3Operations } from "../storage/s3-client";
import { QlooApiClient } from "../lambdas/preferences-processing/qloo-client";
import { BedrockClient } from "../lambdas/story-generation/bedrock-client";
import { BedrockClient as EpisodeBedrockClient } from "../lambdas/episode-generation/bedrock-client";
import { BedrockClient as ImageBedrockClient } from "../lambdas/image-generation/bedrock-client";

const mockUserPreferencesAccess = UserPreferencesAccess as jest.Mocked<
  typeof UserPreferencesAccess
>;
const mockGenerationRequestAccess = GenerationRequestAccess as jest.Mocked<
  typeof GenerationRequestAccess
>;
const mockStoryAccess = StoryAccess as jest.Mocked<typeof StoryAccess>;
const mockEpisodeAccess = EpisodeAccess as jest.Mocked<typeof EpisodeAccess>;
const mockEventPublishingHelpers = EventPublishingHelpers as jest.Mocked<
  typeof EventPublishingHelpers
>;
const mockS3Operations = S3Operations as jest.Mocked<typeof S3Operations>;
const mockQlooApiClient = QlooApiClient as jest.MockedClass<
  typeof QlooApiClient
>;
const mockBedrockClient = BedrockClient as jest.MockedClass<
  typeof BedrockClient
>;
const mockEpisodeBedrockClient = EpisodeBedrockClient as jest.MockedClass<
  typeof EpisodeBedrockClient
>;
const mockImageBedrockClient = ImageBedrockClient as jest.MockedClass<
  typeof ImageBedrockClient
>;

describe("End-to-End Manga Generation Workflow", () => {
  const mockContext = LambdaContextFactory.createContext("e2e-workflow");
  const testUserId = "test-user-e2e-123";
  const testRequestId = "test-request-e2e-456";
  const testStoryId = "test-story-e2e-789";
  const testEpisodeId = "test-episode-e2e-101";

  beforeEach(() => {
    jest.clearAllMocks();
    MockSetupUtils.setupEnvironmentVariables();
    setupDefaultMocks();
  });

  afterEach(() => {
    MockSetupUtils.cleanupEnvironmentVariables();
  });

  function setupDefaultMocks() {
    // Preferences processing mocks
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
      PK: `USER#${testUserId}`,
      SK: `REQUEST#${testRequestId}`,
      GSI1PK: `REQUEST#${testRequestId}`,
      GSI1SK: "STATUS",
      GSI2PK: "STATUS#COMPLETED",
      GSI2SK: "2024-01-01T00:00:00.000Z",
      requestId: testRequestId,
      userId: testUserId,
      type: "STORY",
      status: "COMPLETED",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      result: {
        storyId: testStoryId,
        episodeCount: 1,
      },
    });

    mockEventPublishingHelpers.publishStoryGeneration.mockResolvedValue();
    mockEventPublishingHelpers.publishEpisodeGeneration.mockResolvedValue();
    mockEventPublishingHelpers.publishImageGeneration.mockResolvedValue();

    // Story generation mocks
    const mockStoryBedrockInstance = {
      generateStory: jest.fn().mockResolvedValue({
        title: "The Great Adventure",
        content:
          "# Chapter 1: The Beginning\n\nOnce upon a time in a magical land...",
        metadata: {
          wordCount: 1500,
          estimatedReadingTime: 7,
        },
      }),
    };
    mockBedrockClient.mockImplementation(() => mockStoryBedrockInstance as any);

    // Episode generation mocks
    const mockEpisodeBedrockInstance = {
      generateEpisode: jest.fn().mockResolvedValue({
        content:
          "## Episode 1: The Journey Begins\n\n*Scene 1*\n\nDialogue: 'Let's go on an adventure!'",
        metadata: {
          wordCount: 800,
          sceneCount: 3,
        },
      }),
    };
    mockEpisodeBedrockClient.mockImplementation(
      () => mockEpisodeBedrockInstance as any
    );

    // Image generation mocks
    const mockImageBedrockInstance = {
      generateImages: jest
        .fn()
        .mockResolvedValue([
          Buffer.from("image1-data"),
          Buffer.from("image2-data"),
          Buffer.from("image3-data"),
        ]),
    };
    const mockPdfGenerator = {
      createPDF: jest
        .fn()
        .mockResolvedValue(Buffer.from("complete-manga-pdf-data")),
    };
    mockImageBedrockClient.mockImplementation(
      () =>
        ({
          ...mockImageBedrockInstance,
          ...mockPdfGenerator,
        } as any)
    );

    // Storage mocks
    mockS3Operations.uploadText.mockResolvedValue("test-s3-key");
    mockS3Operations.uploadBuffer.mockResolvedValue("test-pdf-s3-key");
    mockS3Operations.getTextContent.mockResolvedValue("Test content");
    mockS3Operations.generatePresignedUrl.mockResolvedValue(
      "https://test-presigned-url.com"
    );

    // Database mocks
    mockStoryAccess.create.mockResolvedValue();
    mockStoryAccess.getByUserId.mockResolvedValue([
      TestDataFactory.createStory(testUserId, testStoryId),
    ]);
    mockStoryAccess.getById.mockResolvedValue(
      TestDataFactory.createStory(testUserId, testStoryId)
    );

    mockEpisodeAccess.create.mockResolvedValue();
    mockEpisodeAccess.updatePdfReference.mockResolvedValue();
    mockEpisodeAccess.getByStoryId.mockResolvedValue([
      TestDataFactory.createEpisode(testStoryId, 1),
    ]);
    mockEpisodeAccess.getById.mockResolvedValue(
      TestDataFactory.createEpisode(testStoryId, 1)
    );
  }

  describe("Complete User Journey", () => {
    it("should handle full manga generation workflow from preferences to PDF", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Step 1: Submit preferences
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );

      const preferencesResult = await preferencesHandler(
        preferencesEvent,
        mockContext
      );
      expect(preferencesResult.statusCode).toBe(200);

      const preferencesResponse = JSON.parse(preferencesResult.body);
      expect(preferencesResponse.success).toBe(true);
      expect(preferencesResponse.data.requestId).toBeDefined();

      // Step 2: Check initial status
      const statusEvent = APIGatewayEventFactory.createEvent(
        "GET",
        `/status/${testRequestId}`,
        null,
        testUserId
      );
      statusEvent.pathParameters = { requestId: testRequestId };

      const statusResult = await statusHandler(statusEvent, mockContext);
      expect(statusResult.statusCode).toBe(200);

      // Step 3: Simulate story generation event
      const storyGenerationEvent =
        EventBridgeEventFactory.createStoryGenerationEvent(
          testUserId,
          testRequestId
        );

      await storyGenerationHandler(storyGenerationEvent, mockContext);

      // Verify story generation
      expect(mockStoryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          title: "The Great Adventure",
          status: "COMPLETED",
        })
      );

      // Step 4: Simulate episode generation event
      const episodeGenerationEvent =
        EventBridgeEventFactory.createEpisodeGenerationEvent(
          testUserId,
          testStoryId
        );

      await episodeGenerationHandler(episodeGenerationEvent, mockContext);

      // Verify episode generation
      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: testStoryId,
          episodeNumber: 1,
          status: "COMPLETED",
        })
      );

      // Step 5: Simulate image generation event
      const imageGenerationEvent =
        EventBridgeEventFactory.createImageGenerationEvent(
          testUserId,
          testEpisodeId
        );

      await imageGenerationHandler(imageGenerationEvent, mockContext);

      // Verify PDF creation
      expect(mockS3Operations.uploadBuffer).toHaveBeenCalledWith(
        expect.stringContaining("episode.pdf"),
        Buffer.from("complete-manga-pdf-data"),
        "application/pdf"
      );

      // Step 6: Retrieve generated content
      const contentRetrievalEvent = APIGatewayEventFactory.createEvent(
        "GET",
        "/stories",
        null,
        testUserId
      );

      const contentResult = await contentRetrievalHandler(
        contentRetrievalEvent,
        mockContext
      );
      expect(contentResult.statusCode).toBe(200);

      const contentResponse = JSON.parse(contentResult.body);
      expect(contentResponse.success).toBe(true);
      expect(contentResponse.data.stories).toHaveLength(1);
      expect(contentResponse.data.stories[0].title).toBe(
        "Test Adventure Story"
      );

      // Verify complete workflow
      expect(mockUserPreferencesAccess.create).toHaveBeenCalled();
      expect(
        mockEventPublishingHelpers.publishStoryGeneration
      ).toHaveBeenCalled();
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).toHaveBeenCalled();
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).toHaveBeenCalled();
    });

    it("should handle workflow with multiple episodes", async () => {
      // Setup mocks for multiple episodes
      const mockStoryBedrockInstance = {
        generateStory: jest.fn().mockResolvedValue({
          title: "Multi-Episode Adventure",
          content: "A long story that will be split into multiple episodes...",
          metadata: {
            wordCount: 3000,
            estimatedEpisodes: 3,
          },
        }),
      };
      mockBedrockClient.mockImplementation(
        () => mockStoryBedrockInstance as any
      );

      const preferences = TestDataFactory.createUserPreferences();

      // Submit preferences
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );

      await preferencesHandler(preferencesEvent, mockContext);

      // Generate story
      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );
      await storyGenerationHandler(storyEvent, mockContext);

      // Verify multiple episode generation events would be published
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).toHaveBeenCalledTimes(1);

      // Generate first episode
      const episode1Event =
        EventBridgeEventFactory.createEpisodeGenerationEvent(
          testUserId,
          testStoryId
        );
      episode1Event.detail.episodeNumber = 1;
      await episodeGenerationHandler(episode1Event, mockContext);

      // Generate second episode
      const episode2Event =
        EventBridgeEventFactory.createEpisodeGenerationEvent(
          testUserId,
          testStoryId
        );
      episode2Event.detail.episodeNumber = 2;
      await episodeGenerationHandler(episode2Event, mockContext);

      // Verify both episodes were created
      expect(mockEpisodeAccess.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Handling in Workflow", () => {
    it("should handle story generation failure gracefully", async () => {
      const mockStoryBedrockInstance = {
        generateStory: jest
          .fn()
          .mockRejectedValue(new Error("Bedrock API unavailable")),
      };
      mockBedrockClient.mockImplementation(
        () => mockStoryBedrockInstance as any
      );

      const preferences = TestDataFactory.createUserPreferences();

      // Submit preferences (should succeed)
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );

      const preferencesResult = await preferencesHandler(
        preferencesEvent,
        mockContext
      );
      expect(preferencesResult.statusCode).toBe(200);

      // Story generation should fail
      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );

      await expect(
        storyGenerationHandler(storyEvent, mockContext)
      ).rejects.toThrow("Bedrock API unavailable");

      // Verify request status updated to failed
      expect(mockGenerationRequestAccess.updateStatus).toHaveBeenCalledWith(
        testUserId,
        testRequestId,
        "FAILED",
        expect.objectContaining({
          errorMessage: expect.stringContaining("story generation"),
        })
      );

      // Verify no episode generation event published
      expect(
        mockEventPublishingHelpers.publishEpisodeGeneration
      ).not.toHaveBeenCalled();
    });

    it("should handle episode generation failure without affecting story", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Successful story generation
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );
      await preferencesHandler(preferencesEvent, mockContext);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );
      await storyGenerationHandler(storyEvent, mockContext);

      // Failed episode generation
      const mockEpisodeBedrockInstance = {
        generateEpisode: jest
          .fn()
          .mockRejectedValue(new Error("Episode generation failed")),
      };
      mockEpisodeBedrockClient.mockImplementation(
        () => mockEpisodeBedrockInstance as any
      );

      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(
        testUserId,
        testStoryId
      );

      await expect(
        episodeGenerationHandler(episodeEvent, mockContext)
      ).rejects.toThrow("Episode generation failed");

      // Verify story was still created
      expect(mockStoryAccess.create).toHaveBeenCalled();

      // Verify episode was not created
      expect(mockEpisodeAccess.create).not.toHaveBeenCalled();

      // Verify no image generation event published
      expect(
        mockEventPublishingHelpers.publishImageGeneration
      ).not.toHaveBeenCalled();
    });

    it("should handle image generation failure without affecting episode", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Successful story and episode generation
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );
      await preferencesHandler(preferencesEvent, mockContext);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );
      await storyGenerationHandler(storyEvent, mockContext);

      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(
        testUserId,
        testStoryId
      );
      await episodeGenerationHandler(episodeEvent, mockContext);

      // Failed image generation
      const mockImageBedrockInstance = {
        generateImages: jest
          .fn()
          .mockRejectedValue(new Error("Image generation failed")),
      };
      mockImageBedrockClient.mockImplementation(
        () => mockImageBedrockInstance as any
      );

      const imageEvent = EventBridgeEventFactory.createImageGenerationEvent(
        testUserId,
        testEpisodeId
      );

      await expect(
        imageGenerationHandler(imageEvent, mockContext)
      ).rejects.toThrow("Image generation failed");

      // Verify story and episode were still created
      expect(mockStoryAccess.create).toHaveBeenCalled();
      expect(mockEpisodeAccess.create).toHaveBeenCalled();

      // Verify no PDF was uploaded
      expect(mockS3Operations.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  describe("Performance Requirements", () => {
    it("should complete preferences processing within 5 seconds", async () => {
      const preferences = TestDataFactory.createUserPreferences();
      const event = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );

      const { result, duration } =
        await PerformanceTestUtils.measureExecutionTime(() =>
          preferencesHandler(event, mockContext)
        );

      expect(result.statusCode).toBe(200);
      expect(duration).toBeLessThan(5000);
    });

    it("should complete story generation within 2 minutes", async () => {
      const event = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );

      const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
        storyGenerationHandler(event, mockContext)
      );

      expect(duration).toBeLessThan(120000); // 2 minutes
    });

    it("should complete episode generation within 1 minute", async () => {
      const event = EventBridgeEventFactory.createEpisodeGenerationEvent(
        testUserId,
        testStoryId
      );

      const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
        episodeGenerationHandler(event, mockContext)
      );

      expect(duration).toBeLessThan(60000); // 1 minute
    });

    it("should complete image generation within 3 minutes", async () => {
      const event = EventBridgeEventFactory.createImageGenerationEvent(
        testUserId,
        testEpisodeId
      );

      const { duration } = await PerformanceTestUtils.measureExecutionTime(() =>
        imageGenerationHandler(event, mockContext)
      );

      expect(duration).toBeLessThan(180000); // 3 minutes
    });
  });

  describe("Data Consistency", () => {
    it("should maintain data consistency across all services", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Complete workflow
      const preferencesEvent = APIGatewayEventFactory.createEvent(
        "POST",
        "/preferences",
        JSON.stringify(preferences),
        testUserId
      );
      await preferencesHandler(preferencesEvent, mockContext);

      const storyEvent = EventBridgeEventFactory.createStoryGenerationEvent(
        testUserId,
        testRequestId
      );
      await storyGenerationHandler(storyEvent, mockContext);

      const episodeEvent = EventBridgeEventFactory.createEpisodeGenerationEvent(
        testUserId,
        testStoryId
      );
      await episodeGenerationHandler(episodeEvent, mockContext);

      const imageEvent = EventBridgeEventFactory.createImageGenerationEvent(
        testUserId,
        testEpisodeId
      );
      await imageGenerationHandler(imageEvent, mockContext);

      // Verify data consistency
      expect(mockUserPreferencesAccess.create).toHaveBeenCalledWith(
        testUserId,
        expect.objectContaining({
          preferences,
        })
      );

      expect(mockStoryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
        })
      );

      expect(mockEpisodeAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: testStoryId,
        })
      );

      // Verify S3 uploads maintain proper folder structure
      const s3Calls = mockS3Operations.uploadText.mock.calls;
      expect(
        s3Calls.some((call) => call[0].includes(`stories/${testUserId}/`))
      ).toBe(true);
      expect(
        s3Calls.some((call) => call[0].includes(`episodes/${testUserId}/`))
      ).toBe(true);
    });

    it("should handle concurrent requests without data corruption", async () => {
      const preferences = TestDataFactory.createUserPreferences();

      // Simulate concurrent preferences submissions
      const concurrentRequests = Array(5)
        .fill(null)
        .map((_, index) => {
          const event = APIGatewayEventFactory.createEvent(
            "POST",
            "/preferences",
            JSON.stringify(preferences),
            `${testUserId}-${index}`
          );
          return preferencesHandler(event, mockContext);
        });

      const results = await Promise.all(concurrentRequests);

      // Verify all requests succeeded
      results.forEach((result) => {
        expect(result.statusCode).toBe(200);
      });

      // Verify each request created separate database entries
      expect(mockUserPreferencesAccess.create).toHaveBeenCalledTimes(5);
      expect(mockGenerationRequestAccess.create).toHaveBeenCalledTimes(5);
    });
  });

  describe("User Experience", () => {
    it("should provide meaningful status updates throughout workflow", async () => {
      // Mock different status states
      const statusStates = [
        { status: "PENDING", progress: 0 },
        { status: "PROCESSING", progress: 25, currentStep: "STORY_GENERATION" },
        {
          status: "PROCESSING",
          progress: 50,
          currentStep: "EPISODE_GENERATION",
        },
        { status: "PROCESSING", progress: 75, currentStep: "IMAGE_GENERATION" },
        {
          status: "COMPLETED",
          progress: 100,
          result: { storyId: testStoryId },
        },
      ];

      for (const state of statusStates) {
        mockGenerationRequestAccess.getByRequestId.mockResolvedValueOnce({
          PK: `USER#${testUserId}`,
          SK: `REQUEST#${testRequestId}`,
          GSI1PK: `REQUEST#${testRequestId}`,
          GSI1SK: "STATUS",
          GSI2PK: `STATUS#${state.status}`,
          GSI2SK: "2024-01-01T00:00:00.000Z",
          requestId: testRequestId,
          userId: testUserId,
          type: "STORY",
          ...state,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        });

        const statusEvent = APIGatewayEventFactory.createEvent(
          "GET",
          `/status/${testRequestId}`,
          null,
          testUserId
        );
        statusEvent.pathParameters = { requestId: testRequestId };

        const result = await statusHandler(statusEvent, mockContext);
        expect(result.statusCode).toBe(200);

        const response = JSON.parse(result.body);
        expect(response.data.status).toBe(state.status);
        if (state.progress !== undefined) {
          expect(response.data.progress).toBe(state.progress);
        }
      }
    });

    it("should provide downloadable content after completion", async () => {
      // Mock completed story with episodes
      mockStoryAccess.getByUserId.mockResolvedValue([
        TestDataFactory.createStory(testUserId, testStoryId),
      ]);

      mockEpisodeAccess.getByStoryId.mockResolvedValue([
        TestDataFactory.createEpisode(testStoryId, 1),
      ]);

      const contentEvent = APIGatewayEventFactory.createEvent(
        "GET",
        "/stories",
        null,
        testUserId
      );

      const result = await contentRetrievalHandler(contentEvent, mockContext);
      expect(result.statusCode).toBe(200);

      const response = JSON.parse(result.body);
      expect(response.data.stories).toHaveLength(1);
      expect(response.data.stories[0]).toHaveProperty("downloadUrl");
    });
  });
});
