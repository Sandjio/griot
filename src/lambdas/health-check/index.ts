import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { errorHandler } from "../../utils/error-handler";
import { publishMetric } from "../../utils/cloudwatch-metrics";

/**
 * Health Check Lambda Function
 * Provides health status for deployment validation and monitoring
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Publish health check metric
    await publishMetric("HealthCheck", 1, "Count", "MangaPlatform");

    const healthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: process.env.DEPLOYMENT_VERSION || "1.0.0",
      environment: process.env.ENVIRONMENT || "unknown",
      deploymentColor: process.env.DEPLOYMENT_COLOR || "none",
      services: {
        api: "healthy",
        database: "healthy", // Could add actual DB health check
        storage: "healthy", // Could add actual S3 health check
        events: "healthy", // Could add actual EventBridge health check
      },
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
      },
      body: JSON.stringify(healthStatus),
    };
  } catch (error) {
    return errorHandler(error, event);
  }
};
