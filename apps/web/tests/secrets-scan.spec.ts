import { expect, test } from "@playwright/test";
import { uniqueName } from "./helpers";

// Synthetic AWS-style key used as a scan fixture — not a real credential.
const FAKE_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

test.describe("secrets scanning gate", () => {
  test("blocks an upload containing a secret, then publishes after override", async ({ page }) => {
    const name = uniqueName("e2e-leaky");

    await page.goto("/upload/");
    await page.getByTestId("file-input").setInputFiles([
      {
        name: "SKILL.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(`---\nname: ${name}\ndescription: leaky skill\n---\n\n# ${name}\n`),
      },
      {
        name: "config.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(`example key: "${FAKE_AWS_KEY}"\n`),
      },
    ]);
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId("type-input").selectOption("CLAUDE_SKILL");
    await page.getByTestId("publish-button").click();

    // Blocked: findings are listed with masked matches
    await expect(page.getByTestId("findings-list")).toBeVisible({ timeout: 20000 });
    const findingText = await page.getByTestId("finding-item").first().textContent();
    expect(findingText).toContain("aws-access-key-id");
    expect(findingText).not.toContain(FAKE_AWS_KEY.slice(4, -4)); // masked

    // Override the finding as a false positive and retry
    await page.locator("[data-testid^=finding-checkbox-]").first().check();
    await page.getByTestId("override-reason").fill("documented example value for E2E test");
    await page.getByTestId("override-and-retry").click();

    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("artifact-name")).toHaveText(name);
  });
});
