import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createAndPublish, createTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("auth and profile", () => {
  it("identifies the local dev user", async () => {
    const res = await ctx.app.request("/v1/me", { headers: asUser("alice") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.email).toBe("alice@local.test");
  });

  it("healthz requires no auth", async () => {
    const res = await ctx.app.request("/healthz");
    expect(res.status).toBe(200);
  });
});

describe("artifact creation", () => {
  it("creates a typed artifact", async () => {
    const res = await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({
        name: "create-test",
        type: "CLAUDE_MD",
        description: "desc",
        tags: ["productivity"],
      }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects duplicate names", async () => {
    const payload = { name: "dup-test", type: "CLAUDE_MD", description: "" };
    await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify(payload),
    });
    const res = await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("bob"),
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(409);
  });

  it.each([
    ["bad slug", { name: "Bad Name!", type: "CLAUDE_MD" }],
    ["bad type", { name: "ok-name", type: "WHATEVER" }],
    ["missing name", { type: "CLAUDE_MD" }],
  ])("rejects invalid input: %s", async (_label, payload) => {
    const res = await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a fork of a nonexistent artifact", async () => {
    const res = await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("alice"),
      body: JSON.stringify({
        name: "fork-orphan",
        type: "CLAUDE_MD",
        forkedFromArtifactId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("metadata updates", () => {
  it("allows the owner to update description and tags", async () => {
    await createAndPublish(ctx.app, "carol", "patch-target");
    const res = await ctx.app.request("/v1/artifacts/patch-target", {
      method: "PATCH",
      headers: asUser("carol"),
      body: JSON.stringify({ description: "updated", tags: ["new-tag"] }),
    });
    expect(res.status).toBe(200);
    const detail = (await (
      await ctx.app.request("/v1/artifacts/patch-target", { headers: asUser("carol") })
    ).json()) as any;
    expect(detail.description).toBe("updated");
    expect(detail.tags).toEqual(["new-tag"]);
  });

  it("rejects updates from non-owners", async () => {
    const res = await ctx.app.request("/v1/artifacts/patch-target", {
      method: "PATCH",
      headers: asUser("mallory"),
      body: JSON.stringify({ description: "hijack" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("list and search", () => {
  beforeAll(async () => {
    await createAndPublish(ctx.app, "alice", "search-alpha", {
      tags: ["terraform"],
      files: {
        "SKILL.md": `---\nname: search-alpha\ndescription: terraform helper\n---\nUnique keyword zebrastripe here.`,
      },
    });
    await createAndPublish(ctx.app, "bob", "search-beta", {
      type: "AGENTS_MD",
      files: { "AGENTS.md": "# agents rules" },
      tags: ["agents"],
    });
  });

  it("lists artifacts with aggregates", async () => {
    const res = await ctx.app.request("/v1/artifacts", { headers: asUser("alice") });
    expect(res.status).toBe(200);
    const { artifacts } = (await res.json()) as any;
    const alpha = artifacts.find((a: { name: string }) => a.name === "search-alpha");
    expect(alpha).toBeDefined();
    expect(alpha.latestVersion).toBe(1);
    expect(alpha.tags).toContain("terraform");
    expect(alpha.ownerDisplayName).toBe("alice");
  });

  it("filters by type", async () => {
    const res = await ctx.app.request("/v1/artifacts?type=AGENTS_MD", { headers: asUser("alice") });
    const { artifacts } = (await res.json()) as any;
    expect(artifacts.every((a: { type: string }) => a.type === "AGENTS_MD")).toBe(true);
    expect(artifacts.some((a: { name: string }) => a.name === "search-beta")).toBe(true);
  });

  it("filters by tag", async () => {
    const res = await ctx.app.request("/v1/artifacts?tag=terraform", { headers: asUser("alice") });
    const { artifacts } = (await res.json()) as any;
    expect(artifacts.map((a: { name: string }) => a.name)).toContain("search-alpha");
    expect(artifacts.map((a: { name: string }) => a.name)).not.toContain("search-beta");
  });

  it("searches name, description, and published content", async () => {
    const byName = (await (
      await ctx.app.request("/v1/artifacts?q=search-alpha", { headers: asUser("alice") })
    ).json()) as any;
    expect(byName.artifacts).toHaveLength(1);

    const byContent = (await (
      await ctx.app.request("/v1/artifacts?q=zebrastripe", { headers: asUser("alice") })
    ).json()) as any;
    expect(byContent.artifacts.map((a: { name: string }) => a.name)).toEqual(["search-alpha"]);
  });

  it("lists distinct tags", async () => {
    const res = await ctx.app.request("/v1/tags", { headers: asUser("alice") });
    const { tags } = (await res.json()) as any;
    expect(tags).toContain("terraform");
    expect(tags).toContain("agents");
  });
});

describe("ratings", () => {
  beforeAll(async () => {
    await createAndPublish(ctx.app, "alice", "rate-me");
  });

  it("upserts one rating per user", async () => {
    const first = await ctx.app.request("/v1/artifacts/rate-me/rating", {
      method: "PUT",
      headers: asUser("bob"),
      body: JSON.stringify({ stars: 5 }),
    });
    expect(first.status).toBe(200);
    const second = await ctx.app.request("/v1/artifacts/rate-me/rating", {
      method: "PUT",
      headers: asUser("bob"),
      body: JSON.stringify({ stars: 3 }),
    });
    expect(second.status).toBe(200);

    const detail = (await (
      await ctx.app.request("/v1/artifacts/rate-me", { headers: asUser("bob") })
    ).json()) as any;
    expect(detail.ratingCount).toBe(1);
    expect(detail.ratingAverage).toBe(3);
    expect(detail.myRating).toBe(3);
  });

  it("aggregates ratings across users", async () => {
    await ctx.app.request("/v1/artifacts/rate-me/rating", {
      method: "PUT",
      headers: asUser("carol"),
      body: JSON.stringify({ stars: 5 }),
    });
    const detail = (await (
      await ctx.app.request("/v1/artifacts/rate-me", { headers: asUser("alice") })
    ).json()) as any;
    expect(detail.ratingCount).toBe(2);
    expect(detail.ratingAverage).toBe(4);
  });

  it("rejects out-of-range stars", async () => {
    const res = await ctx.app.request("/v1/artifacts/rate-me/rating", {
      method: "PUT",
      headers: asUser("bob"),
      body: JSON.stringify({ stars: 6 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("forks", () => {
  it("records and displays lineage", async () => {
    await createAndPublish(ctx.app, "alice", "fork-source");
    const detail = (await (
      await ctx.app.request("/v1/artifacts/fork-source", { headers: asUser("alice") })
    ).json()) as any;

    const res = await ctx.app.request("/v1/artifacts", {
      method: "POST",
      headers: asUser("bob"),
      body: JSON.stringify({
        name: "fork-child",
        type: "CLAUDE_SKILL",
        description: "fork of fork-source",
        forkedFromArtifactId: detail.id,
      }),
    });
    expect(res.status).toBe(201);

    const child = (await (
      await ctx.app.request("/v1/artifacts/fork-child", { headers: asUser("bob") })
    ).json()) as any;
    expect(child.forkedFromName).toBe("fork-source");

    const source = (await (
      await ctx.app.request("/v1/artifacts/fork-source", { headers: asUser("alice") })
    ).json()) as any;
    expect(source.forks.map((f: { name: string }) => f.name)).toContain("fork-child");
  });
});
