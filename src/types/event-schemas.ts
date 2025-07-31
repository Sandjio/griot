/**
 * EventBridge Event Schemas for Manga Generation Platform
 * These interfaces define the structure of events published to EventBridge
 * 
 * Supports batch workflow processing and episode continuation workflows
 * with comprehensive validation and error handling.
 */

import { UserPreferencesData, QlooInsights } from "./data-models";

// Base Event Interface
export interface BaseEvent {
  source: string;
  "detail-type": string;
  detail: Record<string, any>;
  time?: string;
  region?: string;
  account?: string;
}

// Story Generation Event
export interface StoryGenerationEvent extends BaseEvent {
  source: "manga.preferences";
  "detail-type": "Story Generation Requested";
  detail: {
    userId: string;
    requestId: string;
    preferences: UserPreferencesData;
    insights: QlooInsights;
    timestamp: string;
  };
}

// Episode Generation Event
export interface EpisodeGenerationEvent extends BaseEvent {
  source: "manga.story";
  "detail-type": "Episode Generation Requested";
  detail: {
    userId: string;
    storyId: string;
    storyS3Key: string;
    episodeNumber: number;
    timestamp: string;
  };
}

// Image Generation Event
export interface ImageGenerationEvent extends BaseEvent {
  source: "manga.episode";
  "detail-type": "Image Generation Requested";
  detail: {
    userId: string;
    episodeId: string;
    episodeS3Key: string;
    timestamp: string;
  };
}

// Generation Status Update Event
export interface GenerationStatusEvent extends BaseEvent {
  source: "manga.generation";
  "detail-type": "Generation Status Updated";
  detail: {
    userId: string;
    requestId: string;
    type: "STORY" | "EPISODE" | "IMAGE";
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
    entityId?: string; // storyId, episodeId, etc.
    errorMessage?: string;
    timestamp: string;
  };
}

// User Registration Event
export interface UserRegistrationEvent extends BaseEvent {
  source: "manga.auth";
  "detail-type": "User Registered";
  detail: {
    userId: string;
    email: string;
    timestamp: string;
  };
}

// Batch Workflow Event
export interface BatchWorkflowEvent extends BaseEvent {
  source: "manga.workflow";
  "detail-type": "Batch Story Generation Requested";
  detail: {
    userId: string;
    workflowId: string;
    requestId: string;
    numberOfStories: number;
    currentBatch: number;
    totalBatches: number;
    preferences: UserPreferencesData;
    insights: QlooInsights;
    timestamp: string;
  };
}

// Batch Workflow Status Event
export interface BatchWorkflowStatusEvent extends BaseEvent {
  source: "manga.workflow";
  "detail-type": "Batch Workflow Status Updated";
  detail: {
    userId: string;
    workflowId: string;
    requestId: string;
    status: "STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
    currentBatch: number;
    totalBatches: number;
    completedStories: number;
    failedStories: number;
    errorMessage?: string;
    timestamp: string;
  };
}

// Batch Story Completion Event
export interface BatchStoryCompletionEvent extends BaseEvent {
  source: "manga.workflow";
  "detail-type": "Batch Story Completed";
  detail: {
    userId: string;
    workflowId: string;
    storyId: string;
    batchNumber: number;
    totalBatches: number;
    isLastStory: boolean;
    timestamp: string;
  };
}

// Continue Episode Event
export interface ContinueEpisodeEvent extends BaseEvent {
  source: "manga.story";
  "detail-type": "Continue Episode Requested";
  detail: {
    userId: string;
    storyId: string;
    nextEpisodeNumber: number;
    originalPreferences: UserPreferencesData;
    storyS3Key: string;
    timestamp: string;
  };
}

// Episode Continuation Status Event
export interface EpisodeContinuationStatusEvent extends BaseEvent {
  source: "manga.episode";
  "detail-type": "Episode Continuation Status Updated";
  detail: {
    userId: string;
    storyId: string;
    episodeId: string;
    episodeNumber: number;
    status: "REQUESTED" | "GENERATING" | "COMPLETED" | "FAILED";
    errorMessage?: string;
    timestamp: string;
  };
}

// Event Type Union
export type MangaPlatformEvent =
  | StoryGenerationEvent
  | EpisodeGenerationEvent
  | ImageGenerationEvent
  | GenerationStatusEvent
  | UserRegistrationEvent
  | BatchWorkflowEvent
  | BatchWorkflowStatusEvent
  | BatchStoryCompletionEvent
  | ContinueEpisodeEvent
  | EpisodeContinuationStatusEvent;

// Event Detail Types for easier access
export type StoryGenerationEventDetail = StoryGenerationEvent["detail"];
export type EpisodeGenerationEventDetail = EpisodeGenerationEvent["detail"];
export type ImageGenerationEventDetail = ImageGenerationEvent["detail"];
export type GenerationStatusEventDetail = GenerationStatusEvent["detail"];
export type UserRegistrationEventDetail = UserRegistrationEvent["detail"];
export type BatchWorkflowEventDetail = BatchWorkflowEvent["detail"];
export type BatchWorkflowStatusEventDetail = BatchWorkflowStatusEvent["detail"];
export type BatchStoryCompletionEventDetail = BatchStoryCompletionEvent["detail"];
export type ContinueEpisodeEventDetail = ContinueEpisodeEvent["detail"];
export type EpisodeContinuationStatusEventDetail = EpisodeContinuationStatusEvent["detail"];

// Event Validation Schemas
export interface EventValidationResult {
  isValid: boolean;
  errors: string[];
}

// Event Schema Validators
export class EventSchemaValidator {
  /**
   * Validate batch workflow event detail
   */
  static validateBatchWorkflowEvent(detail: any): EventValidationResult {
    const errors: string[] = [];

    if (!detail.userId || typeof detail.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }
    if (!detail.workflowId || typeof detail.workflowId !== 'string') {
      errors.push('workflowId is required and must be a string');
    }
    if (!detail.requestId || typeof detail.requestId !== 'string') {
      errors.push('requestId is required and must be a string');
    }
    if (typeof detail.numberOfStories !== 'number' || detail.numberOfStories < 1 || detail.numberOfStories > 10) {
      errors.push('numberOfStories must be a number between 1 and 10');
    }
    if (typeof detail.currentBatch !== 'number' || detail.currentBatch < 1) {
      errors.push('currentBatch must be a positive number');
    }
    if (typeof detail.totalBatches !== 'number' || detail.totalBatches < 1) {
      errors.push('totalBatches must be a positive number');
    }
    if (!detail.preferences || typeof detail.preferences !== 'object') {
      errors.push('preferences is required and must be an object');
    }
    if (!detail.insights || typeof detail.insights !== 'object') {
      errors.push('insights is required and must be an object');
    }
    if (!detail.timestamp || typeof detail.timestamp !== 'string') {
      errors.push('timestamp is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate continue episode event detail
   */
  static validateContinueEpisodeEvent(detail: any): EventValidationResult {
    const errors: string[] = [];

    if (!detail.userId || typeof detail.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }
    if (!detail.storyId || typeof detail.storyId !== 'string') {
      errors.push('storyId is required and must be a string');
    }
    if (typeof detail.nextEpisodeNumber !== 'number' || detail.nextEpisodeNumber < 1) {
      errors.push('nextEpisodeNumber must be a positive number');
    }
    if (!detail.originalPreferences || typeof detail.originalPreferences !== 'object') {
      errors.push('originalPreferences is required and must be an object');
    }
    if (!detail.storyS3Key || typeof detail.storyS3Key !== 'string') {
      errors.push('storyS3Key is required and must be a string');
    }
    if (!detail.timestamp || typeof detail.timestamp !== 'string') {
      errors.push('timestamp is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate batch workflow status event detail
   */
  static validateBatchWorkflowStatusEvent(detail: any): EventValidationResult {
    const errors: string[] = [];
    const validStatuses = ['STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'];

    if (!detail.userId || typeof detail.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }
    if (!detail.workflowId || typeof detail.workflowId !== 'string') {
      errors.push('workflowId is required and must be a string');
    }
    if (!detail.requestId || typeof detail.requestId !== 'string') {
      errors.push('requestId is required and must be a string');
    }
    if (!detail.status || !validStatuses.includes(detail.status)) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}`);
    }
    if (typeof detail.currentBatch !== 'number' || detail.currentBatch < 0) {
      errors.push('currentBatch must be a non-negative number');
    }
    if (typeof detail.totalBatches !== 'number' || detail.totalBatches < 1) {
      errors.push('totalBatches must be a positive number');
    }
    if (typeof detail.completedStories !== 'number' || detail.completedStories < 0) {
      errors.push('completedStories must be a non-negative number');
    }
    if (typeof detail.failedStories !== 'number' || detail.failedStories < 0) {
      errors.push('failedStories must be a non-negative number');
    }
    if (!detail.timestamp || typeof detail.timestamp !== 'string') {
      errors.push('timestamp is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate episode continuation status event detail
   */
  static validateEpisodeContinuationStatusEvent(detail: any): EventValidationResult {
    const errors: string[] = [];
    const validStatuses = ['REQUESTED', 'GENERATING', 'COMPLETED', 'FAILED'];

    if (!detail.userId || typeof detail.userId !== 'string') {
      errors.push('userId is required and must be a string');
    }
    if (!detail.storyId || typeof detail.storyId !== 'string') {
      errors.push('storyId is required and must be a string');
    }
    if (!detail.episodeId || typeof detail.episodeId !== 'string') {
      errors.push('episodeId is required and must be a string');
    }
    if (typeof detail.episodeNumber !== 'number' || detail.episodeNumber < 1) {
      errors.push('episodeNumber must be a positive number');
    }
    if (!detail.status || !validStatuses.includes(detail.status)) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}`);
    }
    if (!detail.timestamp || typeof detail.timestamp !== 'string') {
      errors.push('timestamp is required and must be a string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generic event validation based on event type
   */
  static validateEvent(event: MangaPlatformEvent): EventValidationResult {
    switch (event['detail-type']) {
      case 'Batch Story Generation Requested':
        return this.validateBatchWorkflowEvent(event.detail);
      case 'Continue Episode Requested':
        return this.validateContinueEpisodeEvent(event.detail);
      case 'Batch Workflow Status Updated':
        return this.validateBatchWorkflowStatusEvent(event.detail);
      case 'Episode Continuation Status Updated':
        return this.validateEpisodeContinuationStatusEvent(event.detail);
      default:
        return { isValid: true, errors: [] }; // Skip validation for other event types
    }
  }
}
