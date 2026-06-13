"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { ArtifactDetail } from "@skill-book/shared";
import { StarRating } from "@/components/StarRating";
import { api, ApiError } from "@/lib/api";

/** Drop a leading YAML frontmatter block so the preview shows the document body
 *  instead of rendering `name:`/`description:` lines and a stray `<hr>`. */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^\s*---\n[\s\S]*?\n---\n?/, "");
}

function extractPreviewMarkdown(contentText: string | null): string | null {
  if (!contentText) return null;
  // contentText concatenates files as "--- path ---" sections; show the first markdown section.
  const sections = contentText.split(/\n--- (.+?) ---\n/);
  if (sections.length <= 1) return stripFrontmatter(contentText);
  for (let i = 1; i < sections.length; i += 2) {
    const file = sections[i] ?? "";
    if (/(^|\/)(SKILL|CLAUDE|AGENTS|README)\.md$/i.test(file)) {
      return sections[i + 1] != null ? stripFrontmatter(sections[i + 1]!) : null;
    }
  }
  return sections[2] != null ? stripFrontmatter(sections[2]!) : null;
}

function ArtifactInner() {
  const params = useSearchParams();
  const router = useRouter();
  const name = params.get("name") ?? "";
  const publishedVersion = params.get("published");
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forkName, setForkName] = useState<string | null>(null);

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

  const submitFork = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = forkName?.trim();
    if (!target || !detail) return;
    try {
      await api.createArtifact({
        name: target,
        type: detail.type,
        description: `Fork of ${name}: ${detail.description}`,
        tags: detail.tags,
        forkedFromArtifactId: detail.id,
      });
      router.push(`/artifact/?name=${encodeURIComponent(target)}`);
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
          {forkName === null ? (
            <button
              type="button"
              className="btn"
              onClick={() => setForkName(`${name}-fork`)}
              data-testid="fork-button"
            >
              ⑂ Fork
            </button>
          ) : (
            <form className="fork-form" onSubmit={submitFork}>
              <input
                type="text"
                value={forkName}
                onChange={(e) => setForkName(e.target.value)}
                aria-label="Fork name (kebab-case)"
                placeholder="my-fork"
                data-testid="fork-name-input"
                autoFocus
              />
              <button type="submit" className="btn btn-primary" data-testid="fork-confirm">
                Create fork
              </button>
              <button type="button" className="btn" onClick={() => setForkName(null)}>
                Cancel
              </button>
            </form>
          )}
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
          average {detail.ratingAverage?.toFixed(1) ?? "—"} ({detail.ratingCount}{" "}
          {detail.ratingCount === 1 ? "rating" : "ratings"})
        </span>
      </p>

      {detail.latestVersion != null ? (
        <>
          <h2>Install</h2>
          <div className="card">
            <code data-testid="install-oneliner">npx @skill-book/cli install {detail.name}</code>
          </div>
        </>
      ) : (
        <>
          <h2>Publish a version</h2>
          <div className="card" data-testid="no-version-hint">
            No version has been published yet — nothing to install.
            {detail.forkedFromName ? (
              <>
                {" "}
                Run <code>npx @skill-book/cli install {detail.forkedFromName}</code> to get the
                source, modify it, then <code>npx @skill-book/cli push --name {detail.name}</code>{" "}
                to publish v1.
              </>
            ) : (
              <>
                {" "}
                Run <code>npx @skill-book/cli push --name {detail.name}</code> to publish the first
                version.
              </>
            )}
          </div>
        </>
      )}

      {detail.explanation && (
        <>
          <h2>概要（AI生成）</h2>
          <div className="ai-summary" data-testid="ai-summary">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {detail.explanation}
            </ReactMarkdown>
          </div>
        </>
      )}

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
          </tr>
        </thead>
        <tbody>
          {detail.versions.length === 0 && (
            <tr>
              <td colSpan={5} className="form-hint" data-testid="no-versions">
                No versions yet.
              </td>
            </tr>
          )}
          {detail.versions.map((version) => (
            <tr key={version.id}>
              <td>v{version.version}</td>
              <td>
                <span className={`status-pill status-${version.status}`}>{version.status}</span>
              </td>
              <td>{version.fileCount}</td>
              <td>{(version.totalSizeBytes / 1024).toFixed(1)} KB</td>
              <td>{version.publishedAt ? new Date(version.publishedAt).toLocaleString() : "—"}</td>
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
