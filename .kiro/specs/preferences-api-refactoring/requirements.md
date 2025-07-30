# Requirements Document

## Introduction

This feature refactors the `/preferences` API endpoint to separate concerns and improve the architecture. The current preferences-processing lambda sends events to EventBridge to trigger manga generation workflows, but this coupling should be removed. Instead, the preferences-processing lambda will focus solely on storing user preferences from the Qloo API to DynamoDB. Additionally, a new GET endpoint will be implemented to retrieve user preferences from the database. The manga generation workflow will be triggered by a separate mechanism to be implemented later.

## Requirements

### Requirement 1

**User Story:** As a system administrator, I want the preferences-processing lambda to focus only on storing preferences data, so that the system has better separation of concerns and is easier to maintain.

#### Acceptance Criteria

1. WHEN a POST request is made to /preferences THEN the preferences-processing lambda SHALL process the request without sending events to EventBridge
2. WHEN the preferences-processing lambda receives user preferences THEN it SHALL call the Qloo API to get preference data
3. WHEN the Qloo API returns preference data THEN the lambda SHALL store the data in the DynamoDB table using the single table design
4. WHEN preferences are successfully stored THEN the lambda SHALL return a success response to the client
5. WHEN any step in the process fails THEN the lambda SHALL return appropriate error responses with proper HTTP status codes

### Requirement 2

**User Story:** As a frontend application, I want to retrieve user preferences via a GET request to /preferences, so that I can display current user preferences and allow users to modify them.

#### Acceptance Criteria

1. WHEN a GET request is made to /preferences with a valid user authentication THEN the system SHALL return the user's stored preferences from DynamoDB
2. WHEN a user has no stored preferences THEN the system SHALL return an empty preferences object with appropriate HTTP status
3. WHEN the user is not authenticated THEN the system SHALL return a 401 Unauthorized response
4. WHEN the user is authenticated but preferences cannot be retrieved THEN the system SHALL return appropriate error responses
5. WHEN preferences are successfully retrieved THEN the response SHALL include all preference fields in a consistent format

### Requirement 3

**User Story:** As a developer, I want the preferences data to be stored consistently in the single table DynamoDB design, so that it integrates properly with the existing data architecture.

#### Acceptance Criteria

1. WHEN storing preferences THEN the system SHALL use the existing single table design patterns and access patterns
2. WHEN storing user preferences THEN the system SHALL include proper partition key and sort key values for efficient retrieval
3. WHEN storing preferences THEN the system SHALL include all necessary metadata fields (timestamps, user ID, etc.)
4. WHEN retrieving preferences THEN the system SHALL use efficient DynamoDB query patterns to minimize read costs
5. WHEN preferences data structure changes THEN the system SHALL maintain backward compatibility with existing stored data

### Requirement 4

**User Story:** As a system architect, I want the EventBridge integration removed from the preferences workflow, so that manga generation can be triggered independently and the system is more modular.

#### Acceptance Criteria

1. WHEN preferences are successfully stored THEN the system SHALL NOT publish any events to EventBridge
2. WHEN the preferences-processing lambda completes THEN it SHALL only return HTTP responses without triggering downstream workflows
3. WHEN removing EventBridge integration THEN the system SHALL maintain all existing functionality except for the workflow triggering
4. WHEN the refactoring is complete THEN the preferences endpoint SHALL have no dependencies on EventBridge services
5. WHEN manga generation workflows need to be triggered THEN they SHALL be handled by a separate system component (to be implemented later)

### Requirement 5

**User Story:** As an API consumer, I want consistent error handling and response formats from the preferences endpoints, so that I can reliably handle different scenarios in my application.

#### Acceptance Criteria

1. WHEN any preferences endpoint encounters an error THEN it SHALL return standardized error response format
2. WHEN authentication fails THEN the system SHALL return 401 status with appropriate error message
3. WHEN validation fails THEN the system SHALL return 400 status with detailed validation error information
4. WHEN server errors occur THEN the system SHALL return 500 status with appropriate error message
5. WHEN successful operations complete THEN the system SHALL return appropriate 2xx status codes with consistent response format
