import { UserPreferences } from "../types/api";
import { apiService } from "./api";

/**
 * Preferences API service for managing user preferences
 */
export class PreferencesApiService {
  private static readonly PREFERENCES_ENDPOINT = "/preferences";

  /**
   * Submit user preferences to the API
   * @param preferences - User preferences data
   * @returns Promise with API response
   */
  static async submitPreferences(preferences: UserPreferences) {
    return apiService.post<{ message: string; userId: string }>(
      this.PREFERENCES_ENDPOINT,
      preferences,
      "preferences submission"
    );
  }

  /**
   * Get user preferences from the API
   * @returns Promise with user preferences data
   */
  static async getPreferences() {
    return apiService.get<UserPreferences>(
      this.PREFERENCES_ENDPOINT,
      "preferences retrieval"
    );
  }

  /**
   * Update user preferences
   * @param preferences - Updated preferences data
   * @returns Promise with API response
   */
  static async updatePreferences(preferences: UserPreferences) {
    return apiService.put<{ message: string; userId: string }>(
      this.PREFERENCES_ENDPOINT,
      preferences,
      "preferences update"
    );
  }

  /**
   * Delete user preferences
   * @returns Promise with API response
   */
  static async deletePreferences() {
    return apiService.delete<{ message: string }>(
      this.PREFERENCES_ENDPOINT,
      "preferences deletion"
    );
  }
}

/**
 * Hook for preferences API operations with loading states and error handling
 */
export function usePreferencesApi() {
  const submitPreferences = async (
    preferences: UserPreferences,
    onSuccess?: (data: { message: string; userId: string }) => void,
    onError?: (error: string) => void
  ) => {
    const result = await PreferencesApiService.submitPreferences(preferences);

    if (result.success && result.data) {
      onSuccess?.(result.data);
      return { success: true, data: result.data };
    } else if (result.error) {
      const errorMessage = result.error.message;
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }

    return { success: false, error: "Unknown error occurred" };
  };

  const getPreferences = async (
    onSuccess?: (data: UserPreferences) => void,
    onError?: (error: string) => void
  ) => {
    const result = await PreferencesApiService.getPreferences();

    if (result.success && result.data) {
      onSuccess?.(result.data);
      return { success: true, data: result.data };
    } else if (result.error) {
      const errorMessage = result.error.message;
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }

    return { success: false, error: "Unknown error occurred" };
  };

  const updatePreferences = async (
    preferences: UserPreferences,
    onSuccess?: (data: { message: string; userId: string }) => void,
    onError?: (error: string) => void
  ) => {
    const result = await PreferencesApiService.updatePreferences(preferences);

    if (result.success && result.data) {
      onSuccess?.(result.data);
      return { success: true, data: result.data };
    } else if (result.error) {
      const errorMessage = result.error.message;
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }

    return { success: false, error: "Unknown error occurred" };
  };

  const deletePreferences = async (
    onSuccess?: (data: { message: string }) => void,
    onError?: (error: string) => void
  ) => {
    const result = await PreferencesApiService.deletePreferences();

    if (result.success && result.data) {
      onSuccess?.(result.data);
      return { success: true, data: result.data };
    } else if (result.error) {
      const errorMessage = result.error.message;
      onError?.(errorMessage);
      return { success: false, error: errorMessage };
    }

    return { success: false, error: "Unknown error occurred" };
  };

  return {
    submitPreferences,
    getPreferences,
    updatePreferences,
    deletePreferences,
  };
}
