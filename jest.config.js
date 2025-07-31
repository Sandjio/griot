module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/griot-infra"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/test/**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "griot-infra/**/*.ts",
    "!src/**/*.d.ts",
    "!griot-infra/**/*.d.ts",
    "!src/**/__tests__/**",
    "!griot-infra/**/test/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  testTimeout: 30000, // Increased timeout for load tests
  // Test groups for different types of tests
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/(__tests__|test)/**/*.test.ts"],
      testPathIgnorePatterns: [
        "<rootDir>/src/__tests__/batch-workflow-load.test.ts",
        "<rootDir>/src/__tests__/sequential-story-performance.test.ts",
      ],
    },
    {
      displayName: "integration",
      testMatch: [
        "<rootDir>/src/__tests__/batch-workflow-integration.test.ts",
        "<rootDir>/src/__tests__/continue-episode-integration.test.ts",
        "<rootDir>/src/__tests__/workflow-error-scenarios.test.ts",
        "<rootDir>/src/__tests__/workflow-endpoints-e2e.test.ts",
      ],
      testTimeout: 60000, // 1 minute for integration tests
    },
    {
      displayName: "performance",
      testMatch: [
        "<rootDir>/src/__tests__/batch-workflow-load.test.ts",
        "<rootDir>/src/__tests__/sequential-story-performance.test.ts",
      ],
      testTimeout: 300000, // 5 minutes for performance tests
    },
  ],
};
