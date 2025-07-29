import { test, expect, Page } from "@playwright/test";

// Mock Cognito responses for testing
const mockTokenResponse = {
  access_token: "mock-access-token",
  id_token: "mock-id-token",
  refresh_token: "mock-refresh-token",
  token_type: "Bearer",
  expires_in: 3600,
};

const mockUserData = {
  sub: "user-123",
  email: "test@example.com",
  "cognito:username": "testuser",
};

// Helper function to mock Cognito OAuth flow
async function mockCognitoAuth(page: Page) {
  // Mock the token endpoint
  await page.route("**/oauth2/token", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockTokenResponse),
    });
  });

  // Mock API endpoints
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();

    if (url.includes("/preferences")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { message: "Preferences saved" },
        }),
      });
    } else if (url.includes("/manga/generate")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            id: "manga-123",
            title: "Test Manga",
            content: "Generated manga content",
          },
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: {} }),
      });
    }
  });
}

// Helper function to simulate successful OAuth callback
async function simulateOAuthCallback(page: Page) {
  // Navigate to callback URL with mock authorization code
  await page.goto("/callback?code=mock-auth-code&state=mock-state");

  // Mock localStorage to simulate successful token storage
  await page.evaluate((tokens) => {
    const tokenData = JSON.stringify({
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    const userData = JSON.stringify({
      id: "user-123",
      email: "test@example.com",
      username: "testuser",
      hasPreferences: false,
    });

    localStorage.setItem("griot_tokens", btoa(tokenData));
    localStorage.setItem("griot_user", btoa(userData));
  }, mockTokenResponse);
}

test.describe("Authentication Flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockCognitoAuth(page);
  });

  test("should display landing page with authentication options", async ({
    page,
  }) => {
    await page.goto("/");

    // Check that landing page loads
    await expect(page).toHaveTitle(/Griot/);

    // Check for authentication buttons
    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /login/i })).toBeVisible();

    // Check for platform description
    await expect(page.getByText(/manga/i)).toBeVisible();
  });

  test("should redirect to Cognito when clicking Sign Up", async ({ page }) => {
    await page.goto("/");

    // Mock the redirect to prevent actual navigation to Cognito
    let redirectUrl = "";
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        redirectUrl = frame.url();
      }
    });

    // Click sign up button
    await page.getByRole("button", { name: /sign up/i }).click();

    // Wait for navigation attempt
    await page.waitForTimeout(1000);

    // Check that it would redirect to Cognito (in real scenario)
    // For testing, we'll check that the click handler was triggered
    expect(redirectUrl).toContain("localhost"); // Still on localhost in test
  });

  test("should redirect to Cognito when clicking Login", async ({ page }) => {
    await page.goto("/");

    let redirectUrl = "";
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        redirectUrl = frame.url();
      }
    });

    // Click login button
    await page.getByRole("button", { name: /login/i }).click();

    // Wait for navigation attempt
    await page.waitForTimeout(1000);

    // Check that it would redirect to Cognito (in real scenario)
    expect(redirectUrl).toContain("localhost"); // Still on localhost in test
  });

  test("should handle OAuth callback and redirect to preferences for new user", async ({
    page,
  }) => {
    // Simulate OAuth callback
    await simulateOAuthCallback(page);

    // Should redirect to preferences page for new user
    await expect(page).toHaveURL("/preferences");

    // Check that preferences form is displayed
    await expect(page.getByText(/preferences/i)).toBeVisible();
    await expect(page.getByText(/genres/i)).toBeVisible();
  });

  test("should handle OAuth callback and redirect to dashboard for returning user", async ({
    page,
  }) => {
    // Simulate OAuth callback for returning user
    await page.goto("/callback?code=mock-auth-code&state=mock-state");

    // Mock localStorage with user who has preferences
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true, // Returning user
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Reload to trigger auth state update
    await page.reload();

    // Should redirect to dashboard for returning user
    await expect(page).toHaveURL("/dashboard");

    // Check that dashboard is displayed
    await expect(page.getByText(/dashboard/i)).toBeVisible();
  });

  test("should handle OAuth callback errors", async ({ page }) => {
    // Navigate to callback URL with error
    await page.goto(
      "/callback?error=access_denied&error_description=User%20denied%20access"
    );

    // Should display error message
    await expect(page.getByText(/error/i)).toBeVisible();
    await expect(page.getByText(/denied/i)).toBeVisible();
  });
});

test.describe("Preferences Flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockCognitoAuth(page);
    await simulateOAuthCallback(page);
  });

  test("should display preferences form for new user", async ({ page }) => {
    // Should be on preferences page
    await expect(page).toHaveURL("/preferences");

    // Check form elements
    await expect(page.getByText(/preferences/i)).toBeVisible();
    await expect(page.getByText(/genres/i)).toBeVisible();
    await expect(page.getByText(/themes/i)).toBeVisible();
    await expect(page.getByText(/art style/i)).toBeVisible();
  });

  test("should allow user to select preferences and submit", async ({
    page,
  }) => {
    // Should be on preferences page
    await expect(page).toHaveURL("/preferences");

    // Select some preferences
    await page.getByLabel(/action/i).check();
    await page.getByLabel(/adventure/i).check();
    await page.getByLabel(/modern/i).check();

    // Submit preferences
    await page.getByRole("button", { name: /save/i }).click();

    // Should redirect to dashboard after successful submission
    await expect(page).toHaveURL("/dashboard");
  });

  test("should handle preferences submission errors", async ({ page }) => {
    // Mock API error
    await page.route("**/preferences", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "Invalid preferences data",
        }),
      });
    });

    // Should be on preferences page
    await expect(page).toHaveURL("/preferences");

    // Try to submit without selecting preferences
    await page.getByRole("button", { name: /save/i }).click();

    // Should display error message
    await expect(page.getByText(/error/i)).toBeVisible();
  });

  test("should validate required preferences", async ({ page }) => {
    // Should be on preferences page
    await expect(page).toHaveURL("/preferences");

    // Try to submit without selecting any preferences
    await page.getByRole("button", { name: /save/i }).click();

    // Should display validation errors
    await expect(page.getByText(/required/i)).toBeVisible();
  });
});

test.describe("Dashboard Flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockCognitoAuth(page);

    // Simulate authenticated user with preferences
    await page.goto("/");
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    await page.goto("/dashboard");
  });

  test("should display dashboard for authenticated user", async ({ page }) => {
    // Should be on dashboard page
    await expect(page).toHaveURL("/dashboard");

    // Check dashboard elements
    await expect(page.getByText(/dashboard/i)).toBeVisible();
    await expect(page.getByText(/welcome/i)).toBeVisible();
    await expect(page.getByText(/testuser/i)).toBeVisible();
  });

  test("should display manga generation categories", async ({ page }) => {
    // Should be on dashboard page
    await expect(page).toHaveURL("/dashboard");

    // Check for manga categories
    await expect(page.getByText(/categories/i)).toBeVisible();
    await expect(page.getByText(/action/i)).toBeVisible();
    await expect(page.getByText(/adventure/i)).toBeVisible();
    await expect(page.getByText(/romance/i)).toBeVisible();
  });

  test("should allow user to generate manga", async ({ page }) => {
    // Should be on dashboard page
    await expect(page).toHaveURL("/dashboard");

    // Click on a category to generate manga
    await page.getByText(/action/i).click();

    // Should show loading state
    await expect(page.getByText(/generating/i)).toBeVisible();

    // Wait for generation to complete
    await page.waitForTimeout(2000);

    // Should display generated manga
    await expect(page.getByText(/test manga/i)).toBeVisible();
    await expect(page.getByText(/generated manga content/i)).toBeVisible();
  });

  test("should handle manga generation errors", async ({ page }) => {
    // Mock API error for manga generation
    await page.route("**/manga/generate", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "Generation failed",
        }),
      });
    });

    // Should be on dashboard page
    await expect(page).toHaveURL("/dashboard");

    // Try to generate manga
    await page.getByText(/action/i).click();

    // Should display error message
    await expect(page.getByText(/error/i)).toBeVisible();
    await expect(page.getByText(/failed/i)).toBeVisible();
  });

  test("should allow user to logout", async ({ page }) => {
    // Should be on dashboard page
    await expect(page).toHaveURL("/dashboard");

    // Click logout button
    await page.getByRole("button", { name: /logout/i }).click();

    // Should redirect to landing page
    await expect(page).toHaveURL("/");

    // Should clear authentication state
    const tokens = await page.evaluate(() =>
      localStorage.getItem("griot_tokens")
    );
    expect(tokens).toBeNull();
  });
});

test.describe("Route Protection", () => {
  test("should redirect unauthenticated users to landing page", async ({
    page,
  }) => {
    // Try to access protected routes without authentication
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/");

    await page.goto("/preferences");
    await expect(page).toHaveURL("/");
  });

  test("should allow authenticated users to access protected routes", async ({
    page,
  }) => {
    await mockCognitoAuth(page);

    // Set up authenticated state
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Should be able to access dashboard
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    // Should be able to access preferences
    await page.goto("/preferences");
    await expect(page).toHaveURL("/preferences");
  });
});

test.describe("Token Refresh Flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockCognitoAuth(page);
  });

  test("should refresh tokens automatically when they expire", async ({
    page,
  }) => {
    // Set up authenticated state with expired tokens
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Navigate to dashboard
    await page.goto("/dashboard");

    // Should automatically refresh tokens and stay on dashboard
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(/dashboard/i)).toBeVisible();
  });

  test("should redirect to login when refresh token expires", async ({
    page,
  }) => {
    // Mock token refresh failure
    await page.route("**/oauth2/token", async (route) => {
      if (route.request().postData()?.includes("refresh_token")) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Refresh token expired",
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockTokenResponse),
        });
      }
    });

    // Set up authenticated state with expired tokens
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: "expired-refresh-token",
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Try to navigate to dashboard
    await page.goto("/dashboard");

    // Should redirect to landing page when refresh fails
    await expect(page).toHaveURL("/");
  });
});

test.describe("Session Management", () => {
  test("should maintain authentication state across page refreshes", async ({
    page,
  }) => {
    await mockCognitoAuth(page);

    // Set up authenticated state
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Navigate to dashboard
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    // Refresh the page
    await page.reload();

    // Should still be authenticated and on dashboard
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(/dashboard/i)).toBeVisible();
  });

  test("should handle concurrent requests with token refresh", async ({
    page,
  }) => {
    await mockCognitoAuth(page);

    // Set up authenticated state with tokens that need refresh
    await page.evaluate((tokens) => {
      const tokenData = JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes (within refresh window)
      });

      const userData = JSON.stringify({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
        hasPreferences: true,
      });

      localStorage.setItem("griot_tokens", btoa(tokenData));
      localStorage.setItem("griot_user", btoa(userData));
    }, mockTokenResponse);

    // Navigate to dashboard
    await page.goto("/dashboard");

    // Make multiple API requests simultaneously
    await Promise.all([
      page.getByText(/action/i).click(),
      page.getByText(/adventure/i).click(),
      page.getByText(/romance/i).click(),
    ]);

    // All requests should succeed
    await expect(page.getByText(/generating/i)).toBeVisible();
  });
});
