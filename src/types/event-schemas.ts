/**
 * EventBridge Event Schemas for Manga Generation Platform
 * These interfaces define the structure of events published to EventBridge
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

// Event Type Union
export type MangaPlatformEvent =
  | StoryGenerationEvent
  | EpisodeGenerationEvent
  | ImageGenerationEvent
  | GenerationStatusEvent
  | UserRegistrationEvent;

// Event Detail Types for easier access
export type StoryGenerationEventDetail = StoryGenerationEvent["detail"];
export type EpisodeGenerationEventDetail = EpisodeGenerationEvent["detail"];
export type ImageGenerationEventDetail = ImageGenerationEvent["detail"];
export type GenerationStatusEventDetail = GenerationStatusEvent["detail"];
export type UserRegistrationEventDetail = UserRegistrationEvent["detail"];
