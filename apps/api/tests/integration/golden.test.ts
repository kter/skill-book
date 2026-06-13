// Integration tests against a deployed environment (dev).
// Requires: API_URL, INTEGRATION_TEST_BYPASS_TOKEN, INTEGRATION_TEST_BYPASS_TOKEN_2
// Run via: make test-integration ENV=dev

import { describe, expect, it } from "vitest";
import { createZip } from "@skill-book/shared/zip";

const API_URL = process.env.API_URL;
const TOKEN_1 = process.env.INTEGRATION_TEST_BYPASS_TOKEN;
const TOKEN_2 = process.env.INTEGRATION_TEST_BYPASS_TOKEN_2;

const enc = new TextEncoder();
const runId = Date.now().toString(36);
const FAKE_AWS_KEY = "AKIA" + "IOSFODNN7EXAMPLE";

const describeIf = API_URL && TOKEN_1 && TOKEN_2 ? describe : describe.skip;

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  };
}

function skillZip(name: string, extra: Record<string, string> = {}): Uint8Array {
  const files: Record<string, string> = {
    "SKILL.md": `---\nname: ${name}\ndescription: integration test skill\n---\n\n# ${name}\n`,
    ...extra,
  };
  return createZip(
    Object.entries(files).map(([path, content]) => ({ path, data: enc.encode(content) })),
  );
}

async function stageAndPublish(token: string, name: string, zip: Uint8Array): Promise<Response> {
  const uploadRes = await fetch(`${API_URL}/v1/uploads`, authed(token, { method: "POST" }));
  expect(uploadRes.status).toBe(201);
  const upload = (await uploadRes.json()) as any as { key: string; url: string };
  const putRes = await fetch(upload.url, {
    method: "PUT",
    headers: { "content-type": "application/zip" },
    body: zip.buffer as ArrayBuffer,
  });
  expect(putRes.status).toBe(200);
  return fetch(
    `${API_URL}/v1/artifacts/${name}/versions`,
    authed(token, { method: "POST", body: JSON.stringify({ stagingKey: upload.key }) }),
  );
}

describeIf("deployed API golden path", () => {
  const name = `itest-skill-${runId}`;

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${API_URL}/v1/artifacts`);
    expect(res.status).toBe(401);
  });

  it("answers healthz", async () => {
    const res = await fetch(`${API_URL}/healthz`);
    expect(res.status).toBe(200);
  });

  it("creates, publishes, lists, and downloads an artifact", async () => {
    const createRes = await fetch(
      `${API_URL}/v1/artifacts`,
      authed(TOKEN_1!, {
        method: "POST",
        body: JSON.stringify({
          name,
          type: "CLAUDE_SKILL",
          description: "integration test artifact",
          tags: ["integration-test"],
        }),
      }),
    );
    expect(createRes.status).toBe(201);

    const publishRes = await stageAndPublish(TOKEN_1!, name, skillZip(name));
    expect(publishRes.status).toBe(201);
    const published = (await publishRes.json()) as any;
    expect(published.status).toBe("PUBLISHED");

    const listRes = await fetch(`${API_URL}/v1/artifacts?q=${name}`, authed(TOKEN_1!));
    const list = (await listRes.json()) as any;
    expect(list.artifacts.map((a: { name: string }) => a.name)).toContain(name);

    const dlRes = await fetch(
      `${API_URL}/v1/artifacts/${name}/download?client=cli`,
      authed(TOKEN_2!),
    );
    expect(dlRes.status).toBe(200);
    const dl = (await dlRes.json()) as any;
    const zipRes = await fetch(dl.url);
    expect(zipRes.status).toBe(200);
    expect(Number(zipRes.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("blocks a secret-laden upload and allows override", async () => {
    const blockedRes = await stageAndPublish(
      TOKEN_1!,
      name,
      skillZip(name, { "config.md": `key = "${FAKE_AWS_KEY}"` }),
    );
    expect(blockedRes.status).toBe(422);
    const blocked = (await blockedRes.json()) as any;
    expect(blocked.status).toBe("BLOCKED");
    expect(JSON.stringify(blocked)).not.toContain(FAKE_AWS_KEY);
    const fingerprint = blocked.findings[0].fingerprint;

    const overrideRes = await fetch(
      `${API_URL}/v1/artifacts/${name}/scan-overrides`,
      authed(TOKEN_1!, {
        method: "POST",
        body: JSON.stringify({ fingerprint, reason: "integration test fixture" }),
      }),
    );
    expect(overrideRes.status).toBe(201);

    const retryRes = await stageAndPublish(
      TOKEN_1!,
      name,
      skillZip(name, { "config.md": `key = "${FAKE_AWS_KEY}"` }),
    );
    expect(retryRes.status).toBe(201);
  });

  it("enforces owner-only publish (second user is rejected)", async () => {
    const res = await stageAndPublish(TOKEN_2!, name, skillZip(name));
    expect(res.status).toBe(403);
  });

  it("supports ratings from both test users", async () => {
    const r1 = await fetch(
      `${API_URL}/v1/artifacts/${name}/rating`,
      authed(TOKEN_1!, { method: "PUT", body: JSON.stringify({ stars: 4 }) }),
    );
    expect(r1.status).toBe(200);
    const r2 = await fetch(
      `${API_URL}/v1/artifacts/${name}/rating`,
      authed(TOKEN_2!, { method: "PUT", body: JSON.stringify({ stars: 2 }) }),
    );
    expect(r2.status).toBe(200);

    const detail = (await (
      await fetch(`${API_URL}/v1/artifacts/${name}`, authed(TOKEN_1!))
    ).json()) as any;
    expect(detail.ratingCount).toBe(2);
    expect(detail.ratingAverage).toBe(3);
  });
});
