#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoreInfrastructureStack } from "../lib/stacks/core-infrastructure-stack";
import { ApiStack } from "../lib/stacks/api-stack";
import { MonitoringStack } from "../lib/stacks/monitoring-stack";

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext("environment") || "dev";

// Get environment-specific configuration
const environments = app.node.tryGetContext("environments") || {};
const envSettings = environments[environment] || {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  alertEmail: undefined,
};

// Environment configuration - make it optional for synthesis
const envConfig = {
  account: envSettings.account || process.env.CDK_DEFAULT_ACCOUNT || undefined,
  region: envSettings.region || process.env.CDK_DEFAULT_REGION || "us-east-1",
};

const alertEmail = envSettings.alertEmail;

// Core Infrastructure Stack
const coreStack = new CoreInfrastructureStack(
  app,
  `MangaCoreStack-${environment}`,
  {
    environment,
    env: envConfig,
    description: `Manga Platform Core Infrastructure - ${environment}`,
  }
);

// API Stack
const apiStack = new ApiStack(app, `MangaApiStack-${environment}`, {
  environment,
  mangaTable: coreStack.mangaTable,
  contentBucket: coreStack.contentBucket,
  eventBus: coreStack.eventBus,
  env: envConfig,
  description: `Manga Platform API - ${environment}`,
});

// Monitoring Stack
const monitoringStack = new MonitoringStack(
  app,
  `MangaMonitoringStack-${environment}`,
  {
    environment,
    mangaTable: coreStack.mangaTable,
    contentBucket: coreStack.contentBucket,
    api: apiStack.api,
    alertEmail,
    env: envConfig,
    description: `Manga Platform Monitoring - ${environment}`,
  }
);

// Add dependencies
apiStack.addDependency(coreStack);
monitoringStack.addDependency(coreStack);
monitoringStack.addDependency(apiStack);

// Tags for all stacks
cdk.Tags.of(app).add("Project", "MangaPlatform");
cdk.Tags.of(app).add("Environment", environment);
cdk.Tags.of(app).add("ManagedBy", "CDK");
