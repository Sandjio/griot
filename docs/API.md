# Griot API Documentation

This document provides comprehensive documentation for the Griot API endpoints.

## Table of Contents

- [Authentication](#authentication)
- [Preferences API](#preferences-api)
- [Workflow API](#workflow-api)
- [Status API](#status-api)
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

## Workflow API

The Workflow API allows users to initiate batch manga generation workflows.

### Base URL

```
https://api.griot.example.com/workflow
```

### Endpoints

#### POST /workflow/start

Start a batch manga generation workflow that creates multiple stories sequentially.

**Prerequisites:**

- User must have submitted preferences via POST /preferences
- User must be authenticated with valid JWT token

**Request:**

```http
POST /workflow/start
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "numberOfStories": 3,
  "batchSize": 1
}
```

**Request Body Schema:**

| Field             | Type   | Required | Description                                   | Valid Values |
| ----------------- | ------ | -------- | --------------------------------------------- | ------------ |
| `numberOfStories` | number | Yes      | Number of stories to generate (1-10)          | 1-10         |
| `batchSize`       | number | No       | Stories per batch (default: 1 for sequential) | 1-5          |

**Success Response (202 Accepted):**

```json
{
  "workflowId": "wf-abc123-def456",
  "requestId": "req-789ghi-jkl012",
  "numberOfStories": 3,
  "status": "STARTED",
  "estimatedCompletionTime": "2023-01-01T12:09:00.000Z",
  "message": "Batch workflow started successfully",
  "timestamp": "2023-01-01T12:00:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Invalid request body, validation errors, or missing user preferences
- **401 Unauthorized**: Missing or invalid authentication
- **429 Too Many Requests**: Rate limit exceeded (5 requests per 5 minutes)
- **500 Internal Server Error**: Server error during workflow initiation

**Rate Limiting:**

- **Limit**: 5 workflow start requests per 5 minutes per user
- **Response**: 429 Too Many Requests with `Retry-After: 300` header

### Testing with Postman

#### Setup Authentication

1. **Get JWT Token**: First authenticate with Cognito User Pool to get a JWT token
2. **Set Authorization Header**: In Postman, go to Authorization tab and select "Bearer Token"
3. **Add Token**: Paste your JWT token in the Token field

#### Test Workflow Start

1. **Method**: POST
2. **URL**: `https://your-api-gateway-url/dev/workflow/start`
3. **Headers**:
   ```
   Content-Type: application/json
   Authorization: Bearer <your-jwt-token>
   ```
4. **Body** (raw JSON):
   ```json
   {
     "numberOfStories": 2,
     "batchSize": 1
   }
   ```

#### Expected Responses

**Success (202 Accepted):**

```json
{
  "workflowId": "wf-12345678-1234-1234-1234-123456789012",
  "requestId": "req-87654321-4321-4321-4321-210987654321",
  "numberOfStories": 2,
  "status": "STARTED",
  "estimatedCompletionTime": "2023-01-01T12:06:00.000Z",
  "message": "Batch workflow started successfully",
  "timestamp": "2023-01-01T12:00:00.000Z"
}
```

**Error - Missing Preferences (400 Bad Request):**

```json
{
  "error": {
    "code": "PREFERENCES_NOT_FOUND",
    "message": "User preferences not found. Please submit preferences before starting workflow.",
    "requestId": "req-error-123",
    "timestamp": "2023-01-01T12:00:00.000Z"
  }
}
```

**Error - Rate Limited (429 Too Many Requests):**

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many workflow requests. Please try again later.",
    "requestId": "req-error-456",
    "timestamp": "2023-01-01T12:00:00.000Z"
  }
}
```

## Status API

The Status API allows users to check the progress of their manga generation requests.

### Base URL

```
https://api.griot.example.com/status
```

### Endpoints

#### GET /status/{requestId}

Check the status and progress of a manga generation request.

**Request:**

```http
GET /status/{requestId}
Authorization: Bearer <jwt-token>
```

**Path Parameters:**

| Parameter   | Type   | Required | Description                           |
| ----------- | ------ | -------- | ------------------------------------- |
| `requestId` | string | Yes      | The request ID from workflow response |

**Success Response (200 OK) - Story Generation:**

```json
{
  "requestId": "req-789ghi-jkl012",
  "status": "PROCESSING",
  "type": "STORY",
  "timestamp": "2023-01-01T12:02:00.000Z",
  "progress": {
    "currentStep": "Generating story content",
    "totalSteps": 3,
    "completedSteps": 1
  },
  "result": {
    "storyId": "story-123abc-456def"
  }
}
```

**Success Response (200 OK) - Completed:**

```json
{
  "requestId": "req-789ghi-jkl012",
  "status": "COMPLETED",
  "type": "STORY",
  "timestamp": "2023-01-01T12:05:00.000Z",
  "progress": {
    "currentStep": "All episodes completed",
    "totalSteps": 3,
    "completedSteps": 3
  },
  "result": {
    "storyId": "story-123abc-456def",
    "downloadUrl": "/api/stories/story-123abc-456def/download"
  }
}
```

**Success Response (200 OK) - Failed:**

```json
{
  "requestId": "req-789ghi-jkl012",
  "status": "FAILED",
  "type": "STORY",
  "timestamp": "2023-01-01T12:03:00.000Z",
  "error": "Generation failed due to external service error"
}
```

**Error Responses:**

- **400 Bad Request**: Missing or invalid request ID
- **401 Unauthorized**: Missing or invalid authentication
- **403 Forbidden**: Request belongs to different user
- **404 Not Found**: Request ID not found
- **500 Internal Server Error**: Server error during status retrieval

### Testing with Postman

#### Test Status Check

1. **Method**: GET
2. **URL**: `https://your-api-gateway-url/dev/status/{requestId}`
   - Replace `{requestId}` with actual request ID from workflow start response
3. **Headers**:
   ```
   Authorization: Bearer <your-jwt-token>
   ```
4. **No Body Required**

#### Expected Responses

**Success - In Progress:**

```json
{
  "requestId": "req-87654321-4321-4321-4321-210987654321",
  "status": "PROCESSING",
  "type": "STORY",
  "timestamp": "2023-01-01T12:02:30.000Z",
  "progress": {
    "currentStep": "Generating episodes (1/1)",
    "totalSteps": 3,
    "completedSteps": 2
  },
  "result": {
    "storyId": "story-12345678-1234-1234-1234-123456789012"
  }
}
```

**Error - Not Found (404):**

```json
{
  "error": {
    "code": "REQUEST_NOT_FOUND",
    "message": "Generation request not found",
    "requestId": "api-request-123",
    "timestamp": "2023-01-01T12:00:00.000Z"
  }
}
```

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

3. **Start Workflow:**

```bash
curl -X POST https://api.griot.example.com/workflow/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "numberOfStories": 2,
    "batchSize": 1
  }'
```

4. **Check Status:**

```bash
curl -X GET https://api.griot.example.com/status/req-789ghi-jkl012 \
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

### Version 3.0 (Current)

- **Added**: POST /workflow/start endpoint for batch manga generation workflows
- **Added**: GET /status/{requestId} endpoint for checking generation progress
- **Added**: Rate limiting for workflow endpoints (5 requests per 5 minutes)
- **Added**: Sequential story generation with progress tracking
- **Added**: Comprehensive Postman testing documentation
- **Improved**: Enhanced error responses with specific error codes
- **Security**: Added workflow-specific authentication and authorization

### Version 2.0

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
