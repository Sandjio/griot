import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  StoryGenerationEvent,
  EpisodeGenerationEvent,
  ImageGenerationEvent,
  GenerationStatusEvent,
  UserRegistrationEvent,
  MangaPlatformEvent,
} from "../types/event-schemas";

export class EventPublisher {
  private eventBridgeClient: EventBridgeClient;
  private eventBusName: string;

  constructor(eventBusName?: string) {
    this.eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.eventBusName = eventBusName || process.env.EVENT_BUS_NAME || "";
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
   * Generic method to publish any manga platform event
   */
  async publishEvent(event: MangaPlatformEvent): Promise<void> {
    try {
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
   * Publish multiple events in a batch
   */
  async publishEvents(events: MangaPlatformEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    if (events.length > 10) {
      throw new Error("Cannot publish more than 10 events in a single batch");
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
};
