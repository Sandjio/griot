"use client";

import { useEffect } from "react";
import { AuthUtils } from "@/lib/auth";
import { MainLayout } from "@/components/layout";

export default function LogoutPage() {
  useEffect(() => {
    // Clear tokens and redirect to Cognito logout
    AuthUtils.logout();
  }, []);

  return (
    <MainLayout showNavigation={false}>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Logging Out...
            </h2>
            <p className="text-gray-600">
              Please wait while we securely log you out.
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
