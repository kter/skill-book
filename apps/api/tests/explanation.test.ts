import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Explainer, ExplanationInput } from "../src/ai/explainer.js";
import { asUser, createAndPublish, createTestContext, type TestContext } from "./helpers.js";

// Stub Bedrock: echoes the artifact type and file count so we can assert it was
// generated from this specific version's content and stored per version.
class StubExplainer implements Explainer {
  public calls: ExplanationInput[] = [];
  async generate(input: ExplanationInput): Promise<string | null> {
    this.calls.push(input);
    return `summary of ${input.type} with ${input.fileList.length} file(s)`;
  }
}

let ctx: TestContext;
let stub: StubExplainer;

beforeAll(async () => {
  stub = new StubExplainer();
  ctx = await createTestContext(stub);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("per-version AI explanation", () => {
  it("generates an explanation at publish time and stores it on the version", async () => {
    const res = await createAndPublish(ctx.app, "alice", "explained-skill");
    expect(res.status).toBe(201);
    expect(stub.calls.length).toBeGreaterThan(0);

    const detail = (await (
      await ctx.app.request("/v1/artifacts/explained-skill", { headers: asUser("alice") })
    ).json()) as { explanation: string | null; versions: { explanation: string | null }[] };

    expect(detail.explanation).toBe("summary of CLAUDE_SKILL with 1 file(s)");
    expect(detail.versions[0]?.explanation).toBe("summary of CLAUDE_SKILL with 1 file(s)");
  });

  it("exposes the explanation on the single-version endpoint", async () => {
    const version = (await (
      await ctx.app.request("/v1/artifacts/explained-skill/versions/1", {
        headers: asUser("alice"),
      })
    ).json()) as { explanation: string | null };
    expect(version.explanation).toBe("summary of CLAUDE_SKILL with 1 file(s)");
  });
});
