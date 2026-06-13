import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createAndPublish,
  createTestContext,
  makeZipBuffer,
  stageZip,
  VALID_SKILL_MD,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;

const FAKE_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.cleanup();
});

async function createArtifact(user: string, name: string, type = "CLAUDE_SKILL") {
  const res = await ctx.app.request("/v1/artifacts", {
    method: "POST",
    headers: asUser(user),
    body: JSON.stringify({ name, type, description: "" }),
  });
  expect(res.status).toBe(201);
}

describe("publish state machine", () => {
  it("publishes a clean skill", async () => {
    const res = await createAndPublish(ctx.app, "alice", "clean-skill");
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("PUBLISHED");
    expect(body.version).toBe(1);
  });

  it("blocks a skill containing a planted AWS key, storing masked findings only", async () => {
    await createArtifact("alice", "leaky-skill");
    const stagingKey = await stageZip(
      ctx.app,
      "alice",
      makeZipBuffer({
        "SKILL.md": VALID_SKILL_MD("leaky-skill"),
        "config.md": `aws key: "${FAKE_AWS_KEY}"`,
      }),
    );
    const res = await ctx.app.request("/v1/artifacts/leaky-skill/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.status).toBe("BLOCKED");
    expect(body.findings.length).toBeGreaterThan(0);
    const finding = body.findings[0];
    expect(finding.ruleId).toBe("aws-access-key-id");
    expect(finding.maskedMatch).not.toContain(FAKE_AWS_KEY.slice(4, -4));
    expect(JSON.stringify(body)).not.toContain(FAKE_AWS_KEY);

    // The blocked version is recorded as audit history
    const versions = (await (
      await ctx.app.request("/v1/artifacts/leaky-skill/versions", { headers: asUser("alice") })
    ).json()) as any;
    expect(versions.versions[0].status).toBe("BLOCKED");
  });

  it("publishes after a fingerprint override, as the next version", async () => {
    const versionDetail = (await (
      await ctx.app.request("/v1/artifacts/leaky-skill/versions/1", { headers: asUser("alice") })
    ).json()) as any;
    const fingerprint = versionDetail.findings[0].fingerprint;

    const overrideRes = await ctx.app.request("/v1/artifacts/leaky-skill/scan-overrides", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ fingerprint, reason: "documented example key, not real" }),
    });
    expect(overrideRes.status).toBe(201);

    const stagingKey = await stageZip(
      ctx.app,
      "alice",
      makeZipBuffer({
        "SKILL.md": VALID_SKILL_MD("leaky-skill"),
        "config.md": `aws key: "${FAKE_AWS_KEY}"`,
      }),
    );
    const res = await ctx.app.request("/v1/artifacts/leaky-skill/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("PUBLISHED");
    expect(body.version).toBe(2);
  });

  it("rejects publish by non-owners", async () => {
    const stagingKey = await stageZip(
      ctx.app,
      "mallory",
      makeZipBuffer({ "SKILL.md": VALID_SKILL_MD("clean-skill") }),
    );
    const res = await ctx.app.request("/v1/artifacts/clean-skill/versions", {
      method: "POST",
      headers: asUser("mallory"),
      body: JSON.stringify({ stagingKey }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a stagingKey belonging to another user", async () => {
    const stagingKey = await stageZip(
      ctx.app,
      "bob",
      makeZipBuffer({ "SKILL.md": VALID_SKILL_MD("clean-skill") }),
    );
    const res = await ctx.app.request("/v1/artifacts/clean-skill/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects invalid zips", async () => {
    await createArtifact("alice", "badzip-skill");
    const uploadRes = await ctx.app.request("/v1/uploads", {
      method: "POST",
      headers: asUser("alice"),
    });
    const { key, url } = (await uploadRes.json()) as any;
    await ctx.app.request(url.replace("http://test.local", ""), {
      method: "PUT",
      body: "this is not a zip",
    });
    const res = await ctx.app.request("/v1/artifacts/badzip-skill/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey: key }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects structurally invalid artifacts (validation 422)", async () => {
    await createArtifact("alice", "invalid-structure");
    const stagingKey = await stageZip(
      ctx.app,
      "alice",
      makeZipBuffer({ "README.md": "no SKILL.md here" }),
    );
    const res = await ctx.app.request("/v1/artifacts/invalid-structure/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.details?.[0]).toMatch(/SKILL\.md/);
  });

  it("rejects an expired/missing staging key", async () => {
    const me = (await (
      await ctx.app.request("/v1/me", { headers: asUser("alice") })
    ).json()) as any;
    const res = await ctx.app.request("/v1/artifacts/clean-skill/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey: `staging/${me.id}/nonexistent.zip` }),
    });
    expect(res.status).toBe(404);
  });

  it("validates CLAUDE_MD artifacts require exactly CLAUDE.md", async () => {
    await createArtifact("alice", "md-rules", "CLAUDE_MD");
    const bad = await stageZip(ctx.app, "alice", makeZipBuffer({ "WRONG.md": "x" }));
    const badRes = await ctx.app.request("/v1/artifacts/md-rules/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey: bad }),
    });
    expect(badRes.status).toBe(422);

    const good = await stageZip(ctx.app, "alice", makeZipBuffer({ "CLAUDE.md": "# rules" }));
    const goodRes = await ctx.app.request("/v1/artifacts/md-rules/versions", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({ stagingKey: good }),
    });
    expect(goodRes.status).toBe(201);
  });
});

describe("download", () => {
  it("returns a download URL and counts the event", async () => {
    await createAndPublish(ctx.app, "alice", "download-me");

    const res = await ctx.app.request("/v1/artifacts/download-me/download?client=cli", {
      headers: asUser("bob"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.fileName).toBe("download-me-v1.zip");
    expect(body.url).toContain("/v1/local-storage/artifacts/");

    await ctx.app.request("/v1/artifacts/download-me/download", { headers: asUser("carol") });

    const detail = (await (
      await ctx.app.request("/v1/artifacts/download-me", { headers: asUser("alice") })
    ).json()) as any;
    expect(detail.downloadCount).toBe(2);

    // the URL actually serves the zip
    const dl = await ctx.app.request(body.url.replace("http://test.local", ""));
    expect(dl.status).toBe(200);
  });

  it("404s when no published version exists", async () => {
    await createArtifact("alice", "never-published");
    const res = await ctx.app.request("/v1/artifacts/never-published/download", {
      headers: asUser("alice"),
    });
    expect(res.status).toBe(404);
  });

  it("downloads a specific historical version", async () => {
    const res = await ctx.app.request("/v1/artifacts/download-me/versions/1/download", {
      headers: asUser("bob"),
    });
    expect(res.status).toBe(200);
  });
});
