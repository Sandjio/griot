# Implementation Plan

- [ ] 1. Update preferences-processing lambda to support GET method

  - Modify the main handler to route between GET and POST methods
  - Remove EventBridge integration code from POST handler
  - Add new GET handler method for retrieving user preferences
  - _Requirements: 1.1, 1.4, 2.1, 2.2_

- [ ] 2. Enhance database access patterns for preference retrieval

  - [ ] 2.1 Add new method to UserPreferencesAccess class

    - Create `getLatestWithMetadata` method to retrieve preferences with insights and timestamps
    - Implement efficient DynamoDB query for latest user preferences
    - Add proper error handling for database operations
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [ ] 2.2 Update existing database access methods

    - Ensure existing `create` and `getLatest` methods work correctly
    - Verify single table design patterns are maintained
    - Add unit tests for new database access method
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3. Remove EventBridge integration from preferences workflow

  - [ ] 3.1 Remove EventBridge publishing code from POST handler

    - Comment out or remove EventPublishingHelpers.publishStoryGeneration calls
    - Remove EventBridge-related error handling and logging
    - Update response messages to reflect that workflow triggering is removed
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 3.2 Update GenerationRequest handling

    - Remove or modify GenerationRequest creation and status updates
    - Simplify the POST handler flow to focus only on preference storage
    - Update success response to not mention story generation initiation
    - _Requirements: 4.1, 4.2, 4.5_

- [ ] 4. Implement GET endpoint handler logic

  - [ ] 4.1 Create GET method handler

    - Implement user authentication and authorization validation
    - Add user ID extraction from Cognito claims
    - Create database query to retrieve latest user preferences
    - _Requirements: 2.1, 2.2, 5.2_

  - [ ] 4.2 Add GET endpoint response formatting

    - Create success response format for preferences retrieval
    - Handle case when user has no stored preferences
    - Implement consistent error response formatting
    - _Requirements: 2.2, 2.3, 5.1, 5.5_

  - [ ] 4.3 Add GET endpoint error handling

    - Implement authentication error handling (401)
    - Add database error handling with appropriate HTTP status codes
    - Create user-friendly error messages for different scenarios
    - _Requirements: 2.4, 5.2, 5.3, 5.4, 5.5_

- [ ] 5. Update API Gateway configuration for GET method

  - [ ] 5.1 Add GET method to preferences resource

    - Configure GET method on /preferences endpoint in API Gateway
    - Set up Cognito authorization for GET method
    - Add proper CORS configuration for GET requests
    - _Requirements: 2.1, 5.2_

  - [ ] 5.2 Configure GET method responses and validation

    - Add method responses for 200, 401, 404, and 500 status codes
    - Configure response models for success and error responses
    - Set up request parameter validation if needed
    - _Requirements: 2.2, 2.3, 2.4, 5.1, 5.5_

- [ ] 6. Update IAM permissions and remove EventBridge access

  - [ ] 6.1 Remove EventBridge permissions from lambda role

    - Remove EventBridge PutEvents permissions from preferences-processing role
    - Verify DynamoDB and Qloo API permissions remain intact
    - Update security construct to reflect permission changes
    - _Requirements: 4.4, 4.5_

  - [ ] 6.2 Verify existing permissions for GET functionality

    - Ensure lambda has proper DynamoDB read permissions
    - Verify Cognito integration permissions are sufficient
    - Test that all required AWS service permissions are in place
    - _Requirements: 2.1, 2.2, 3.1, 3.2_

- [ ] 7. Update response utilities and error handling

  - [ ] 7.1 Enhance response utilities for GET endpoint

    - Update createSuccessResponse to handle preference retrieval responses
    - Add specific response formatting for empty preferences case
    - Ensure consistent response format across GET and POST endpoints
    - _Requirements: 2.2, 2.3, 5.1, 5.5_

  - [ ] 7.2 Update error codes and messages

    - Add new error codes specific to preference retrieval
    - Update existing error messages to remove workflow-related content
    - Ensure error response consistency between GET and POST methods
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 8. Write comprehensive tests for refactored functionality

  - [ ] 8.1 Create unit tests for GET endpoint

    - Test GET handler with existing user preferences
    - Test GET handler with no stored preferences
    - Test authentication and authorization for GET endpoint
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 8.2 Update unit tests for POST endpoint

    - Remove EventBridge-related test assertions
    - Update POST endpoint tests to verify EventBridge is not called
    - Test that preference storage functionality still works correctly
    - _Requirements: 1.1, 1.4, 4.1, 4.2_

  - [ ] 8.3 Create integration tests for both endpoints

    - Test complete GET /preferences flow with API Gateway
    - Test complete POST /preferences flow without EventBridge integration
    - Test error scenarios for both endpoints
    - _Requirements: 1.1, 2.1, 4.1, 5.1_

- [ ] 9. Update environment configuration and deployment

  - [ ] 9.1 Update lambda environment variables

    - Remove EventBridge-related environment variables if no longer needed
    - Verify all required environment variables for GET functionality
    - Update environment configuration in CDK stack
    - _Requirements: 4.4, 4.5_

  - [ ] 9.2 Update CDK infrastructure code

    - Add GET method configuration to API Gateway in api-stack.ts
    - Update lambda function permissions in security-construct.ts
    - Verify all infrastructure changes are properly configured
    - _Requirements: 2.1, 4.4, 5.1, 5.5_

- [ ] 10. Validate and test the complete refactored system

  - [ ] 10.1 Perform end-to-end testing

    - Test complete user preference submission flow (POST)
    - Test complete user preference retrieval flow (GET)
    - Verify EventBridge integration is completely removed
    - _Requirements: 1.1, 2.1, 4.1, 4.2_

  - [ ] 10.2 Validate backward compatibility

    - Ensure existing POST endpoint functionality is preserved
    - Verify no breaking changes to request/response formats
    - Test that frontend integration continues to work
    - _Requirements: 1.1, 1.4, 1.5, 5.1, 5.5_

  - [ ] 10.3 Update documentation and monitoring

    - Update API documentation to include GET endpoint
    - Verify monitoring and logging work for both endpoints
    - Update any deployment or operational documentation
    - _Requirements: 2.1, 2.2, 5.1, 5.5_
