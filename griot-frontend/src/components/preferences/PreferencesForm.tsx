"use client";

import { useState } from "react";
import {
  UserPreferences,
  ArtStyle,
  TargetAudience,
  ContentRating,
} from "../../types/api";

interface PreferencesFormProps {
  onSubmit: (preferences: UserPreferences) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

interface FormStep {
  id: string;
  title: string;
  description: string;
}

const FORM_STEPS: FormStep[] = [
  {
    id: "genres",
    title: "Choose Your Favorite Genres",
    description: "Select the manga genres you enjoy most",
  },
  {
    id: "themes",
    title: "Select Preferred Themes",
    description: "Pick themes that interest you",
  },
  {
    id: "style",
    title: "Art Style & Audience",
    description: "Choose your preferred art style and target audience",
  },
];

const AVAILABLE_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Historical",
  "Psychological",
  "Mecha",
];

const AVAILABLE_THEMES = [
  "Friendship",
  "Love",
  "Betrayal",
  "Revenge",
  "Coming of Age",
  "Good vs Evil",
  "Redemption",
  "Sacrifice",
  "Power",
  "Family",
  "Honor",
  "Justice",
  "Survival",
  "Discovery",
  "Transformation",
  "Legacy",
];

const ART_STYLES: ArtStyle[] = [
  "Traditional",
  "Modern",
  "Minimalist",
  "Detailed",
  "Cartoon",
  "Realistic",
  "Chibi",
  "Dark",
  "Colorful",
  "Black and White",
];

const TARGET_AUDIENCES: TargetAudience[] = [
  "Children",
  "Teens",
  "Young Adults",
  "Adults",
  "All Ages",
];

const CONTENT_RATINGS: ContentRating[] = ["G", "PG", "PG-13", "R"];

export default function PreferencesForm({
  onSubmit,
  isLoading = false,
  error,
}: PreferencesFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [preferences, setPreferences] = useState<UserPreferences>({
    genres: [],
    themes: [],
    artStyle: "Modern",
    targetAudience: "Young Adults",
    contentRating: "PG-13",
  });
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const validateCurrentStep = (): boolean => {
    const errors: Record<string, string> = {};

    switch (currentStep) {
      case 0: // Genres
        if (preferences.genres.length === 0) {
          errors.genres = "Please select at least one genre";
        } else if (preferences.genres.length > 5) {
          errors.genres = "Please select no more than 5 genres";
        }
        break;
      case 1: // Themes
        if (preferences.themes.length === 0) {
          errors.themes = "Please select at least one theme";
        } else if (preferences.themes.length > 5) {
          errors.themes = "Please select no more than 5 themes";
        }
        break;
      case 2: // Style & Audience
        if (!preferences.artStyle) {
          errors.artStyle = "Please select an art style";
        }
        if (!preferences.targetAudience) {
          errors.targetAudience = "Please select a target audience";
        }
        if (!preferences.contentRating) {
          errors.contentRating = "Please select a content rating";
        }
        break;
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(prev + 1, FORM_STEPS.length - 1));
    }
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = async () => {
    if (validateCurrentStep()) {
      await onSubmit(preferences);
    }
  };

  const toggleSelection = (field: "genres" | "themes", value: string) => {
    setPreferences((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
    // Clear validation error when user makes a selection
    if (validationErrors[field]) {
      setValidationErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const updatePreference = <K extends keyof UserPreferences>(
    field: K,
    value: UserPreferences[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [field]: value }));
    // Clear validation error when user makes a selection
    if (validationErrors[field as string]) {
      setValidationErrors((prev) => ({ ...prev, [field as string]: "" }));
    }
  };

  const renderGenresStep = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {AVAILABLE_GENRES.map((genre) => (
          <button
            key={genre}
            type="button"
            onClick={() => toggleSelection("genres", genre)}
            className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
              preferences.genres.includes(genre)
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            {genre}
          </button>
        ))}
      </div>
      {validationErrors.genres && (
        <p className="text-red-600 text-sm">{validationErrors.genres}</p>
      )}
      <p className="text-sm text-gray-600">
        Selected: {preferences.genres.length}/5 genres
      </p>
    </div>
  );

  const renderThemesStep = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {AVAILABLE_THEMES.map((theme) => (
          <button
            key={theme}
            type="button"
            onClick={() => toggleSelection("themes", theme)}
            className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
              preferences.themes.includes(theme)
                ? "border-green-500 bg-green-50 text-green-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            {theme}
          </button>
        ))}
      </div>
      {validationErrors.themes && (
        <p className="text-red-600 text-sm">{validationErrors.themes}</p>
      )}
      <p className="text-sm text-gray-600">
        Selected: {preferences.themes.length}/5 themes
      </p>
    </div>
  );

  const renderStyleStep = () => (
    <div className="space-y-8">
      {/* Art Style */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Art Style
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {ART_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => updatePreference("artStyle", style)}
              className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
                preferences.artStyle === style
                  ? "border-purple-500 bg-purple-50 text-purple-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {style}
            </button>
          ))}
        </div>
        {validationErrors.artStyle && (
          <p className="text-red-600 text-sm mt-2">
            {validationErrors.artStyle}
          </p>
        )}
      </div>

      {/* Target Audience */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Target Audience
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {TARGET_AUDIENCES.map((audience) => (
            <button
              key={audience}
              type="button"
              onClick={() => updatePreference("targetAudience", audience)}
              className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
                preferences.targetAudience === audience
                  ? "border-orange-500 bg-orange-50 text-orange-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {audience}
            </button>
          ))}
        </div>
        {validationErrors.targetAudience && (
          <p className="text-red-600 text-sm mt-2">
            {validationErrors.targetAudience}
          </p>
        )}
      </div>

      {/* Content Rating */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Content Rating
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CONTENT_RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => updatePreference("contentRating", rating)}
              className={`p-3 rounded-lg border-2 transition-all duration-200 text-sm font-medium ${
                preferences.contentRating === rating
                  ? "border-red-500 bg-red-50 text-red-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {rating}
            </button>
          ))}
        </div>
        {validationErrors.contentRating && (
          <p className="text-red-600 text-sm mt-2">
            {validationErrors.contentRating}
          </p>
        )}
      </div>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderGenresStep();
      case 1:
        return renderThemesStep();
      case 2:
        return renderStyleStep();
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          {FORM_STEPS.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center ${
                index < FORM_STEPS.length - 1 ? "flex-1" : ""
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  index <= currentStep
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-600"
                }`}
              >
                {index + 1}
              </div>
              {index < FORM_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-1 mx-4 ${
                    index < currentStep ? "bg-blue-600" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {FORM_STEPS[currentStep].title}
          </h2>
          <p className="text-gray-600">{FORM_STEPS[currentStep].description}</p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Step Content */}
      <div className="mb-8">{renderStepContent()}</div>

      {/* Navigation Buttons */}
      <div className="flex justify-between">
        <button
          type="button"
          onClick={handlePrevious}
          disabled={currentStep === 0}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        {currentStep < FORM_STEPS.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading}
            className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isLoading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Saving...
              </>
            ) : (
              "Complete Setup"
            )}
          </button>
        )}
      </div>
    </div>
  );
}
