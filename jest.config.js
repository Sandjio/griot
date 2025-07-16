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
  testTimeout: 10000,
};
