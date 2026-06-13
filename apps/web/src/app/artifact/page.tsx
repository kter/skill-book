"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ArtifactDetail } from "@skill-book/shared";
import { StarRating } from "@/components/StarRating";
import { api, ApiError } from "@/lib/api";

function extractPreviewMarkdown(contentText: string | null): string | null {
  if (!contentText) return null;
  // contentText concatenates files as "--- path ---" sections; show the first markdown section.
  const sections = contentText.split(/\n--- (.+?) ---\n/);
  if (sections.length <= 1) return contentText;
  for (let i = 1; i < sections.length; i += 2) {
    const file = sections[i] ?? "";
    if (/(^|\/)(SKILL|CLAUDE|AGENTS|README)\.md$/i.test(file)) {
      return sections[i + 1] ?? null;
    }
  }
  return sections[2] ?? null;
}

function ArtifactInner() {
  const params = useSearchParams();
  const router = useRouter();
  const name = params.get("name") ?? "";
  const publishedVersion = params.get("published");
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) return;
    try {
      setDetail(await api.getArtifact(name));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const rate = async (stars: number) => {
    await api.rate(name, stars);
    setNotice(`Rated ${stars} star(s).`);
    await load();
  };

  const download = async (version?: number) => {
    const { url } = await api.downloadUrl(name, version);
    window.location.href = url;
    setTimeout(load, 800); // refresh the download counter
  };

  const fork = async () => {
    const forkName = window.prompt("Name for your fork (kebab-case):", `${name}-fork`);
    if (!forkName || !detail) return;
    try {
      await api.createArtifact({
        name: forkName,
        type: detail.type,
        description: `Fork of ${name}: ${detail.description}`,
        tags: detail.tags,
        forkedFromArtifactId: detail.id,
      });
      setNotice(
        `Fork "${forkName}" created. Download this artifact, modify it, and publish to your fork.`,
      );
      router.push(`/artifact/?name=${encodeURIComponent(forkName)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!name) return <div className="error-box">No artifact specified.</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!detail) return <p>Loading…</p>;

  const preview = extractPreviewMarkdown(detail.contentPreview);

  return (
    <div>
      {publishedVersion && (
        <div className="success-box" data-testid="publish-success">
          Version {publishedVersion} published successfully.
        </div>
      )}
      {notice && (
        <div className="success-box" data-testid="notice">
          {notice}
        </div>
      )}
      <div className="detail-header">
        <h1 data-testid="artifact-name">{detail.name}</h1>
        <span className={`badge type-${detail.type}`}>{detail.type}</span>
        <div className="detail-actions">
          <button type="button" className="btn" onClick={fork} data-testid="fork-button">
            ⑂ Fork
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => download()}
            disabled={detail.latestVersion == null}
            data-testid="download-button"
          >
            ⬇ Download zip
          </button>
        </div>
      </div>

      <div className="detail-meta">
        by {detail.ownerDisplayName ?? "unknown"} · ⬇ {detail.downloadCount} downloads · updated{" "}
        {new Date(detail.updatedAt).toLocaleDateString()}
        {detail.forkedFromName && (
          <>
            {" "}
            · ⑂ forked from{" "}
            <a href={`/artifact/?name=${encodeURIComponent(detail.forkedFromName)}`}>
              {detail.forkedFromName}
            </a>
          </>
        )}
      </div>

      <p data-testid="artifact-description">{detail.description}</p>
      <div>
        {detail.tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
          </span>
        ))}
      </div>

      <p>
        Your rating: <StarRating value={detail.myRating} onRate={rate} />{" "}
        <span className="form-hint">
          average {detail.ratingAverage?.toFixed(1) ?? "—"} ({detail.ratingCount} ratings)
        </span>
      </p>

      <h2>Install</h2>
      <div className="card">
        <code data-testid="install-oneliner">npx @skill-book/cli install {detail.name}</code>
      </div>

      {preview && (
        <>
          <h2>Preview</h2>
          <div className="markdown-preview" data-testid="markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {preview}
            </ReactMarkdown>
          </div>
        </>
      )}

      {detail.forks.length > 0 && (
        <>
          <h2>Forks</h2>
          <ul data-testid="forks-list">
            {detail.forks.map((forkEntry) => (
              <li key={forkEntry.id}>
                <a href={`/artifact/?name=${encodeURIComponent(forkEntry.name)}`}>
                  {forkEntry.name}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Versions</h2>
      <table className="version-table" data-testid="version-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Files</th>
            <th>Size</th>
            <th>Published</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {detail.versions.map((version) => (
            <tr key={version.id}>
              <td>v{version.version}</td>
              <td>
                <span className={`status-pill status-${version.status}`}>{version.status}</span>
              </td>
              <td>{version.fileCount}</td>
              <td>{(version.totalSizeBytes / 1024).toFixed(1)} KB</td>
              <td>{version.publishedAt ? new Date(version.publishedAt).toLocaleString() : "—"}</td>
              <td>
                {version.status === "PUBLISHED" && (
                  <button type="button" className="btn" onClick={() => download(version.version)}>
                    ⬇
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ArtifactPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ArtifactInner />
    </Suspense>
  );
}
