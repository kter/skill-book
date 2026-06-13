import type {
  ArtifactDetail,
  ArtifactSummary,
  PublishResult,
  ScanFinding,
} from "@skill-book/shared";
import { getBearerToken } from "./auth.js";
import { loadCliConfig } from "./config.js";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = loadCliConfig();
  const token = await getBearerToken();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, (body.error as string) ?? `HTTP ${res.status}`, body);
  }
  return body as T;
}

export const api = {
  me: () => apiFetch<{ id: string; email: string }>("/v1/me"),
  list: (query: Record<string, string> = {}) => {
    const params = new URLSearchParams(query);
    const qs = params.toString();
    return apiFetch<{ artifacts: ArtifactSummary[] }>(`/v1/artifacts${qs ? `?${qs}` : ""}`);
  },
  get: (name: string) => apiFetch<ArtifactDetail>(`/v1/artifacts/${name}`),
  create: (input: { name: string; type: string; description: string; tags: string[] }) =>
    apiFetch<{ id: string }>("/v1/artifacts", { method: "POST", body: JSON.stringify(input) }),
  requestUpload: () => apiFetch<{ key: string; url: string }>("/v1/uploads", { method: "POST" }),
  publish: (name: string, stagingKey: string, message?: string) =>
    apiFetch<PublishResult>(`/v1/artifacts/${name}/versions`, {
      method: "POST",
      body: JSON.stringify({ stagingKey, message }),
    }),
  addOverride: (name: string, fingerprint: string, reason: string) =>
    apiFetch(`/v1/artifacts/${name}/scan-overrides`, {
      method: "POST",
      body: JSON.stringify({ fingerprint, reason }),
    }),
  downloadInfo: (name: string, version?: number) =>
    apiFetch<{ url: string; fileName: string; version: number; type: string; name: string }>(
      version != null
        ? `/v1/artifacts/${name}/versions/${version}/download?client=cli`
        : `/v1/artifacts/${name}/download?client=cli`,
    ),
};

export function printFindings(findings: ScanFinding[]): void {
  console.error("\nPotential secrets detected:\n");
  for (const finding of findings) {
    console.error(`  [${finding.ruleId}] ${finding.filePath}:${finding.line}`);
    console.error(`      match:       ${finding.maskedMatch}`);
    console.error(`      fingerprint: ${finding.fingerprint}\n`);
  }
}
