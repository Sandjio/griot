import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Create DynamoDB client with optimized configuration
const dynamoDBClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  maxAttempts: 3,
});

// Create DynamoDB Document client for easier JSON operations
export const docClient = DynamoDBDocumentClient.from(dynamoDBClient, {
  marshallOptions: {
    convertEmptyValues: false,
    removeUndefinedValues: true,
    convertClassInstanceToMap: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

export const TABLE_NAME =
  process.env.MANGA_TABLE_NAME || "manga-platform-table-dev";
