import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  GenerationRequestAccess,
  StoryAccess,
  EpisodeAccess,
} from "../../database/access-patterns";
import { GenerationRequest, Story, Episode } from "../../types/data-models";
import { StatusResponse } from "../../types/api-types";
import { createErrorResponse } from "../preferences-processing/response-utils";

/**
 * Status Check Lambda Function
 *
 * Handles GET /status/{requestId} endpoint to check generation progress
 * Returns current status and progress information for manga generation requests
 *
 * Requirements: 6.4, 6.5, 6.6
 */

interface StatusCheckEvent extends APIGatewayProxyEvent {
  pathParameters: {
    requestId: string;
  } | null;
  requestContext: APIGatewayProxyEvent["requestContext"] & {
    authorizer?: {
      claims: {
        sub: string;
        email: string;
      };
    };
  };
}

export const handler = async (
  event: StatusCheckEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Status Check Lambda invoked", {
    requestId: event.requestContext.requestId,
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    const lambdaRequestId = event.requestContext.requestId;

    // Extract user ID from Cognito claims
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(
        401,
        "UNAUTHORIZED",
        "User not authenticated",
        lambdaRequestId
      );
    }

    // Extract requestId from path parameters
    const requestId = event.pathParameters?.requestId;
    if (!requestId) {
      return createErrorResponse(
        400,
        "INVALID_REQUEST",
        "Request ID is required in path parameters",
        lambdaRequestId
      );
    }

    console.log("Checking status for request", {
      userId,
      requestId,
    });

    // Get the generation request
    const generationRequest = await GenerationRequestAccess.getByRequestId(
      requestId
    );

    if (!generationRequest) {
      return createErrorResponse(
        404,
        "REQUEST_NOT_FOUND",
        "Generation request not found",
        lambdaRequestId
      );
    }

    // Verify the request belongs to the authenticated user
    if (generationRequest.userId !== userId) {
      return createErrorResponse(
        403,
        "FORBIDDEN",
        "Access denied to this generation request",
        lambdaRequestId
      );
    }

    // Build the status response
    const statusResponse: StatusResponse = {
      requestId: generationRequest.requestId,
      status: generationRequest.status,
      type: generationRequest.type,
      timestamp: generationRequest.updatedAt || generationRequest.createdAt,
    };

    // Add error information if request failed
    if (generationRequest.status === "FAILED") {
      statusResponse.error =
        (generationRequest as any).errorMessage || "Generation failed";
    } else {
      // Add progress information only for non-failed requests
      if (generationRequest.type === "STORY") {
        const progress = await getStoryProgress(generationRequest);
        statusResponse.progress = progress.progress;
        statusResponse.result = progress.result;
      } else if (generationRequest.type === "EPISODE") {
        const progress = await getEpisodeProgress(generationRequest);
        statusResponse.progress = progress.progress;
        statusResponse.result = progress.result;
      }
    }

    console.log("Successfully retrieved status", {
      userId,
      requestId,
      status: statusResponse.status,
      type: statusResponse.type,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      },
      body: JSON.stringify(statusResponse),
    };
  } catch (error) {
    console.error("Unexpected error in status check", {
      requestId: event.requestContext.requestId,
      pathParameters: event.pathParameters,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred while checking status",
      event.requestContext.requestId
    );
  }
};

/**
 * Get progress information for story generation requests
 */
async function getStoryProgress(request: GenerationRequest): Promise<{
  progress?: StatusResponse["progress"];
  result?: StatusResponse["result"];
}> {
  if (!request.relatedEntityId) {
    return {
      progress: {
        currentStep: "Initializing story generation",
        totalSteps: 3,
        completedSteps: 0,
      },
    };
  }

  try {
    // Get the story details
    const story = await StoryAccess.getByStoryId(request.relatedEntityId);

    if (!story) {
      return {
        progress: {
          currentStep: "Story generation in progress",
          totalSteps: 3,
          completedSteps: 1,
        },
      };
    }

    // Get episodes for this story
    const episodes = await EpisodeAccess.getStoryEpisodes(story.storyId);
    const completedEpisodes = episodes.filter(
      (ep) => ep.status === "COMPLETED"
    ).length;
    const totalEpisodes = episodes.length || 1; // Assume at least 1 episode

    let currentStep: string;
    let completedSteps: number;
    const totalSteps = 3;

    switch (story.status) {
      case "PROCESSING":
        currentStep = "Generating story content";
        completedSteps = 1;
        break;
      case "COMPLETED":
        if (episodes.length === 0) {
          currentStep = "Story completed, preparing episodes";
          completedSteps = 2;
        } else if (completedEpisodes === totalEpisodes) {
          currentStep = "All episodes completed";
          completedSteps = 3;
        } else {
          currentStep = `Generating episodes (${completedEpisodes}/${totalEpisodes})`;
          completedSteps = 2;
        }
        break;
      case "FAILED":
        currentStep = "Story generation failed";
        completedSteps = 0;
        break;
      default:
        currentStep = "Initializing story generation";
        completedSteps = 0;
    }

    const result: StatusResponse["result"] = {
      storyId: story.storyId,
    };

    // Add download URL if story is completed and has content
    if (story.status === "COMPLETED" && story.s3Key) {
      // In a real implementation, you would generate a presigned URL here
      result.downloadUrl = `/api/stories/${story.storyId}/download`;
    }

    return {
      progress: {
        currentStep,
        totalSteps,
        completedSteps,
      },
      result,
    };
  } catch (error) {
    console.error("Error getting story progress", {
      requestId: request.requestId,
      storyId: request.relatedEntityId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      progress: {
        currentStep: "Error retrieving progress",
        totalSteps: 3,
        completedSteps: 0,
      },
    };
  }
}

/**
 * Get progress information for episode generation requests
 */
async function getEpisodeProgress(request: GenerationRequest): Promise<{
  progress?: StatusResponse["progress"];
  result?: StatusResponse["result"];
}> {
  if (!request.relatedEntityId) {
    return {
      progress: {
        currentStep: "Initializing episode generation",
        totalSteps: 2,
        completedSteps: 0,
      },
    };
  }

  try {
    // Get the episode details
    const episode = await EpisodeAccess.getByEpisodeId(request.relatedEntityId);

    if (!episode) {
      return {
        progress: {
          currentStep: "Episode generation in progress",
          totalSteps: 2,
          completedSteps: 1,
        },
      };
    }

    let currentStep: string;
    let completedSteps: number;
    const totalSteps = 2;

    switch (episode.status) {
      case "PROCESSING":
        currentStep = "Generating episode content and images";
        completedSteps = 1;
        break;
      case "COMPLETED":
        currentStep = "Episode completed";
        completedSteps = 2;
        break;
      case "FAILED":
        currentStep = "Episode generation failed";
        completedSteps = 0;
        break;
      default:
        currentStep = "Initializing episode generation";
        completedSteps = 0;
    }

    const result: StatusResponse["result"] = {
      episodeId: episode.episodeId,
    };

    // Add download URL if episode is completed and has PDF
    if (episode.status === "COMPLETED" && episode.pdfS3Key) {
      // In a real implementation, you would generate a presigned URL here
      result.downloadUrl = `/api/episodes/${episode.episodeId}/download`;
    }

    return {
      progress: {
        currentStep,
        totalSteps,
        completedSteps,
      },
      result,
    };
  } catch (error) {
    console.error("Error getting episode progress", {
      requestId: request.requestId,
      episodeId: request.relatedEntityId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      progress: {
        currentStep: "Error retrieving progress",
        totalSteps: 2,
        completedSteps: 0,
      },
    };
  }
}
