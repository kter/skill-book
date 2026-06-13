import { expect, test } from "@playwright/test";
import { uniqueName, uploadSingleFile, VALID_SKILL_MD } from "./helpers";

test.describe("ratings and forks", () => {
  test("rates and forks an artifact", async ({ page }) => {
    const name = uniqueName("e2e-social");

    await uploadSingleFile(page, {
      fileName: "SKILL.md",
      content: VALID_SKILL_MD(name),
      artifactName: name,
      type: "CLAUDE_SKILL",
      description: "social features test",
    });
    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });

    // Rate 4 stars
    await page.getByTestId("star-4").click();
    await expect(page.getByTestId("notice")).toContainText("Rated 4", { timeout: 10000 });

    // Fork creates a lineage-linked artifact
    const forkName = `${name}-fork`;
    page.on("dialog", (dialog) => dialog.accept(forkName));
    await page.getByTestId("fork-button").click();
    await expect(page.getByTestId("artifact-name")).toHaveText(forkName, { timeout: 15000 });
    await expect(page.locator(".detail-meta")).toContainText(`forked from`);

    // The source lists the fork
    await page.goto(`/artifact/?name=${encodeURIComponent(name)}`);
    await expect(page.getByTestId("forks-list")).toContainText(forkName);
  });

  test("version history shows immutable versions", async ({ page }) => {
    const name = uniqueName("e2e-versions");

    await uploadSingleFile(page, {
      fileName: "CLAUDE.md",
      content: "# version one",
      artifactName: name,
      type: "CLAUDE_MD",
    });
    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });

    // Publish a second version of the same artifact
    await uploadSingleFile(page, {
      fileName: "CLAUDE.md",
      content: "# version two",
      artifactName: name,
      type: "CLAUDE_MD",
    });
    await expect(page.getByTestId("publish-success")).toBeVisible({ timeout: 20000 });

    const rows = page.getByTestId("version-table").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("v2");
    await expect(rows.last()).toContainText("v1");
  });
});
