import { expect, test } from "@playwright/test";
import { uniqueName, uploadSingleFile, VALID_SKILL_MD } from "./helpers";

test.describe("upload, browse, and detail", () => {
  test("publishes a skill and finds it via search", async ({ page }) => {
    const name = uniqueName("e2e-skill");

    await uploadSingleFile(page, {
      fileName: "SKILL.md",
      content: VALID_SKILL_MD(name),
      artifactName: name,
      type: "CLAUDE_SKILL",
      description: "Uploaded by Playwright",
      tags: "e2e-test",
    });

    // Publishing redirects to the detail page with a success banner
    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("artifact-name")).toHaveText(name);
    await expect(page.getByTestId("markdown-preview")).toContainText("uploaded by an E2E test");
    await expect(page.getByTestId("install-oneliner")).toContainText(name);

    // The artifact is searchable from the browse page
    await page.goto("/");
    await page.getByTestId("search-input").fill(name);
    await expect(page.getByTestId(`artifact-card-${name}`)).toBeVisible({ timeout: 10000 });
  });

  test("publishes a CLAUDE.md via type auto-detection", async ({ page }) => {
    const name = uniqueName("e2e-claudemd");

    await page.goto("/upload/");
    await page.getByTestId("file-input").setInputFiles({
      name: "CLAUDE.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# My coding rules\n\n- Always add tests\n"),
    });
    // Type should be auto-detected as CLAUDE_MD
    await expect(page.getByTestId("type-input")).toHaveValue("CLAUDE_MD");
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId("publish-button").click();

    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });
  });

  test("filters by type on the browse page", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("type-filter").selectOption("CLAUDE_SKILL");
    await expect(page.getByTestId("artifact-grid")).toBeVisible();
    // every visible card carries the CLAUDE_SKILL badge
    const badges = page.locator("[data-testid^=artifact-card] .badge");
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveText("CLAUDE_SKILL");
    }
  });

  test("shows validation errors for a structurally invalid skill", async ({ page }) => {
    const name = uniqueName("e2e-invalid");

    await uploadSingleFile(page, {
      fileName: "README.md",
      content: "no SKILL.md in here",
      artifactName: name,
      type: "CLAUDE_SKILL",
    });

    await expect(page.getByTestId("upload-error")).toContainText("SKILL.md", { timeout: 20000 });
  });
});
