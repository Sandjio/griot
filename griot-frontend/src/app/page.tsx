import AuthButtons from "@/components/auth/AuthButtons";
import { MainLayout } from "@/components/layout";

export default function Home() {
  return (
    <MainLayout>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900">
        {/* Hero Section */}
        <section className="relative px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="text-center">
              {/* Platform Branding */}
              <div className="mb-8">
                <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl lg:text-7xl">
                  <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                    Griot
                  </span>
                </h1>
                <p className="mt-4 text-xl text-gray-600 dark:text-gray-300 sm:text-2xl">
                  Your AI-Powered Manga Creation Platform
                </p>
              </div>

              {/* Hero Description */}
              <div className="mx-auto max-w-3xl">
                <p className="text-lg text-gray-700 dark:text-gray-300 sm:text-xl">
                  Transform your imagination into stunning manga stories with
                  the power of AI. Create personalized manga content tailored to
                  your preferences, from epic adventures to heartwarming tales.
                </p>
              </div>

              {/* Authentication Buttons */}
              <div className="mt-12 flex flex-col gap-4 sm:flex-row sm:justify-center">
                <AuthButtons />
              </div>
            </div>
          </div>
        </section>

        {/* Feature Highlights Section */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
                Why Choose Griot?
              </h2>
              <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
                Discover the features that make manga creation effortless and
                enjoyable
              </p>
            </div>

            <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {/* Feature 1: AI-Powered Generation */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900">
                  <svg
                    className="h-6 w-6 text-purple-600 dark:text-purple-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  AI-Powered Generation
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Advanced AI technology creates unique manga stories and
                  artwork based on your preferences and chosen themes.
                </p>
              </div>

              {/* Feature 2: Personalized Content */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                  <svg
                    className="h-6 w-6 text-blue-600 dark:text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  Personalized Content
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Tailor your manga experience with custom preferences for
                  genres, art styles, and themes that match your taste.
                </p>
              </div>

              {/* Feature 3: Instant Creation */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
                  <svg
                    className="h-6 w-6 text-green-600 dark:text-green-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  Instant Creation
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Generate complete manga stories in minutes, not hours. From
                  concept to finished pages in just a few clicks.
                </p>
              </div>

              {/* Feature 4: Multiple Genres */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900">
                  <svg
                    className="h-6 w-6 text-orange-600 dark:text-orange-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  Multiple Genres
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Explore various manga genres from action and adventure to
                  romance and slice-of-life stories.
                </p>
              </div>

              {/* Feature 5: High-Quality Art */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pink-100 dark:bg-pink-900">
                  <svg
                    className="h-6 w-6 text-pink-600 dark:text-pink-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  High-Quality Art
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Professional-grade artwork with detailed characters,
                  backgrounds, and visual effects that bring your stories to
                  life.
                </p>
              </div>

              {/* Feature 6: Easy to Use */}
              <div className="relative rounded-2xl bg-white dark:bg-gray-800 p-8 shadow-lg ring-1 ring-gray-200 dark:ring-gray-700">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900">
                  <svg
                    className="h-6 w-6 text-indigo-600 dark:text-indigo-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59"
                    />
                  </svg>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
                  Easy to Use
                </h3>
                <p className="mt-4 text-gray-600 dark:text-gray-300">
                  Intuitive interface designed for creators of all skill levels.
                  No technical expertise required to create amazing manga.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-gray-50 dark:bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                © 2024 Griot. Transform your imagination into manga stories.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </MainLayout>
  );
}
