import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Playwright runs with cwd = apps/web, so a relative path is fine here.
dotenv.config({ path: ".env.local", quiet: true });

const ENV_URLS = {
  local: "http://localhost:3000",
  dev: "https://skill-book.dev.devtools.site",
  prd: "https://skill-book.devtools.site",
};

const targetEnv = (process.env.E2E_TARGET || "local") as keyof typeof ENV_URLS;
const baseURL = ENV_URLS[targetEnv] || targetEnv; // allow passing a raw URL

// In local mode, inject the bypass flag so the frontend skips Cognito login
const isLocalBypass = targetEnv === "local" || baseURL.includes("localhost");
if (isLocalBypass) {
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = "true";
  process.env.NEXT_PUBLIC_ENVIRONMENT = process.env.NEXT_PUBLIC_ENVIRONMENT || "local";
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

console.log(`[E2E] Target Environment: ${targetEnv}`);
console.log(`[E2E] Base URL: ${baseURL}`);
console.log(`[E2E] Auth bypass: ${isLocalBypass}`);

export default defineConfig({
  testDir: "./tests",
  timeout: targetEnv !== "local" ? 60000 : 30000,
  fullyParallel: false, // tests create globally-named artifacts; keep ordering simple
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    headless: true,
  },

  expect: {
    timeout: 15000,
  },

  projects: [
    // In local bypass mode, skip the auth setup project — no login needed
    ...(isLocalBypass ? [] : [{ name: "setup", testMatch: /.*\.setup\.ts/ }]),

    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(isLocalBypass ? {} : { storageState: "playwright/.auth/user.json" }),
      },
      ...(isLocalBypass ? {} : { dependencies: ["setup"] }),
    },
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
        ...(isLocalBypass ? {} : { storageState: "playwright/.auth/user.json" }),
      },
      ...(isLocalBypass ? {} : { dependencies: ["setup"] }),
    },
  ],

  /* Local mode: start the web dev server (the API must already be running via `make dev-api`) */
  webServer: isLocalBypass
    ? {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        env: {
          NEXT_PUBLIC_DEV_AUTH_BYPASS: "true",
          NEXT_PUBLIC_ENVIRONMENT: "local",
          NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        },
      }
    : undefined,
});
