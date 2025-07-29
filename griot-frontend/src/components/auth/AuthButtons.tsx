"use client";

import { AuthUtils } from "@/lib/auth";
import { preloadOnHover } from "@/lib/dynamic-imports";

export default function AuthButtons() {
  const handleSignUp = () => {
    AuthUtils.signup();
  };

  const handleLogin = () => {
    AuthUtils.login();
  };

  // Preload callback page when user hovers over auth buttons
  const preloadProps = preloadOnHover("callback");

  return (
    <>
      {/* Sign Up Button */}
      <button
        onClick={handleSignUp}
        {...preloadProps}
        className="group relative inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all duration-200 hover:from-purple-700 hover:to-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 sm:px-10 sm:py-5 sm:text-xl"
      >
        <span className="relative z-10">Get Started</span>
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 opacity-0 transition-opacity duration-200 group-hover:opacity-20"></div>
      </button>

      {/* Login Button */}
      <button
        onClick={handleLogin}
        {...preloadProps}
        className="group relative inline-flex items-center justify-center rounded-full border-2 border-gray-300 bg-white px-8 py-4 text-lg font-semibold text-gray-700 shadow-md transition-all duration-200 hover:border-gray-400 hover:bg-gray-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700 sm:px-10 sm:py-5 sm:text-xl"
      >
        <span className="relative z-10">Sign In</span>
        <div className="absolute inset-0 rounded-full bg-gray-100 opacity-0 transition-opacity duration-200 group-hover:opacity-20 dark:bg-gray-600"></div>
      </button>
    </>
  );
}
