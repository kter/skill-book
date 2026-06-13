"use client";

import type {
  ArtifactDetail,
  ArtifactSummary,
  PublishResult,
  ScanFinding,
} from "@skill-book/shared";
import { getValidSession } from "./auth";
import { config } from "./config";

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
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (config.devAuthBypass) {
    headers.set("X-Dev-User", "e2e-user");
  } else {
    const session = await getValidSession();
    if (!session) {
      window.location.href = "/login/";
      throw new ApiError(401, "not signed in");
    }
    headers.set("Authorization", `Bearer ${session.idToken}`);
  }
  const res = await fetch(`${config.apiUrl}${path}`, { ...init, headers });
  const body = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText, body);
  }
  return body as T;
}

export interface PublishBlockedBody {
  status: "BLOCKED";
  findings: ScanFinding[];
}

export const api = {
  me: () => apiFetch<{ id: string; email: string; displayName: string | null }>("/v1/me"),

  listArtifacts: (params: { q?: string; tag?: string; type?: string; sort?: string } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    const qs = query.toString();
    return apiFetch<{ artifacts: ArtifactSummary[] }>(`/v1/artifacts${qs ? `?${qs}` : ""}`);
  },

  getArtifact: (name: string) => apiFetch<ArtifactDetail>(`/v1/artifacts/${name}`),

  createArtifact: (input: {
    name: string;
    type: string;
    description: string;
    tags: string[];
    forkedFromArtifactId?: string;
  }) =>
    apiFetch<{ id: string; name: string }>("/v1/artifacts", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  requestUpload: () => apiFetch<{ key: string; url: string }>("/v1/uploads", { method: "POST" }),

  publishVersion: (name: string, stagingKey: string, message?: string) =>
    apiFetch<PublishResult>(`/v1/artifacts/${name}/versions`, {
      method: "POST",
      body: JSON.stringify({ stagingKey, message }),
    }),

  addScanOverride: (name: string, fingerprint: string, reason: string) =>
    apiFetch<{ ok: boolean }>(`/v1/artifacts/${name}/scan-overrides`, {
      method: "POST",
      body: JSON.stringify({ fingerprint, reason }),
    }),

  rate: (name: string, stars: number) =>
    apiFetch<{ ok: boolean }>(`/v1/artifacts/${name}/rating`, {
      method: "PUT",
      body: JSON.stringify({ stars }),
    }),

  downloadUrl: (name: string, version?: number) =>
    apiFetch<{ url: string; fileName: string }>(
      version != null
        ? `/v1/artifacts/${name}/versions/${version}/download`
        : `/v1/artifacts/${name}/download`,
    ),

  tags: () => apiFetch<{ tags: string[] }>("/v1/tags"),
};

/** Upload a zip to the staging URL the API handed out. */
export async function uploadZip(url: string, zip: Uint8Array): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/zip" },
    body: zip.buffer as ArrayBuffer,
  });
  if (!res.ok) {
    throw new ApiError(res.status, "staging upload failed");
  }
}
