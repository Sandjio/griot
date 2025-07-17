import {
  InputValidator,
  validateApiGatewayEvent,
  PREFERENCES_VALIDATION_RULES,
  QUERY_PARAM_VALIDATION_RULES,
  PATH_PARAM_VALIDATION_RULES,
  RateLimiter,
  SECURITY_HEADERS,
  sanitizeHtml,
  sanitizeSql,
} from "../input-validation";
import { APIGatewayProxyEvent } from "aws-lambda";

describe("InputValidator", () => {
  describe("validate", () => {
    it("should validate required fields", () => {
      const data = {};
      const rules = [
        {
          field: "name",
          required: true,
          type: "string" as const,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("name is required");
    });

    it("should validate string types and lengths", () => {
      const data = { name: "ab" };
      const rules = [
        {
          field: "name",
          required: true,
          type: "string" as const,
          minLength: 3,
          maxLength: 10,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "name must be at least 3 characters long"
      );
    });

    it("should validate allowed values", () => {
      const data = { status: "INVALID" };
      const rules = [
        {
          field: "status",
          required: true,
          type: "string" as const,
          allowedValues: ["PENDING", "COMPLETED"],
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "status must be one of: PENDING, COMPLETED"
      );
    });

    it("should sanitize string values", () => {
      const data = { name: "  <script>alert('xss')</script>  " };
      const rules = [
        {
          field: "name",
          required: true,
          type: "string" as const,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(true);
      expect(result.sanitizedData?.name).toBe("scriptalert('xss')/script");
    });

    it("should validate arrays", () => {
      const data = { tags: ["tag1"] };
      const rules = [
        {
          field: "tags",
          required: true,
          type: "array" as const,
          minLength: 2,
          maxLength: 5,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("tags must have at least 2 items");
    });

    it("should validate numbers", () => {
      const data = { age: 15 };
      const rules = [
        {
          field: "age",
          required: true,
          type: "number" as const,
          min: 18,
          max: 65,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("age must be at least 18");
    });

    it("should use custom validators", () => {
      const data = { email: "invalid-email" };
      const rules = [
        {
          field: "email",
          required: true,
          type: "string" as const,
          customValidator: (value: string) => value.includes("@"),
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("email failed custom validation");
    });

    it("should validate successfully with valid data", () => {
      const data = {
        name: "John Doe",
        age: 25,
        tags: ["tag1", "tag2"],
      };
      const rules = [
        {
          field: "name",
          required: true,
          type: "string" as const,
          minLength: 2,
          maxLength: 50,
        },
        {
          field: "age",
          required: true,
          type: "number" as const,
          min: 18,
          max: 100,
        },
        {
          field: "tags",
          required: true,
          type: "array" as const,
          minLength: 1,
          maxLength: 10,
        },
      ];

      const result = InputValidator.validate(data, rules);

      expect(result.isValid).toBe(true);
      expect(result.sanitizedData).toEqual({
        name: "John Doe",
        age: 25,
        tags: ["tag1", "tag2"],
      });
    });
  });
});

describe("validateApiGatewayEvent", () => {
  const createMockEvent = (
    overrides: Partial<APIGatewayProxyEvent> = {}
  ): APIGatewayProxyEvent => ({
    httpMethod: "GET",
    path: "/test",
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/json",
    },
    queryStringParameters: null,
    pathParameters: null,
    body: null,
    isBase64Encoded: false,
    resource: "/test",
    requestContext: {} as any,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    ...overrides,
  });

  it("should validate valid GET request", () => {
    const event = createMockEvent();
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject invalid HTTP methods", () => {
    const event = createMockEvent({ httpMethod: "INVALID" });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("HTTP method INVALID is not allowed");
  });

  it("should require User-Agent header", () => {
    const event = createMockEvent({
      headers: {
        "Content-Type": "application/json",
      },
    });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("User-Agent header is required");
  });

  it("should validate Content-Type for POST requests", () => {
    const event = createMockEvent({
      httpMethod: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "text/plain",
      },
    });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Content-Type must be application/json for POST/PUT requests"
    );
  });

  it("should detect suspicious content in headers", () => {
    const event = createMockEvent({
      headers: {
        "User-Agent": "Mozilla/5.0",
        "x-forwarded-for": "<script>alert('xss')</script>",
      },
    });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Suspicious content detected in x-forwarded-for header"
    );
  });

  it("should detect suspicious content in query parameters", () => {
    const event = createMockEvent({
      queryStringParameters: {
        search: "'; DROP TABLE users; --",
      },
    });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Suspicious content detected in query parameter search"
    );
  });

  it("should detect suspicious content in path parameters", () => {
    const event = createMockEvent({
      pathParameters: {
        id: "../../../etc/passwd",
      },
    });
    const result = validateApiGatewayEvent(event);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "Suspicious content detected in path parameter id"
    );
  });
});

describe("PREFERENCES_VALIDATION_RULES", () => {
  it("should validate preferences successfully", () => {
    const preferences = {
      genres: ["Action", "Adventure"],
      themes: ["Friendship", "Adventure"],
      artStyle: "Modern",
      targetAudience: "Young Adults",
      contentRating: "PG-13",
    };

    const result = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData).toEqual(preferences);
  });

  it("should reject invalid genres", () => {
    const preferences = {
      genres: ["InvalidGenre"],
      themes: ["Friendship"],
      artStyle: "Modern",
      targetAudience: "Young Adults",
      contentRating: "PG-13",
    };

    const result = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("genres failed custom validation");
  });

  it("should reject invalid art style", () => {
    const preferences = {
      genres: ["Action"],
      themes: ["Friendship"],
      artStyle: "InvalidStyle",
      targetAudience: "Young Adults",
      contentRating: "PG-13",
    };

    const result = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "artStyle must be one of: Traditional, Modern, Minimalist, Detailed, Cartoon, Realistic, Chibi, Dark, Colorful, Black and White"
    );
  });

  it("should sanitize themes", () => {
    const preferences = {
      genres: ["Action"],
      themes: ["  <script>Friendship</script>  "],
      artStyle: "Modern",
      targetAudience: "Young Adults",
      contentRating: "PG-13",
    };

    const result = InputValidator.validate(
      preferences,
      PREFERENCES_VALIDATION_RULES
    );

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.themes).toEqual(["Friendship"]);
  });
});

describe("QUERY_PARAM_VALIDATION_RULES", () => {
  it("should validate limit parameter", () => {
    const params = { limit: "50" };
    const result = InputValidator.validate(params, [
      QUERY_PARAM_VALIDATION_RULES.limit,
    ]);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.limit).toBe("50");
  });

  it("should cap limit at maximum", () => {
    const params = { limit: "200" };
    const result = InputValidator.validate(params, [
      QUERY_PARAM_VALIDATION_RULES.limit,
    ]);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.limit).toBe("100");
  });

  it("should validate status parameter", () => {
    const params = { status: "completed" };
    const result = InputValidator.validate(params, [
      QUERY_PARAM_VALIDATION_RULES.status,
    ]);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.status).toBe("COMPLETED");
  });
});

describe("PATH_PARAM_VALIDATION_RULES", () => {
  it("should validate UUID format", () => {
    const params = { storyId: "123e4567-e89b-12d3-a456-426614174000" };
    const result = InputValidator.validate(params, [
      PATH_PARAM_VALIDATION_RULES.storyId,
    ]);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.storyId).toBe(
      "123e4567-e89b-12d3-a456-426614174000"
    );
  });

  it("should reject invalid UUID format", () => {
    const params = { storyId: "invalid-uuid" };
    const result = InputValidator.validate(params, [
      PATH_PARAM_VALIDATION_RULES.storyId,
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("storyId format is invalid");
  });

  it("should sanitize UUID case", () => {
    const params = { storyId: "123E4567-E89B-12D3-A456-426614174000" };
    const result = InputValidator.validate(params, [
      PATH_PARAM_VALIDATION_RULES.storyId,
    ]);

    expect(result.isValid).toBe(true);
    expect(result.sanitizedData?.storyId).toBe(
      "123e4567-e89b-12d3-a456-426614174000"
    );
  });
});

describe("RateLimiter", () => {
  beforeEach(() => {
    // Clear rate limiter state
    (RateLimiter as any).requests.clear();
  });

  it("should allow requests within limits", () => {
    const identifier = "user123";

    expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(true);
    expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(true);
    expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(true);
  });

  it("should reject requests exceeding limits", () => {
    const identifier = "user123";

    // Use up the limit
    for (let i = 0; i < 5; i++) {
      expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(true);
    }

    // Next request should be rejected
    expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(false);
  });

  it("should reset limits after window expires", () => {
    const identifier = "user123";

    // Use up the limit with a short window
    for (let i = 0; i < 3; i++) {
      expect(RateLimiter.isAllowed(identifier, 3, 100)).toBe(true);
    }

    // Should be rejected
    expect(RateLimiter.isAllowed(identifier, 3, 100)).toBe(false);

    // Wait for window to expire
    return new Promise((resolve) => {
      setTimeout(() => {
        // Should be allowed again
        expect(RateLimiter.isAllowed(identifier, 3, 100)).toBe(true);
        resolve(undefined);
      }, 150);
    });
  });

  it("should handle different identifiers separately", () => {
    expect(RateLimiter.isAllowed("user1", 2, 60000)).toBe(true);
    expect(RateLimiter.isAllowed("user2", 2, 60000)).toBe(true);
    expect(RateLimiter.isAllowed("user1", 2, 60000)).toBe(true);
    expect(RateLimiter.isAllowed("user2", 2, 60000)).toBe(true);

    // Both should be at limit now
    expect(RateLimiter.isAllowed("user1", 2, 60000)).toBe(false);
    expect(RateLimiter.isAllowed("user2", 2, 60000)).toBe(false);
  });

  it("should cleanup expired records", () => {
    const identifier = "user123";

    // Create a record with short window
    RateLimiter.isAllowed(identifier, 5, 100);

    // Wait for expiration
    return new Promise((resolve) => {
      setTimeout(() => {
        RateLimiter.cleanup();

        // Should be able to make requests again
        expect(RateLimiter.isAllowed(identifier, 5, 60000)).toBe(true);
        resolve(undefined);
      }, 150);
    });
  });
});

describe("sanitizeHtml", () => {
  it("should escape HTML characters", () => {
    const input = '<script>alert("xss")</script>';
    const result = sanitizeHtml(input);

    expect(result).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;"
    );
  });

  it("should handle empty strings", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("should handle non-string input", () => {
    expect(sanitizeHtml(null as any)).toBe("");
    expect(sanitizeHtml(undefined as any)).toBe("");
    expect(sanitizeHtml(123 as any)).toBe("");
  });
});

describe("sanitizeSql", () => {
  it("should escape SQL injection attempts", () => {
    const input = "'; DROP TABLE users; --";
    const result = sanitizeSql(input);

    expect(result).toBe("'' DROP TABLE users ");
    expect(result).not.toContain("--");
    expect(result).not.toContain(";");
  });

  it("should remove dangerous SQL keywords", () => {
    const input = "SELECT * FROM users WHERE xp_cmdshell('dir')";
    const result = sanitizeSql(input);

    expect(result).not.toContain("xp_");
  });

  it("should handle empty strings", () => {
    expect(sanitizeSql("")).toBe("");
  });

  it("should handle non-string input", () => {
    expect(sanitizeSql(null as any)).toBe("");
    expect(sanitizeSql(undefined as any)).toBe("");
    expect(sanitizeSql(123 as any)).toBe("");
  });
});

describe("SECURITY_HEADERS", () => {
  it("should include all required security headers", () => {
    expect(SECURITY_HEADERS).toHaveProperty(
      "X-Content-Type-Options",
      "nosniff"
    );
    expect(SECURITY_HEADERS).toHaveProperty("X-Frame-Options", "DENY");
    expect(SECURITY_HEADERS).toHaveProperty(
      "X-XSS-Protection",
      "1; mode=block"
    );
    expect(SECURITY_HEADERS).toHaveProperty(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
    expect(SECURITY_HEADERS).toHaveProperty(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none';"
    );
    expect(SECURITY_HEADERS).toHaveProperty(
      "Referrer-Policy",
      "strict-origin-when-cross-origin"
    );
    expect(SECURITY_HEADERS).toHaveProperty(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=()"
    );
  });
});
