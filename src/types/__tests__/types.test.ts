/**
 * Basic tests to verify type definitions work correctly
 */

import { describe, it, expect } from "@jest/globals";
import {
  UserProfile,
  Story,
  Episode,
  GenerationRequest,
  UserPreferencesData,
  QlooInsights,
} from "../data-models";

describe("Data Model Types", () => {
  it("should create a valid UserProfile", () => {
    const testUserProfile: UserProfile = {
      PK: "USER#123",
      SK: "PROFILE",
      GSI1PK: "USER#123",
      GSI1SK: "PROFILE",
      email: "test@example.com",
      status: "ACTIVE",
      createdAt: "2024-01-01T00:00:00.000Z",
    };

    expect(testUserProfile.email).toBe("test@example.com");
    expect(testUserProfile.status).toBe("ACTIVE");
  });

  it("should create a valid Story", () => {
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

    expect(testStory.storyId).toBe("456");
    expect(testStory.status).toBe("COMPLETED");
    expect(testStory.title).toBe("Test Story");
  });

  it("should create valid UserPreferencesData", () => {
    const testPreferences: UserPreferencesData = {
      genres: ["action", "adventure"],
      themes: ["friendship", "courage"],
      artStyle: "manga",
      targetAudience: "teen",
      contentRating: "PG-13",
    };

    expect(testPreferences.genres).toContain("action");
    expect(testPreferences.artStyle).toBe("manga");
  });

  it("should create valid QlooInsights", () => {
    const testInsights: QlooInsights = {
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
    };

    expect(testInsights.recommendations).toHaveLength(1);
    expect(testInsights.trends[0].topic).toBe("superhero");
  });
});
