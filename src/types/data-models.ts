/**
 * Data Models for Manga Generation Platform
 * These interfaces define the structure of data entities stored in DynamoDB
 */

// Base entity interface for DynamoDB Single Table Design
export interface BaseEntity {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  createdAt: string;
  updatedAt?: string;
}

// User Profile Entity
export interface UserProfile extends BaseEntity {
  PK: `USER#${string}`; // USER#{userId}
  SK: "PROFILE";
  GSI1PK: `USER#${string}`; // USER#{userId}
  GSI1SK: "PROFILE";
  email: string;
  status: "ACTIVE" | "INACTIVE";
  preferences?: UserPreferencesData;
}

// User Preferences Entity
export interface UserPreferences extends BaseEntity {
  PK: `USER#${string}`; // USER#{userId}
  SK: `PREFERENCES#${string}`; // PREFERENCES#{timestamp}
  GSI1PK: `USER#${string}`; // USER#{userId}
  GSI1SK: `PREFERENCES#${string}`; // PREFERENCES#{timestamp}
  preferences: UserPreferencesData;
  insights?: QlooInsights;
}

// Story Entity
export interface Story extends BaseEntity {
  PK: `USER#${string}`; // USER#{userId}
  SK: `STORY#${string}`; // STORY#{storyId}
  GSI1PK: `STORY#${string}`; // STORY#{storyId}
  GSI1SK: "METADATA";
  GSI2PK: `STATUS#${GenerationStatus}`;
  GSI2SK: string; // createdAt timestamp
  storyId: string;
  title: string;
  s3Key: string;
  status: GenerationStatus;
  userId: string;
}

// Episode Entity
export interface Episode extends BaseEntity {
  PK: `STORY#${string}`; // STORY#{storyId}
  SK: `EPISODE#${number}`; // EPISODE#{episodeNumber}
  GSI1PK: `EPISODE#${string}`; // EPISODE#{episodeId}
  GSI1SK: "METADATA";
  GSI2PK: `STATUS#${GenerationStatus}`;
  GSI2SK: string; // createdAt timestamp
  episodeId: string;
  episodeNumber: number;
  storyId: string;
  s3Key: string;
  pdfS3Key?: string;
  status: GenerationStatus;
}

// Generation Request Entity
export interface GenerationRequest extends BaseEntity {
  PK: `USER#${string}`; // USER#{userId}
  SK: `REQUEST#${string}`; // REQUEST#{requestId}
  GSI1PK: `REQUEST#${string}`; // REQUEST#{requestId}
  GSI1SK: "STATUS";
  GSI2PK: `STATUS#${GenerationStatus}`;
  GSI2SK: string; // createdAt timestamp
  requestId: string;
  userId: string;
  type: GenerationType;
  status: GenerationStatus;
  relatedEntityId?: string; // storyId or episodeId
}

// Supporting Types
export type GenerationStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
export type GenerationType = "STORY" | "EPISODE" | "IMAGE";

// User Preferences Data Structure
export interface UserPreferencesData {
  genres: string[];
  themes: string[];
  artStyle: string;
  targetAudience: string;
  contentRating: string;
}

// Qloo API Integration Types
export interface QlooInsights {
  recommendations: Array<{
    category: string;
    score: number;
    attributes: Record<string, any>;
  }>;
  trends: Array<{
    topic: string;
    popularity: number;
  }>;
}

// Bedrock Integration Types
export interface BedrockStoryPrompt {
  model: "anthropic.claude-3-sonnet-20240229-v1:0";
  prompt: string;
  maxTokens: number;
  temperature: number;
}

export interface BedrockImagePrompt {
  model: "stability.stable-diffusion-xl-v1";
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
}

export interface BedrockResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// S3 File References
export interface S3FileReference {
  bucket: string;
  key: string;
  url?: string;
  contentType?: string;
  size?: number;
  etag?: string;
  versionId?: string;
}

// Lambda Event Types
export interface PostAuthEvent {
  userPoolId: string;
  userName: string;
  request: {
    userAttributes: {
      email: string;
      sub: string;
    };
  };
}

export interface APIGatewayProxyEvent {
  httpMethod: string;
  path: string;
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
  body: string | null;
  requestContext: {
    requestId: string;
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
}

// AWS Lambda Context Types
export interface LambdaContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis(): number;
}

// DynamoDB Operation Types
export interface DynamoDBQueryOptions {
  IndexName?: string;
  KeyConditionExpression: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, any>;
  ScanIndexForward?: boolean;
  Limit?: number;
  ExclusiveStartKey?: Record<string, any>;
}

export interface DynamoDBPutOptions {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, any>;
}

export interface DynamoDBUpdateOptions {
  UpdateExpression: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, any>;
}

// EventBridge Put Events Types
export interface EventBridgePutEventsEntry {
  Source: string;
  DetailType: string;
  Detail: string;
  EventBusName?: string;
  Time?: Date;
}

// S3 Operation Types
export interface S3PutObjectOptions {
  Bucket: string;
  Key: string;
  Body: Buffer | string;
  ContentType?: string;
  Metadata?: Record<string, string>;
  ServerSideEncryption?: "AES256" | "aws:kms";
}

export interface S3GetObjectOptions {
  Bucket: string;
  Key: string;
  Range?: string;
}

// Cognito Types
export interface CognitoUserAttributes {
  sub: string;
  email: string;
  email_verified?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

// Environment Configuration Types
export interface EnvironmentConfig {
  DYNAMODB_TABLE_NAME: string;
  S3_BUCKET_NAME: string;
  EVENTBRIDGE_BUS_NAME: string;
  QLOO_API_URL: string;
  QLOO_API_KEY: string;
  BEDROCK_REGION: string;
  LOG_LEVEL: "DEBUG" | "INFO" | "WARN" | "ERROR";
  ENVIRONMENT: "development" | "staging" | "production";
}
