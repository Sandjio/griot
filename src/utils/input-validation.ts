import { APIGatewayProxyEvent } from "aws-lambda";

/**
 * Input validation and sanitization utilities for API endpoints
 *
 * Requirements: 6.6 - Add input validation and sanitization for all API endpoints
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedData?: any;
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "array" | "object";
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  allowedValues?: any[];
  customValidator?: (value: any) => boolean;
  sanitizer?: (value: any) => any;
}

/**
 * Generic input validator and sanitizer
 */
export class InputValidator {
  /**
   * Validate and sanitize input data based on rules
   */
  static validate(data: any, rules: ValidationRule[]): ValidationResult {
    const errors: string[] = [];
    const sanitizedData: any = {};

    for (const rule of rules) {
      const value = data[rule.field];

      // Check required fields
      if (
        rule.required &&
        (value === undefined || value === null || value === "")
      ) {
        errors.push(`${rule.field} is required`);
        continue;
      }

      // Skip validation for optional empty fields
      if (
        !rule.required &&
        (value === undefined || value === null || value === "")
      ) {
        continue;
      }

      // Sanitize the value first
      let sanitizedValue = value;
      if (rule.sanitizer) {
        sanitizedValue = rule.sanitizer(value);
      } else {
        sanitizedValue = this.defaultSanitize(value, rule.type);
      }

      // Type validation (use sanitized value)
      if (rule.type && !this.validateType(sanitizedValue, rule.type)) {
        errors.push(`${rule.field} must be of type ${rule.type}`);
        continue;
      }

      // String validations (use sanitized value)
      if (rule.type === "string" && typeof sanitizedValue === "string") {
        if (rule.minLength && sanitizedValue.length < rule.minLength) {
          errors.push(
            `${rule.field} must be at least ${rule.minLength} characters long`
          );
          continue;
        }
        if (rule.maxLength && sanitizedValue.length > rule.maxLength) {
          errors.push(
            `${rule.field} must be no more than ${rule.maxLength} characters long`
          );
          continue;
        }
        if (rule.pattern && !rule.pattern.test(sanitizedValue)) {
          errors.push(`${rule.field} format is invalid`);
          continue;
        }
      }

      // Number validations (use sanitized value)
      if (rule.type === "number" && typeof sanitizedValue === "number") {
        if (rule.min !== undefined && sanitizedValue < rule.min) {
          errors.push(`${rule.field} must be at least ${rule.min}`);
          continue;
        }
        if (rule.max !== undefined && sanitizedValue > rule.max) {
          errors.push(`${rule.field} must be no more than ${rule.max}`);
          continue;
        }
      }

      // Array validations (use sanitized value)
      if (rule.type === "array" && Array.isArray(sanitizedValue)) {
        if (rule.minLength && sanitizedValue.length < rule.minLength) {
          errors.push(
            `${rule.field} must have at least ${rule.minLength} items`
          );
          continue;
        }
        if (rule.maxLength && sanitizedValue.length > rule.maxLength) {
          errors.push(
            `${rule.field} must have no more than ${rule.maxLength} items`
          );
          continue;
        }
      }

      // Allowed values validation (use sanitized value)
      if (rule.allowedValues && !rule.allowedValues.includes(sanitizedValue)) {
        errors.push(
          `${rule.field} must be one of: ${rule.allowedValues.join(", ")}`
        );
        continue;
      }

      // Custom validation (use sanitized value)
      if (rule.customValidator && !rule.customValidator(sanitizedValue)) {
        errors.push(`${rule.field} failed custom validation`);
        continue;
      }

      sanitizedData[rule.field] = sanitizedValue;
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedData: errors.length === 0 ? sanitizedData : undefined,
    };
  }

  /**
   * Validate type of value
   */
  private static validateType(value: any, type: string): boolean {
    switch (type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      default:
        return true;
    }
  }

  /**
   * Default sanitization based on type
   */
  private static defaultSanitize(value: any, type?: string): any {
    if (type === "string" && typeof value === "string") {
      // Remove potentially dangerous characters and trim
      return value
        .replace(/[<>]/g, "") // Remove angle brackets
        .replace(/javascript:/gi, "") // Remove javascript: protocol
        .replace(/on\w+=/gi, "") // Remove event handlers
        .trim();
    }

    if (type === "array" && Array.isArray(value)) {
      // Sanitize each item in the array
      return value.map((item) =>
        typeof item === "string" ? this.defaultSanitize(item, "string") : item
      );
    }

    return value;
  }
}

/**
 * Sanitize HTML content to prevent XSS attacks
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Sanitize SQL input to prevent SQL injection
 */
export function sanitizeSql(input: string): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(/'/g, "''")
    .replace(/;/g, "")
    .replace(/--/g, "")
    .replace(/\/\*/g, "")
    .replace(/\*\//g, "")
    .replace(/xp_/gi, "")
    .replace(/sp_/gi, "");
}

/**
 * Validate and sanitize API Gateway event
 */
export function validateApiGatewayEvent(
  event: APIGatewayProxyEvent
): ValidationResult {
  const errors: string[] = [];

  // Validate HTTP method
  const allowedMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
  if (!allowedMethods.includes(event.httpMethod)) {
    errors.push(`HTTP method ${event.httpMethod} is not allowed`);
  }

  // Validate headers
  if (event.headers) {
    // Check for required headers
    const contentType =
      event.headers["Content-Type"] || event.headers["content-type"];
    if (event.httpMethod === "POST" || event.httpMethod === "PUT") {
      if (!contentType || !contentType.includes("application/json")) {
        errors.push(
          "Content-Type must be application/json for POST/PUT requests"
        );
      }
    }

    // Validate User-Agent header exists (basic bot protection)
    const userAgent =
      event.headers["User-Agent"] ||
      event.headers["user-agent"] ||
      event.requestContext?.identity?.userAgent;
    if (!userAgent) {
      errors.push("User-Agent header is required");
    }

    // Check for suspicious headers
    const suspiciousHeaders = ["x-forwarded-for", "x-real-ip"];
    for (const header of suspiciousHeaders) {
      const value = event.headers[header];
      if (value && containsSuspiciousContent(value)) {
        errors.push(`Suspicious content detected in ${header} header`);
      }
    }
  }

  // Validate query parameters
  if (event.queryStringParameters) {
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value && containsSuspiciousContent(value)) {
        errors.push(`Suspicious content detected in query parameter ${key}`);
      }
    }
  }

  // Validate path parameters
  if (event.pathParameters) {
    for (const [key, value] of Object.entries(event.pathParameters)) {
      if (value && containsSuspiciousContent(value)) {
        errors.push(`Suspicious content detected in path parameter ${key}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check for suspicious content that might indicate an attack
 */
function containsSuspiciousContent(value: string): boolean {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /union\s+select/i,
    /drop\s+table/i,
    /insert\s+into/i,
    /delete\s+from/i,
    /update\s+set/i,
    /exec\s*\(/i,
    /eval\s*\(/i,
    /\.\.\/\.\.\//,
    /\/etc\/passwd/,
    /\/proc\/self\/environ/,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(value));
}

/**
 * Preferences validation rules
 */
export const PREFERENCES_VALIDATION_RULES: ValidationRule[] = [
  {
    field: "genres",
    required: true,
    type: "array",
    minLength: 1,
    maxLength: 10,
    customValidator: (value: string[]) => {
      const allowedGenres = [
        "Action",
        "Adventure",
        "Comedy",
        "Drama",
        "Fantasy",
        "Horror",
        "Mystery",
        "Romance",
        "Sci-Fi",
        "Slice of Life",
        "Sports",
        "Thriller",
      ];
      return value.every((genre) => allowedGenres.includes(genre));
    },
    sanitizer: (value: string[]) =>
      value.map((genre) => sanitizeHtml(genre.trim())),
  },
  {
    field: "themes",
    required: true,
    type: "array",
    minLength: 1,
    maxLength: 10,
    sanitizer: (value: string[]) =>
      value.map((theme) => theme.replace(/<[^>]*>/g, "").trim()),
  },
  {
    field: "artStyle",
    required: true,
    type: "string",
    allowedValues: [
      "Traditional",
      "Modern",
      "Minimalist",
      "Detailed",
      "Cartoon",
      "Realistic",
      "Chibi",
      "Dark",
      "Colorful",
      "Black and White",
    ],
    sanitizer: (value: string) => sanitizeHtml(value.trim()),
  },
  {
    field: "targetAudience",
    required: true,
    type: "string",
    allowedValues: ["Children", "Teens", "Young Adults", "Adults", "All Ages"],
    sanitizer: (value: string) => sanitizeHtml(value.trim()),
  },
  {
    field: "contentRating",
    required: true,
    type: "string",
    allowedValues: ["G", "PG", "PG-13", "R"],
    sanitizer: (value: string) => sanitizeHtml(value.trim()),
  },
];

/**
 * Query parameter validation rules
 */
export const QUERY_PARAM_VALIDATION_RULES: { [key: string]: ValidationRule } = {
  limit: {
    field: "limit",
    type: "string",
    sanitizer: (value: string) => {
      const numValue = Math.min(Math.max(parseInt(value, 10) || 10, 1), 100);
      return numValue.toString();
    },
  },
  offset: {
    field: "offset",
    type: "string",
    sanitizer: (value: string) => {
      const numValue = Math.max(parseInt(value, 10) || 0, 0);
      return numValue.toString();
    },
  },
  status: {
    field: "status",
    type: "string",
    allowedValues: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
    sanitizer: (value: string) => value.trim().toUpperCase(),
  },
};

/**
 * Path parameter validation rules
 */
export const PATH_PARAM_VALIDATION_RULES: { [key: string]: ValidationRule } = {
  storyId: {
    field: "storyId",
    required: true,
    type: "string",
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    sanitizer: (value: string) => value.trim().toLowerCase(),
  },
  episodeId: {
    field: "episodeId",
    required: true,
    type: "string",
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    sanitizer: (value: string) => value.trim().toLowerCase(),
  },
  requestId: {
    field: "requestId",
    required: true,
    type: "string",
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    sanitizer: (value: string) => value.trim().toLowerCase(),
  },
};

/**
 * Rate limiting helper
 */
export class RateLimiter {
  private static requests: Map<string, { count: number; resetTime: number }> =
    new Map();

  /**
   * Check if request is within rate limits
   */
  static isAllowed(
    identifier: string,
    maxRequests: number = 100,
    windowMs: number = 60000
  ): boolean {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetTime) {
      // Reset or create new record
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + windowMs,
      });
      return true;
    }

    if (record.count >= maxRequests) {
      return false;
    }

    record.count++;
    return true;
  }

  /**
   * Clean up expired records
   */
  static cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

/**
 * Security headers for API responses
 */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
