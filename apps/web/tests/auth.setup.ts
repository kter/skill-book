import { expect, test as setup } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

setup("authenticate with the E2E password user", async ({ page }) => {
  const email = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD are required for dev E2E");
  }

  await page.goto("/login/");
  await page.getByTestId("email-input").fill(email);
  await page.getByTestId("password-input").fill(password);
  await page.getByTestId("login-submit").click();

  // Successful login redirects home and shows the user email in the nav
  await expect(page.getByTestId("user-email")).toContainText(email.split("@")[0]!, {
    timeout: 20000,
  });

  await page.context().storageState({ path: authFile });
});
