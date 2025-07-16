import { QlooApiClient, QlooApiError, MockQlooApiClient } from "../qloo-client";
import { UserPreferencesData } from "../../../types/data-models";

// Mock fetch globally
global.fetch = jest.fn();
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe("QlooApiClient", () => {
  const validPreferences: UserPreferencesData = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Good vs Evil"],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  };

  const mockSuccessResponse = {
    recommendations: [
      {
        category: "Action",
        score: 0.9,
        attributes: { intensity: "high" },
      },
      {
        category: "Adventure",
        score: 0.8,
        attributes: { setting: "fantasy" },
      },
    ],
    trends: [
      {
        topic: "Isekai Adventures",
        popularity: 0.95,
      },
      {
        topic: "School Life",
        popularity: 0.85,
      },
    ],
    status: "success",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set environment variables
    process.env.QLOO_API_URL = "https://api.qloo.com/v1/insights";
    process.env.QLOO_API_KEY = "test-api-key";
    process.env.QLOO_API_TIMEOUT = "5000";
  });

  afterEach(() => {
    delete process.env.QLOO_API_URL;
    delete process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_TIMEOUT;
  });

  describe("Constructor", () => {
    it("should initialize with environment variables", () => {
      const client = new QlooApiClient();
      expect(client).toBeInstanceOf(QlooApiClient);
    });

    it("should throw error when API URL is missing", () => {
      delete process.env.QLOO_API_URL;

      expect(() => new QlooApiClient()).toThrow(
        "Qloo API configuration is missing. Please set QLOO_API_URL and QLOO_API_KEY environment variables."
      );
    });

    it("should throw error when API key is missing", () => {
      delete process.env.QLOO_API_KEY;

      expect(() => new QlooApiClient()).toThrow(
        "Qloo API configuration is missing. Please set QLOO_API_URL and QLOO_API_KEY environment variables."
      );
    });
  });

  describe("fetchInsights", () => {
    let client: QlooApiClient;

    beforeEach(() => {
      client = new QlooApiClient();
    });

    it("should successfully fetch insights", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSuccessResponse,
      } as Response);

      const result = await client.fetchInsights(validPreferences);

      expect(result).toEqual({
        recommendations: [
          {
            category: "Action",
            score: 0.9,
            attributes: { intensity: "high" },
          },
          {
            category: "Adventure",
            score: 0.8,
            attributes: { setting: "fantasy" },
          },
        ],
        trends: [
          {
            topic: "Isekai Adventures",
            popularity: 0.95,
          },
          {
            topic: "School Life",
            popularity: 0.85,
          },
        ],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.qloo.com/v1/insights",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
            "User-Agent": "MangaPlatform/1.0",
          },
          body: JSON.stringify({
            user_preferences: {
              genres: ["Action", "Adventure"],
              themes: ["Friendship", "Good vs Evil"],
              art_style: "Modern",
              target_audience: "Young Adults",
              content_rating: "PG-13",
            },
            request_type: "manga_insights",
            include_recommendations: true,
            include_trends: true,
            max_recommendations: 10,
            max_trends: 5,
          }),
          signal: expect.any(AbortSignal),
        }
      );
    });

    it("should handle API error responses", async () => {
      const errorResponse = {
        status: "error",
        message: "Invalid preferences",
        recommendations: [],
        trends: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => errorResponse,
      } as Response);

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );
    });

    it("should handle HTTP error responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      } as Response);

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );
    });

    it.skip("should handle timeout errors", async () => {
      // Mock a timeout by returning a promise that resolves after the timeout
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => mockSuccessResponse,
                } as Response),
              200
            )
          )
      );

      // Set a very short timeout for testing
      process.env.QLOO_API_TIMEOUT = "100";
      const shortTimeoutClient = new QlooApiClient();

      await expect(
        shortTimeoutClient.fetchInsights(validPreferences)
      ).rejects.toThrow(QlooApiError);
    });

    it("should validate response structure", async () => {
      const invalidResponse = {
        status: "success",
        // Missing recommendations and trends
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidResponse,
      } as Response);

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );
    });

    it("should sanitize invalid recommendation data", async () => {
      const responseWithInvalidData = {
        status: "success",
        recommendations: [
          {
            category: "Action",
            score: 0.9,
            attributes: { intensity: "high" },
          },
          {
            // Missing category
            score: "invalid", // Invalid score type
            attributes: null,
          },
        ],
        trends: [
          {
            topic: "Isekai Adventures",
            popularity: 0.95,
          },
          {
            // Missing topic
            popularity: "invalid", // Invalid popularity type
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseWithInvalidData,
      } as Response);

      const result = await client.fetchInsights(validPreferences);

      expect(result.recommendations).toEqual([
        {
          category: "Action",
          score: 0.9,
          attributes: { intensity: "high" },
        },
        {
          category: "unknown",
          score: 0,
          attributes: {},
        },
      ]);

      expect(result.trends).toEqual([
        {
          topic: "Isekai Adventures",
          popularity: 0.95,
        },
        {
          topic: "unknown",
          popularity: 0,
        },
      ]);
    });
  });

  describe("Retry Logic", () => {
    let client: QlooApiClient;

    beforeEach(() => {
      client = new QlooApiClient();
    });

    it("should retry on server errors", async () => {
      // First two calls fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSuccessResponse,
        } as Response);

      const result = await client.fetchInsights(validPreferences);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should retry on rate limiting", async () => {
      // First call fails with 429, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Too Many Requests",
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockSuccessResponse,
        } as Response);

      const result = await client.fetchInsights(validPreferences);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry on client errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Bad Request",
      } as Response);

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should fail after max retries", async () => {
      // All calls fail with 500
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      await expect(client.fetchInsights(validPreferences)).rejects.toThrow(
        QlooApiError
      );

      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial call + 3 retries
    });
  });
});

describe("MockQlooApiClient", () => {
  const validPreferences: UserPreferencesData = {
    genres: ["Action", "Adventure"],
    themes: ["Friendship", "Good vs Evil"],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  };

  it("should return mock insights", async () => {
    const mockClient = new MockQlooApiClient();
    const result = await mockClient.fetchInsights(validPreferences);

    expect(result).toMatchObject({
      recommendations: expect.arrayContaining([
        expect.objectContaining({
          category: expect.any(String),
          score: expect.any(Number),
          attributes: expect.any(Object),
        }),
      ]),
      trends: expect.arrayContaining([
        expect.objectContaining({
          topic: expect.any(String),
          popularity: expect.any(Number),
        }),
      ]),
    });
  });

  it("should include user preferences in mock attributes", async () => {
    const mockClient = new MockQlooApiClient();
    const result = await mockClient.fetchInsights(validPreferences);

    // Check that some recommendations include user preference data
    const hasThemes = result.recommendations.some(
      (rec) => rec.attributes.themes === validPreferences.themes
    );
    const hasArtStyle = result.recommendations.some(
      (rec) => rec.attributes.art_style === validPreferences.artStyle
    );
    const hasTargetAudience = result.recommendations.some(
      (rec) =>
        rec.attributes.target_audience === validPreferences.targetAudience
    );
    const hasContentRating = result.recommendations.some(
      (rec) => rec.attributes.content_rating === validPreferences.contentRating
    );

    expect(
      hasThemes || hasArtStyle || hasTargetAudience || hasContentRating
    ).toBe(true);
  });

  it("should simulate API delay", async () => {
    const mockClient = new MockQlooApiClient();
    const startTime = Date.now();

    await mockClient.fetchInsights(validPreferences);

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should take at least 500ms due to simulated delay
    expect(duration).toBeGreaterThanOrEqual(500);
  });
});
