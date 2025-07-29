import {
  MangaCategory,
  MangaGenerationRequest,
  MangaGenerationResponse,
  MangaGenerationStatus,
} from "@/types/api";
import { apiService } from "./api";

/**
 * Manga Generation API Service
 * Handles all manga generation related API calls
 */
export class MangaApiService {
  /**
   * Start manga generation for a specific category
   */
  static async generateManga(category: MangaCategory) {
    const request: MangaGenerationRequest = {
      category,
    };

    return apiService.post<MangaGenerationResponse>(
      "/manga/generate",
      request,
      `Generate ${category} manga`
    );
  }

  /**
   * Get the status of a manga generation request
   */
  static async getGenerationStatus(generationId: string) {
    return apiService.get<MangaGenerationStatus>(
      `/manga/generation/${generationId}/status`,
      `Get generation status for ${generationId}`
    );
  }

  /**
   * Get completed manga generation result
   */
  static async getGenerationResult(generationId: string) {
    return apiService.get<MangaGenerationResponse>(
      `/manga/generation/${generationId}`,
      `Get generation result for ${generationId}`
    );
  }

  /**
   * Get user's manga generation history
   */
  static async getGenerationHistory() {
    return apiService.get<MangaGenerationResponse[]>(
      "/manga/generations",
      "Get user manga generation history"
    );
  }

  /**
   * Cancel an ongoing manga generation
   */
  static async cancelGeneration(generationId: string) {
    return apiService.delete<{ success: boolean }>(
      `/manga/generation/${generationId}`,
      `Cancel generation ${generationId}`
    );
  }
}
