/**
 * Basic tests to verify type definitions work correctly
 */

import {
  UserProfile,
  Story,
  Episode,
  GenerationRequest,
  UserPreferencesData,
  QlooInsights,
  StoryGenerationEvent,
  EpisodeGenerationEvent,
  ImageGenerationEvent,
  PreferencesRequest,
  StatusResponse,
  ValidationError,
  ErrorUtils,
  ValidationUtils,
  preferencesRequestSchema,
} from "../index";

// Test data model types
const testUserProfile: UserProfile = {
  PK: "USER#123",
  SK: "PROFILE",
  GSI1PK: "USER#123",
  GSI1SK: "PROFILE",
  email: "test@example.com",
  status: "ACTIVE",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const testStory: Story = {
  PK: "USER#123",
  SK: "STORY#456",
  GSI1PK: "STORY#456",
  GSI1SK: "METADATA",
  GSI2PK: "STATUS#COMPLETED",
  GSI2SK: "2024-01-01T00:00:00.000Z",
  storyId: "456",
  title: "Test Story",
  s3Key: "stories/123/456/story.md",
  status: "COMPLETED",
  userId: "123",
  createdAt: "2024-01-01T00:00:00.000Z",
};

// Test event types
const testStoryGenerationEvent: StoryGenerationEvent = {
  source: "manga.preferences",
  "detail-type": "Story Generation Requested",
  detail: {
    userId: "123",
    requestId: "req-123",
    preferences: {
      genres: ["action", "adventure"],
      themes: ["friendship", "courage"],
      artStyle: "manga",
      targetAudience: "teen",
      contentRating: "PG-13",
    },
    insights: {
      recommendations: [
        {
          category: "genre",
          score: 0.9,
          attributes: { popularity: "high" },
        },
      ],
      trends: [
        {
          topic: "superhero",
          popularity: 0.8,
        },
      ],
    },
    timestamp: "2024-01-01T00:00:00.000Z",
  },
};

// Test API types
const testPreferencesRequest: PreferencesRequest = {
  genres: ["action", "adventure"],
  themes: ["friendship"],
  artStyle: "manga",
  targetAudience: "teen",
  contentRating: "PG-13",
};

const testStatusResponse: StatusResponse = {
  requestId: "req-123",
  status: "PROCESSING",
  type: "STORY",
  progress: {
    currentStep: "Generating story content",
    totalSteps: 3,
    completedSteps: 1,
  },
  timestamp: "2024-01-01T00:00:00.000Z",
};

// Test error handling
const testValidationError: ValidationError = ErrorUtils.createValidationError(
  "Validation failed",
  [
    {
      field: "genres",
      value: [],
      constraint: "At least one genre is required",
    },
  ],
  "req-123"
);

// Test validation utilities
const validationResult = ValidationUtils.validate(
  testPreferencesRequest,
  preferencesRequestSchema
);

// Simple test function to verify types compile correctly
function testTypesCompilation(): boolean {
  // Test that all types can be used
  const profile: UserProfile = testUserProfile;
  const story: Story = testStory;
  const event: StoryGenerationEvent = testStoryGenerationEvent;
  const request: PreferencesRequest = testPreferencesRequest;
  const response: StatusResponse = testStatusResponse;
  const error: ValidationError = testValidationError;

  // Test validation
  const isValid = validationResult.isValid;

  // Test error utilities
  const httpStatus = ErrorUtils.getHttpStatusCode(error);
  const isRetryable = ErrorUtils.isRetryableError(error);

  return true;
}

export { testTypesCompilation };
