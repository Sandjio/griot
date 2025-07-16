/**
 * Validation Utilities for API Request Validation
 * These utilities provide runtime validation for API requests and data
 */

import { ValidationSchema, ValidationRule } from "./api-types";
import { ValidationError, ErrorUtils } from "./error-types";

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    value: any;
    constraint: string;
  }>;
}

export class ValidationUtils {
  /**
   * Validates an object against a validation schema
   */
  static validate(data: any, schema: ValidationSchema): ValidationResult {
    const errors: Array<{ field: string; value: any; constraint: string }> = [];

    for (const [field, rule] of Object.entries(schema)) {
      const value = data[field];
      const fieldErrors = this.validateField(field, value, rule);
      errors.push(...fieldErrors);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates a single field against a validation rule
   */
  private static validateField(
    field: string,
    value: any,
    rule: ValidationRule
  ): Array<{ field: string; value: any; constraint: string }> {
    const errors: Array<{ field: string; value: any; constraint: string }> = [];

    // Required validation
    if (
      rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      errors.push({
        field,
        value,
        constraint: `${field} is required`,
      });
      return errors; // Skip other validations if required field is missing
    }

    // Skip other validations if field is not provided and not required
    if (value === undefined || value === null) {
      return errors;
    }

    // String length validations
    if (typeof value === "string") {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push({
          field,
          value,
          constraint: `${field} must be at least ${rule.minLength} characters long`,
        });
      }

      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push({
          field,
          value,
          constraint: `${field} must be no more than ${rule.maxLength} characters long`,
        });
      }

      // Pattern validation
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push({
          field,
          value,
          constraint: `${field} format is invalid`,
        });
      }
    }

    // Allowed values validation
    if (rule.allowedValues && !rule.allowedValues.includes(value)) {
      errors.push({
        field,
        value,
        constraint: `${field} must be one of: ${rule.allowedValues.join(", ")}`,
      });
    }

    // Custom validation
    if (rule.customValidator) {
      const result = rule.customValidator(value);
      if (result !== true) {
        errors.push({
          field,
          value,
          constraint:
            typeof result === "string" ? result : `${field} is invalid`,
        });
      }
    }

    return errors;
  }

  /**
   * Creates a validation error from validation results
   */
  static createValidationError(
    validationResult: ValidationResult,
    requestId?: string
  ): ValidationError {
    return ErrorUtils.createValidationError(
      "Request validation failed",
      validationResult.errors,
      requestId
    );
  }

  /**
   * Validates and throws if validation fails
   */
  static validateAndThrow(
    data: any,
    schema: ValidationSchema,
    requestId?: string
  ): void {
    const result = this.validate(data, schema);
    if (!result.isValid) {
      throw this.createValidationError(result, requestId);
    }
  }

  /**
   * Sanitizes input data by removing unknown fields
   */
  static sanitizeInput<T>(data: any, allowedFields: (keyof T)[]): Partial<T> {
    const sanitized: Partial<T> = {};

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        sanitized[field] = data[field];
      }
    }

    return sanitized;
  }

  /**
   * Validates email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates UUID format
   */
  static isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Validates ISO 8601 date format
   */
  static isValidISODate(date: string): boolean {
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (!isoDateRegex.test(date)) return false;

    const parsedDate = new Date(date);
    return !isNaN(parsedDate.getTime());
  }

  /**
   * Validates pagination parameters
   */
  static validatePaginationParams(
    limit?: number,
    nextToken?: string
  ): ValidationResult {
    const errors: Array<{ field: string; value: any; constraint: string }> = [];

    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        errors.push({
          field: "limit",
          value: limit,
          constraint: "Limit must be an integer between 1 and 100",
        });
      }
    }

    if (nextToken !== undefined && typeof nextToken !== "string") {
      errors.push({
        field: "nextToken",
        value: nextToken,
        constraint: "Next token must be a string",
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Common validation patterns
export const ValidationPatterns = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ISO_DATE: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
};

// Predefined validation rules
export const CommonValidationRules = {
  email: {
    required: true,
    pattern: ValidationPatterns.EMAIL,
    maxLength: 254,
  },
  uuid: {
    required: true,
    pattern: ValidationPatterns.UUID,
  },
  title: {
    required: true,
    minLength: 1,
    maxLength: 200,
  },
  description: {
    maxLength: 1000,
  },
  slug: {
    pattern: ValidationPatterns.SLUG,
    minLength: 1,
    maxLength: 50,
  },
};
