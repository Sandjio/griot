# Griot API Documentation

This document provides comprehensive documentation for the Griot API endpoints.

## Table of Contents

- [Authentication](#authentication)
- [Preferences API](#preferences-api)
- [Error Handling](#error-handling)
- [Response Formats](#response-formats)

## Authentication

All API endpoints require authentication using AWS Cognito User Pools. Include the JWT token in the Authorization header:

```
Authorization: Bearer <jwt-token>
```

### Authentication Errors

- **401 Unauthorized**: Invalid or missing JWT token
- **403 Forbidden**: Valid token but insufficient permissions

## Preferences API

The Preferences API allows users to store and retrieve their manga preferences.

### Base URL

```
https://api.griot.example.com/preferences
```

### Endpoints

#### POST /preferences

Store user preferences and get personalized insights.

**Request:**

```http
POST /preferences
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "genres": ["Action", "Adventure", "Fantasy"],
  "themes": ["Friendship", "Good vs Evil", "Coming of Age"],
  "artStyle": "Traditional",
  "targetAudience": "Young Adults",
  "contentRating": "PG-13"
}
```

**Request Body Schema:**

| Field            | Type          | Required | Description                         | Valid Values                                                                                                                                                                                                                               |
| ---------------- | ------------- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `genres`         | array[string] | Yes      | User's preferred genres (1-5 items) | "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller", "Historical", "Psychological", "Mecha", "Isekai", "School Life", "Military", "Music" |
| `themes`         | array[string] | Yes      | User's preferred themes (1-5 items) | "Friendship", "Love", "Betrayal", "Revenge", "Coming of Age", "Good vs Evil", "Sacrifice", "Redemption", "Power", "Family", "Honor", "Justice", "Freedom", "Survival", "Identity", "Destiny", "War", "Peace", "Magic", "Technology"        |
| `artStyle`       | string        | Yes      | Preferred art style                 | "Traditional", "Modern", "Minimalist", "Detailed", "Cartoon", "Realistic", "Chibi", "Dark", "Colorful", "Black and White"                                                                                                                  |
| `targetAudience` | string        | Yes      | Target audience                     | "Children", "Teens", "Young Adults", "Adults", "All Ages"                                                                                                                                                                                  |
| `contentRating`  | string        | Yes      | Content rating preference           | "G", "PG", "PG-13", "R", "NC-17"                                                                                                                                                                                                           |

**Success Response (200 OK):**

```json
{
  "success": true,
  "data": {
    "message": "Preferences saved successfully",
    "preferences": {
      "genres": ["Action", "Adventure", "Fantasy"],
      "themes": ["Friendship", "Good vs Evil", "Coming of Age"],
      "artStyle": "Traditional",
      "targetAudience": "Young Adults",
      "contentRating": "PG-13"
    },
    "insights": {
      "recommendations": [
        {
          "category": "genre",
          "score": 0.9,
          "attributes": {
            "popularity": "high",
            "trending": true
          }
        }
      ],
      "trends": [
        {
          "topic": "Isekai Adventures",
          "popularity": 0.95
        }
      ]
    }
  },
  "requestId": "abc123-def456-ghi789",
  "timestamp": "2023-01-01T12:00:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Invalid request body or validation errors
- **401 Unauthorized**: Missing or invalid authentication
- **500 Internal Server Error**: Server error during processing

#### GET /preferences

Retrieve user's stored preferences and insights.

**Request:**

```http
GET /preferences
Authorization: Bearer <jwt-token>
```

**Success Response (200 OK) - With Preferences:**

```json
{
  "success": true,
  "data": {
    "preferences": {
      "genres": ["Action", "Adventure", "Fantasy"],
      "themes": ["Friendship", "Good vs Evil", "Coming of Age"],
      "artStyle": "Traditional",
      "targetAudience": "Young Adults",
      "contentRating": "PG-13"
    },
    "insights": {
      "recommendations": [
        {
          "category": "genre",
          "score": 0.9,
          "attributes": {
            "popularity": "high",
            "trending": true
          }
        }
      ],
      "trends": [
        {
          "topic": "Isekai Adventures",
          "popularity": 0.95
        }
      ]
    },
    "lastUpdated": "2023-01-01T12:00:00.000Z"
  },
  "requestId": "abc123-def456-ghi789",
  "timestamp": "2023-01-01T12:30:00.000Z"
}
```

**Success Response (200 OK) - No Preferences:**

```json
{
  "success": true,
  "data": {
    "preferences": null,
    "message": "No preferences found for user"
  },
  "requestId": "abc123-def456-ghi789",
  "timestamp": "2023-01-01T12:30:00.000Z"
}
```

**Error Responses:**

- **401 Unauthorized**: Missing or invalid authentication
- **500 Internal Server Error**: Server error during retrieval

## Error Handling

All error responses follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "requestId": "abc123-def456-ghi789",
    "timestamp": "2023-01-01T12:00:00.000Z"
  }
}
```

### Error Codes

| Code                          | HTTP Status | Description                    |
| ----------------------------- | ----------- | ------------------------------ |
| `UNAUTHORIZED`                | 401         | User not authenticated         |
| `VALIDATION_ERROR`            | 400         | Request validation failed      |
| `INVALID_JSON`                | 400         | Invalid JSON in request body   |
| `INVALID_REQUEST`             | 400         | Request body is required       |
| `QLOO_API_ERROR`              | 500         | External service error         |
| `PREFERENCES_RETRIEVAL_ERROR` | 500         | Failed to retrieve preferences |
| `PREFERENCES_STORAGE_ERROR`   | 500         | Failed to save preferences     |
| `METHOD_NOT_ALLOWED`          | 405         | HTTP method not supported      |
| `RATE_LIMIT_EXCEEDED`         | 429         | Too many requests              |
| `INTERNAL_ERROR`              | 500         | Unexpected server error        |

### Rate Limiting

The API implements rate limiting to prevent abuse:

- **Limit**: 10 requests per minute per user
- **Response**: 429 Too Many Requests with `Retry-After` header

## Response Formats

### Success Response Structure

All successful responses include:

- `success`: Always `true` for successful responses
- `data`: The response payload
- `requestId`: Unique identifier for the request
- `timestamp`: ISO 8601 timestamp of the response

### Error Response Structure

All error responses include:

- `error.code`: Machine-readable error code
- `error.message`: Human-readable error message
- `error.requestId`: Unique identifier for the request (optional)
- `error.timestamp`: ISO 8601 timestamp of the error

### CORS Headers

All responses include appropriate CORS headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
```

### Security Headers

All responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
```

## Examples

### Complete User Flow

1. **Submit Preferences:**

```bash
curl -X POST https://api.griot.example.com/preferences \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "genres": ["Action", "Fantasy"],
    "themes": ["Friendship", "Good vs Evil"],
    "artStyle": "Traditional",
    "targetAudience": "Young Adults",
    "contentRating": "PG-13"
  }'
```

2. **Retrieve Preferences:**

```bash
curl -X GET https://api.griot.example.com/preferences \
  -H "Authorization: Bearer <jwt-token>"
```

### Error Handling Example

```javascript
async function submitPreferences(preferences) {
  try {
    const response = await fetch("/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(preferences),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${error.error.code}: ${error.error.message}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to submit preferences:", error.message);
    throw error;
  }
}
```

## Changelog

### Version 2.0 (Current)

- **Added**: GET /preferences endpoint for retrieving user preferences
- **Changed**: POST /preferences no longer triggers manga generation workflows
- **Improved**: Enhanced error handling and response consistency
- **Security**: Added comprehensive input validation and sanitization

### Version 1.0

- **Added**: POST /preferences endpoint for submitting user preferences
- **Added**: Integration with Qloo API for personalized insights
- **Added**: EventBridge integration for workflow triggering (deprecated in v2.0)

## Support

For API support and questions:

1. Check the error response for specific error codes and messages
2. Verify authentication tokens are valid and not expired
3. Ensure request payloads match the documented schemas
4. Contact the development team with specific error details and request IDs
