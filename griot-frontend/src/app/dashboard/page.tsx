"use client";

import { useAuth } from "@/hooks/useAuth";
import { usePreferencesFlow } from "@/hooks/usePreferencesFlow";
import { useMangaGeneration } from "@/hooks/useMangaGeneration";
import { MainLayout } from "@/components/layout";
import { MangaCategory } from "@/types/api";

export default function DashboardPage() {
  const { user } = useAuth();
  const { needsPreferences } = usePreferencesFlow();
  const {
    isGenerating,
    currentGeneration,
    progress,
    currentStep,
    error,
    generateManga,
    cancelGeneration,
    clearError,
    retry,
  } = useMangaGeneration();

  // Handle category selection and generation
  const handleGenerateCategory = async (category: MangaCategory) => {
    clearError(); // Clear any previous errors
    await generateManga(category);
  };

  // If user needs preferences, the usePreferencesFlow hook will handle redirection
  if (needsPreferences) {
    return (
      <MainLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Redirecting to preferences...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      {/* Page Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white text-lg font-semibold">
                {(user?.username || user?.email || "U").charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Welcome back,{" "}
                {user?.username || user?.email?.split("@")[0] || "User"}!
              </h1>
              <p className="text-gray-600">
                Create amazing manga stories tailored to your preferences
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Generate Your Manga
          </h2>
          <p className="text-gray-600">
            Choose a category below to start generating your personalized manga
            story.
          </p>
        </div>

        {/* Generation Progress Display */}
        {isGenerating && (
          <div className="mb-8 bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Generating Your Manga...
              </h3>
              <button
                onClick={cancelGeneration}
                className="text-sm text-red-600 hover:text-red-700 transition-colors"
              >
                Cancel
              </button>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{currentStep}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-purple-600 to-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
              <span>This may take a few minutes...</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && !isGenerating && (
          <div className="mb-8 bg-red-50 border border-red-200 rounded-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-red-800">
                Generation Failed
              </h3>
              <button
                onClick={clearError}
                className="text-red-600 hover:text-red-700"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <p className="text-red-700 mb-4">{error}</p>
            <button
              onClick={retry}
              className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Manga Generation Categories */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {/* Adventure Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Adventure
            </h3>
            <p className="text-gray-600 mb-4">
              Epic journeys, heroic quests, and thrilling adventures await.
            </p>
            <button
              onClick={() => handleGenerateCategory("Adventure")}
              disabled={isGenerating}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Adventure Story"
              )}
            </button>
          </div>

          {/* Romance Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-pink-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-pink-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Romance
            </h3>
            <p className="text-gray-600 mb-4">
              Heartwarming love stories and romantic adventures.
            </p>
            <button
              onClick={() => handleGenerateCategory("Romance")}
              disabled={isGenerating}
              className="w-full bg-pink-600 text-white py-2 px-4 rounded-md hover:bg-pink-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Romance Story"
              )}
            </button>
          </div>

          {/* Fantasy Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Fantasy
            </h3>
            <p className="text-gray-600 mb-4">
              Magical worlds, mythical creatures, and supernatural powers.
            </p>
            <button
              onClick={() => handleGenerateCategory("Fantasy")}
              disabled={isGenerating}
              className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Fantasy Story"
              )}
            </button>
          </div>

          {/* Sci-Fi Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Sci-Fi</h3>
            <p className="text-gray-600 mb-4">
              Futuristic technology, space exploration, and scientific wonders.
            </p>
            <button
              onClick={() => handleGenerateCategory("Sci-Fi")}
              disabled={isGenerating}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Sci-Fi Story"
              )}
            </button>
          </div>

          {/* Mystery Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Mystery
            </h3>
            <p className="text-gray-600 mb-4">
              Intriguing puzzles, detective work, and suspenseful
              investigations.
            </p>
            <button
              onClick={() => handleGenerateCategory("Mystery")}
              disabled={isGenerating}
              className="w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Mystery Story"
              )}
            </button>
          </div>

          {/* Horror Category */}
          <div className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Horror</h3>
            <p className="text-gray-600 mb-4">
              Spine-chilling tales, supernatural encounters, and dark mysteries.
            </p>
            <button
              onClick={() => handleGenerateCategory("Horror")}
              disabled={isGenerating}
              className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating...
                </>
              ) : (
                "Generate Horror Story"
              )}
            </button>
          </div>
        </div>

        {/* Generated Content Display */}
        {currentGeneration &&
          currentGeneration.status === "completed" &&
          currentGeneration.story && (
            <div className="mt-12 bg-white rounded-lg shadow-md overflow-hidden">
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
                <h3 className="text-xl font-semibold text-white">
                  Your Generated Manga: {currentGeneration.story.title}
                </h3>
                <p className="text-purple-100 mt-1">
                  Category: {currentGeneration.category}
                </p>
              </div>

              <div className="p-6">
                {/* Synopsis */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">
                    Synopsis
                  </h4>
                  <p className="text-gray-700 leading-relaxed">
                    {currentGeneration.story.synopsis}
                  </p>
                </div>

                {/* Chapters */}
                <div className="space-y-6">
                  <h4 className="text-lg font-semibold text-gray-900">
                    Chapters
                  </h4>
                  {currentGeneration.story.chapters.map((chapter, index) => (
                    <div
                      key={index}
                      className="border-l-4 border-purple-500 pl-4"
                    >
                      <h5 className="text-md font-semibold text-gray-800 mb-2">
                        Chapter {index + 1}: {chapter.title}
                      </h5>

                      {/* Chapter Image */}
                      {chapter.imageUrl && (
                        <div className="mb-4">
                          <img
                            src={chapter.imageUrl}
                            alt={`Chapter ${index + 1} illustration`}
                            className="w-full max-w-md rounded-lg shadow-md"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = "none";
                            }}
                          />
                        </div>
                      )}

                      {/* Chapter Content */}
                      <div className="prose prose-gray max-w-none">
                        {chapter.content.split("\n").map(
                          (paragraph, pIndex) =>
                            paragraph.trim() && (
                              <p
                                key={pIndex}
                                className="text-gray-700 mb-3 leading-relaxed"
                              >
                                {paragraph.trim()}
                              </p>
                            )
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Additional Images */}
                {currentGeneration.images &&
                  currentGeneration.images.length > 0 && (
                    <div className="mt-8">
                      <h4 className="text-lg font-semibold text-gray-900 mb-4">
                        Gallery
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {currentGeneration.images.map((image) => (
                          <div key={image.id} className="relative group">
                            <img
                              src={image.url}
                              alt={image.description}
                              className="w-full h-48 object-cover rounded-lg shadow-md group-hover:shadow-lg transition-shadow"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.parentElement?.remove();
                              }}
                            />
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-opacity rounded-lg"></div>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-3 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity">
                              <p className="text-white text-sm">
                                {image.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Action Buttons */}
                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    onClick={() => window.print()}
                    className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition-colors flex items-center"
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                      />
                    </svg>
                    Print Story
                  </button>

                  <button
                    onClick={() => {
                      const storyText = `${currentGeneration.story!.title}\n\n${
                        currentGeneration.story!.synopsis
                      }\n\n${currentGeneration
                        .story!.chapters.map(
                          (ch, i) =>
                            `Chapter ${i + 1}: ${ch.title}\n\n${ch.content}`
                        )
                        .join("\n\n")}`;
                      navigator.clipboard.writeText(storyText);
                    }}
                    className="bg-blue-100 text-blue-700 px-4 py-2 rounded-md hover:bg-blue-200 transition-colors flex items-center"
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy Text
                  </button>

                  <button
                    onClick={() => {
                      // Reset the generation state to allow new generation
                      window.location.reload();
                    }}
                    className="bg-purple-100 text-purple-700 px-4 py-2 rounded-md hover:bg-purple-200 transition-colors flex items-center"
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    Generate New Story
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* User Preferences Summary */}
        <div className="mt-12 bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Your Preferences
          </h3>
          <p className="text-gray-600 mb-4">
            Stories will be generated based on your saved preferences. You can
            update these at any time.
          </p>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition-colors">
            Update Preferences
          </button>
        </div>
      </main>
    </MainLayout>
  );
}
