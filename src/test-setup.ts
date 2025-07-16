// Jest setup file for global test configuration
import { jest } from "@jest/globals";

// Mock environment variables
process.env.AWS_REGION = "us-east-1";
process.env.MANGA_TABLE_NAME = "manga-platform-table-test";

// Global test timeout
jest.setTimeout(10000);
