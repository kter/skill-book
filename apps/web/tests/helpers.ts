import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const VALID_SKILL_MD = (name: string) => `---
name: ${name}
description: E2E test skill
---

# ${name}

This skill was uploaded by an E2E test.
`;

/** Upload a single file through the upload page UI. */
export async function uploadSingleFile(
  page: Page,
  options: {
    fileName: string;
    content: string;
    artifactName: string;
    type?: "CLAUDE_SKILL" | "CLAUDE_MD" | "AGENTS_MD";
    description?: string;
    tags?: string;
  },
): Promise<void> {
  await page.goto("/upload/");
  await page.getByTestId("file-input").setInputFiles({
    name: options.fileName,
    mimeType: "text/markdown",
    buffer: Buffer.from(options.content),
  });
  await expect(page.getByTestId("picked-count")).toBeVisible();
  await page.getByTestId("name-input").fill(options.artifactName);
  if (options.type) {
    await page.getByTestId("type-input").selectOption(options.type);
  }
  if (options.description) {
    await page.getByTestId("description-input").fill(options.description);
  }
  if (options.tags) {
    await page.getByTestId("tags-input").fill(options.tags);
  }
  await page.getByTestId("publish-button").click();
}
