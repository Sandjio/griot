import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { ErrorLogger } from "./error-handler";
import {
  StoryGenerationEvent,
  EpisodeGenerationEvent,
  ImageGenerationEvent,
  GenerationStatusEvent,
  UserRegistrationEvent,
  ContinueEpisodeEvent,
  BatchWorkflowStatusEvent,
  BatchStoryCompletionEvent,
  EpisodeContinuationStatusEvent,
  MangaPlatformEvent,
  EventSchemaValidator,
} from "../types/event-schemas";

export class EventPublisher {
  private eventBridgeClient: EventBridgeClient;
  private eventBusName: string;

  constructor(eventBusName?: string) {
    this.eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    // Fallback to environment-specific bus name if EVENT_BUS_NAME is not set
    const environment = process.env.ENVIRONMENT || "dev";
    const fallbackBusName = `manga-platform-events-${environment}`;
    this.eventBusName =
      eventBusName || process.env.EVENT_BUS_NAME || fallbackBusName;

    console.log(`EventPublisher initialized with bus: "${this.eventBusName}"`);
  }

  /**
   * Publish a story generation event
   */
  async publishStoryGenerationEvent(
    eventDetail: StoryGenerationEvent["detail"]
  ): Promise<void> {
    const event: StoryGenerationEvent = {
      source: "manga.preferences",
      "detail-type": "Story Generation Requested",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish an episode generation event
   */
  async publishEpisodeGenerationEvent(
    eventDetail: EpisodeGenerationEvent["detail"]
  ): Promise<void> {
    const event: EpisodeGenerationEvent = {
      source: "manga.story",
      "detail-type": "Episode Generation Requested",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish an image generation event
   */
  async publishImageGenerationEvent(
    eventDetail: ImageGenerationEvent["detail"]
  ): Promise<void> {
    const event: ImageGenerationEvent = {
      source: "manga.episode",
      "detail-type": "Image Generation Requested",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish a generation status update event
   */
  async publishGenerationStatusEvent(
    eventDetail: GenerationStatusEvent["detail"]
  ): Promise<void> {
    const event: GenerationStatusEvent = {
      source: "manga.generation",
      "detail-type": "Generation Status Updated",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish a user registration event
   */
  async publishUserRegistrationEvent(
    eventDetail: UserRegistrationEvent["detail"]
  ): Promise<void> {
    const event: UserRegistrationEvent = {
      source: "manga.auth",
      "detail-type": "User Registered",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Generic method to publish any manga platform event with validation
   */
  async publishEvent(event: MangaPlatformEvent): Promise<void> {
    try {
      // Validate event schema before publishing
      const validation = EventSchemaValidator.validateEvent(event);
      if (!validation.isValid) {
        throw new Error(
          `Event validation failed: ${validation.errors.join(', ')}`
        );
      }

      // Log the event bus name for debugging
      console.log(
        `Publishing event to EventBridge bus: "${this.eventBusName}"`,
        {
          source: event.source,
          detailType: event["detail-type"],
          eventBusName: this.eventBusName,
          hasEventBusName: !!this.eventBusName,
        }
      );

      const command = new PutEventsCommand({
        Entries: [
          {
            Source: event.source,
            DetailType: event["detail-type"],
            Detail: JSON.stringify(event.detail),
            EventBusName: this.eventBusName,
            Time: new Date(),
          },
        ],
      });

      const response = await this.eventBridgeClient.send(command);

      // Check for failed entries
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntries = response.Entries?.filter(
          (entry) => entry.ErrorCode
        );
        throw new Error(
          `Failed to publish event: ${JSON.stringify(failedEntries)}`
        );
      }

      console.log(`Successfully published event: ${event["detail-type"]}`, {
        source: event.source,
        detailType: event["detail-type"],
        eventId: response.Entries?.[0]?.EventId,
      });
    } catch (error) {
      console.error("Error publishing event:", error);
      throw new Error(`Failed to publish event: ${error}`);
    }
  }

  /**
   * Publish batch workflow status event
   */
  async publishBatchWorkflowStatusEvent(
    eventDetail: BatchWorkflowStatusEvent["detail"]
  ): Promise<void> {
    const event: BatchWorkflowStatusEvent = {
      source: "manga.workflow",
      "detail-type": "Batch Workflow Status Updated",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish batch story completion event
   */
  async publishBatchStoryCompletionEvent(
    eventDetail: BatchStoryCompletionEvent["detail"]
  ): Promise<void> {
    const event: BatchStoryCompletionEvent = {
      source: "manga.workflow",
      "detail-type": "Batch Story Completed",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish episode continuation status event
   */
  async publishEpisodeContinuationStatusEvent(
    eventDetail: EpisodeContinuationStatusEvent["detail"]
  ): Promise<void> {
    const event: EpisodeContinuationStatusEvent = {
      source: "manga.episode",
      "detail-type": "Episode Continuation Status Updated",
      detail: {
        ...eventDetail,
        timestamp: eventDetail.timestamp || new Date().toISOString(),
      },
    };

    await this.publishEvent(event);
  }

  /**
   * Publish multiple events in a batch with validation
   */
  async publishEvents(events: MangaPlatformEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    if (events.length > 10) {
      throw new Error("Cannot publish more than 10 events in a single batch");
    }

    // Validate all events before publishing
    const validationErrors: string[] = [];
    events.forEach((event, index) => {
      const validation = EventSchemaValidator.validateEvent(event);
      if (!validation.isValid) {
        validationErrors.push(
          `Event ${index}: ${validation.errors.join(', ')}`
        );
      }
    });

    if (validationErrors.length > 0) {
      throw new Error(
        `Batch event validation failed: ${validationErrors.join('; ')}`
      );
    }

    try {
      const entries = events.map((event) => ({
        Source: event.source,
        DetailType: event["detail-type"],
        Detail: JSON.stringify(event.detail),
        EventBusName: this.eventBusName,
        Time: new Date(),
      }));

      const command = new PutEventsCommand({
        Entries: entries,
      });

      const response = await this.eventBridgeClient.send(command);

      // Check for failed entries
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failedEntries = response.Entries?.filter(
          (entry) => entry.ErrorCode
        );
        throw new Error(
          `Failed to publish ${
            response.FailedEntryCount
          } events: ${JSON.stringify(failedEntries)}`
        );
      }

      console.log(`Successfully published ${events.length} events`, {
        eventTypes: events.map((e) => e["detail-type"]),
        eventIds: response.Entries?.map((e) => e.EventId),
      });
    } catch (error) {
      console.error("Error publishing events:", error);
      throw new Error(`Failed to publish events: ${error}`);
    }
  }
}

/**
 * Singleton instance for easy access
 */
export const eventPublisher = new EventPublisher();

/**
 * Event publishing utilities for new workflow types
 */
export class WorkflowEventPublisher {
  private eventPublisher: EventPublisher;

  constructor(eventPublisher?: EventPublisher) {
    this.eventPublisher = eventPublisher || new EventPublisher();
  }

  /**
   * Publish workflow start event with validation
   */
  async publishWorkflowStart(
    userId: string,
    workflowId: string,
    requestId: string,
    numberOfStories: number
  ): Promise<void> {
    await EventPublishingHelpers.publishBatchWorkflowStatus(
      userId,
      workflowId,
      requestId,
      "STARTED",
      0,
      numberOfStories,
      0,
      0
    );
  }

  /**
   * Publish workflow progress update
   */
  async publishWorkflowProgress(
    userId: string,
    workflowId: string,
    requestId: string,
    currentBatch: number,
    totalBatches: number,
    completedStories: number,
    failedStories: number
  ): Promise<void> {
    await EventPublishingHelpers.publishBatchWorkflowStatus(
      userId,
      workflowId,
      requestId,
      "IN_PROGRESS",
      currentBatch,
      totalBatches,
      completedStories,
      failedStories
    );
  }

  /**
   * Publish workflow completion
   */
  async publishWorkflowCompletion(
    userId: string,
    workflowId: string,
    requestId: string,
    totalBatches: number,
    completedStories: number,
    failedStories: number
  ): Promise<void> {
    await EventPublishingHelpers.publishBatchWorkflowStatus(
      userId,
      workflowId,
      requestId,
      "COMPLETED",
      totalBatches,
      totalBatches,
      completedStories,
      failedStories
    );
  }

  /**
   * Publish episode continuation request
   */
  async publishEpisodeContinuationRequest(
    userId: string,
    storyId: string,
    episodeId: string,
    episodeNumber: number
  ): Promise<void> {
    await EventPublishingHelpers.publishEpisodeContinuationStatus(
      userId,
      storyId,
      episodeId,
      episodeNumber,
      "REQUESTED"
    );
  }
}

/**
 * Singleton workflow event publisher
 */
export const workflowEventPublisher = new WorkflowEventPublisher();

/**
 * Helper functions for common event publishing patterns
 */
export const EventPublishingHelpers = {
  /**
   * Publish story generation event with error handling
   */
  async publishStoryGeneration(
    userId: string,
    requestId: string,
    preferences: any,
    insights: any
  ): Promise<void> {
    try {
      await eventPublisher.publishStoryGenerationEvent({
        userId,
        requestId,
        preferences,
        insights,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish story generation event:", error);
      // Re-throw to allow caller to handle
      throw error;
    }
  },

  /**
   * Publish episode generation event with error handling
   */
  async publishEpisodeGeneration(
    userId: string,
    storyId: string,
    storyS3Key: string,
    episodeNumber: number
  ): Promise<void> {
    try {
      await eventPublisher.publishEpisodeGenerationEvent({
        userId,
        storyId,
        storyS3Key,
        episodeNumber,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish episode generation event:", error);
      throw error;
    }
  },

  /**
   * Publish image generation event with error handling
   */
  async publishImageGeneration(
    userId: string,
    episodeId: string,
    episodeS3Key: string
  ): Promise<void> {
    try {
      await eventPublisher.publishImageGenerationEvent({
        userId,
        episodeId,
        episodeS3Key,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish image generation event:", error);
      throw error;
    }
  },

  /**
   * Publish status update with error handling
   */
  async publishStatusUpdate(
    userId: string,
    requestId: string,
    type: "STORY" | "EPISODE" | "IMAGE",
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
    entityId?: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      await eventPublisher.publishGenerationStatusEvent({
        userId,
        requestId,
        type,
        status,
        entityId,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish status update event:", error);
      throw error;
    }
  },

  /**
   * Publish continue episode event with error handling
   */
  async publishContinueEpisode(
    userId: string,
    storyId: string,
    nextEpisodeNumber: number,
    originalPreferences: any,
    storyS3Key: string
  ): Promise<void> {
    try {
      await eventPublisher.publishEvent({
        source: "manga.story",
        "detail-type": "Continue Episode Requested",
        detail: {
          userId,
          storyId,
          nextEpisodeNumber,
          originalPreferences,
          storyS3Key,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to publish continue episode event:", error);
      throw error;
    }
  },

  /**
   * Publish batch story generation event with error handling
   */
  async publishBatchStoryGeneration(
    userId: string,
    workflowId: string,
    requestId: string,
    numberOfStories: number,
    currentBatch: number,
    totalBatches: number,
    preferences: any,
    insights: any
  ): Promise<void> {
    try {
      await eventPublisher.publishEvent({
        source: "manga.workflow",
        "detail-type": "Batch Story Generation Requested",
        detail: {
          userId,
          workflowId,
          requestId,
          numberOfStories,
          currentBatch,
          totalBatches,
          preferences,
          insights,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to publish batch story generation event:", error);
      throw error;
    }
  },

  /**
   * Publish batch workflow status update with error handling
   */
  async publishBatchWorkflowStatus(
    userId: string,
    workflowId: string,
    requestId: string,
    status: "STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED",
    currentBatch: number,
    totalBatches: number,
    completedStories: number,
    failedStories: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      await eventPublisher.publishBatchWorkflowStatusEvent({
        userId,
        workflowId,
        requestId,
        status,
        currentBatch,
        totalBatches,
        completedStories,
        failedStories,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish batch workflow status event:", error);
      throw error;
    }
  },

  /**
   * Publish batch story completion with error handling
   */
  async publishBatchStoryCompletion(
    userId: string,
    workflowId: string,
    storyId: string,
    batchNumber: number,
    totalBatches: number,
    isLastStory: boolean
  ): Promise<void> {
    try {
      await eventPublisher.publishBatchStoryCompletionEvent({
        userId,
        workflowId,
        storyId,
        batchNumber,
        totalBatches,
        isLastStory,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish batch story completion event:", error);
      throw error;
    }
  },

  /**
   * Publish episode continuation status with error handling
   */
  async publishEpisodeContinuationStatus(
    userId: string,
    storyId: string,
    episodeId: string,
    episodeNumber: number,
    status: "REQUESTED" | "GENERATING" | "COMPLETED" | "FAILED",
    errorMessage?: string
  ): Promise<void> {
    try {
      await eventPublisher.publishEpisodeContinuationStatusEvent({
        userId,
        storyId,
        episodeId,
        episodeNumber,
        status,
        errorMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Failed to publish episode continuation status event:", error);
      throw error;
    }
  },
};
