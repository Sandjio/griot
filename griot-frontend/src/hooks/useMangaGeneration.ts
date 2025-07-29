import { useState, useCallback, useRef, useEffect } from "react";
import {
  MangaCategory,
  MangaGenerationResponse,
  MangaGenerationStatus,
} from "@/types/api";
import { MangaApiService } from "@/lib/manga-api";

interface MangaGenerationState {
  isGenerating: boolean;
  currentGeneration: MangaGenerationResponse | null;
  status: MangaGenerationStatus | null;
  error: string | null;
  progress: number;
  currentStep: string;
  estimatedTimeRemaining: number | null;
}

interface UseMangaGenerationReturn extends MangaGenerationState {
  generateManga: (category: MangaCategory) => Promise<void>;
  cancelGeneration: () => Promise<void>;
  clearError: () => void;
  retry: () => Promise<void>;
}

/**
 * Custom hook for managing manga generation state and operations
 */
export function useMangaGeneration(): UseMangaGenerationReturn {
  const [state, setState] = useState<MangaGenerationState>({
    isGenerating: false,
    currentGeneration: null,
    status: null,
    error: null,
    progress: 0,
    currentStep: "",
    estimatedTimeRemaining: null,
  });

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCategoryRef = useRef<MangaCategory | null>(null);

  /**
   * Clear any existing polling interval
   */
  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Poll for generation status updates
   */
  const pollGenerationStatus = useCallback(
    async (generationId: string) => {
      try {
        const result = await MangaApiService.getGenerationStatus(generationId);

        if (result.success && result.data) {
          const status = result.data;

          setState((prev) => ({
            ...prev,
            status,
            progress: status.progress,
            currentStep: status.currentStep,
            estimatedTimeRemaining: status.estimatedTimeRemaining || null,
            error: status.error || null,
          }));

          // If generation is complete or failed, stop polling and get final result
          if (status.status === "completed" || status.status === "failed") {
            clearPolling();

            if (status.status === "completed") {
              // Get the complete generation result
              const resultResponse = await MangaApiService.getGenerationResult(
                generationId
              );
              if (resultResponse.success && resultResponse.data) {
                setState((prev) => ({
                  ...prev,
                  isGenerating: false,
                  currentGeneration: resultResponse.data!,
                  progress: 100,
                  currentStep: "Completed",
                }));
              }
            } else {
              // Generation failed
              setState((prev) => ({
                ...prev,
                isGenerating: false,
                error: status.error || "Generation failed",
                progress: 0,
                currentStep: "Failed",
              }));
            }
          }
        } else {
          // API error during status check
          setState((prev) => ({
            ...prev,
            error: result.error?.message || "Failed to check generation status",
          }));
        }
      } catch (error) {
        console.error("Error polling generation status:", error);
        setState((prev) => ({
          ...prev,
          error: "Failed to check generation status",
        }));
      }
    },
    [clearPolling]
  );

  /**
   * Start manga generation
   */
  const generateManga = useCallback(
    async (category: MangaCategory) => {
      try {
        // Clear any previous state
        clearPolling();
        setState({
          isGenerating: true,
          currentGeneration: null,
          status: null,
          error: null,
          progress: 0,
          currentStep: "Starting generation...",
          estimatedTimeRemaining: null,
        });

        lastCategoryRef.current = category;

        // Start the generation
        const result = await MangaApiService.generateManga(category);

        if (result.success && result.data) {
          const generation = result.data;

          setState((prev) => ({
            ...prev,
            currentGeneration: generation,
            currentStep: "Generation started",
            progress: 5,
          }));

          // Start polling for status updates
          pollingIntervalRef.current = setInterval(() => {
            pollGenerationStatus(generation.id);
          }, 2000); // Poll every 2 seconds

          // Initial status check
          await pollGenerationStatus(generation.id);
        } else {
          // API error
          setState((prev) => ({
            ...prev,
            isGenerating: false,
            error: result.error?.message || "Failed to start manga generation",
            currentStep: "Failed to start",
          }));
        }
      } catch (error) {
        console.error("Error starting manga generation:", error);
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: "Failed to start manga generation",
          currentStep: "Failed to start",
        }));
      }
    },
    [clearPolling, pollGenerationStatus]
  );

  /**
   * Cancel ongoing generation
   */
  const cancelGeneration = useCallback(async () => {
    if (!state.currentGeneration) return;

    try {
      clearPolling();

      const result = await MangaApiService.cancelGeneration(
        state.currentGeneration.id
      );

      if (result.success) {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          currentStep: "Cancelled",
          progress: 0,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          error: result.error?.message || "Failed to cancel generation",
        }));
      }
    } catch (error) {
      console.error("Error cancelling generation:", error);
      setState((prev) => ({
        ...prev,
        error: "Failed to cancel generation",
      }));
    }
  }, [state.currentGeneration, clearPolling]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  /**
   * Retry the last generation
   */
  const retry = useCallback(async () => {
    if (lastCategoryRef.current) {
      await generateManga(lastCategoryRef.current);
    }
  }, [generateManga]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  return {
    ...state,
    generateManga,
    cancelGeneration,
    clearError,
    retry,
  };
}
