"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ScanFinding } from "@skill-book/shared";
import { createZip } from "@skill-book/shared/zip";
import { FindingsList } from "@/components/FindingsList";
import { api, ApiError, uploadZip } from "@/lib/api";
import { detectArtifactType, suggestName, type PickedFile } from "@/lib/artifactFiles";

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("CLAUDE_SKILL");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<ScanFinding[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const ingestFileList = async (fileList: FileList | File[]) => {
    const picked: PickedFile[] = [];
    for (const file of Array.from(fileList)) {
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      picked.push({
        path: relPath && relPath !== "" ? relPath : file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }
    setFiles(picked);
    setFindings(null);
    setError(null);
    const paths = picked.map((p) => p.path);
    const detected = detectArtifactType(paths);
    if (detected) setType(detected);
    if (!name) setName(suggestName(paths));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      await ingestFileList(e.dataTransfer.files);
    }
  };

  const publish = async (after?: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      if (after) await after();
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Create the artifact entry if it doesn't exist yet (409 = already ours or someone else's;
      // the publish endpoint enforces ownership either way).
      try {
        await api.createArtifact({ name, type, description, tags: tagList });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
      const zip = createZip(files.map((f) => ({ path: f.path, data: f.data })));
      const upload = await api.requestUpload();
      await uploadZip(upload.url, zip);
      const result = await api.publishVersion(name, upload.key);
      if (result.status === "PUBLISHED") {
        router.push(`/artifact/?name=${encodeURIComponent(name)}&published=${result.version}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.body.findings)) {
        setFindings(err.body.findings as ScanFinding[]);
      } else if (err instanceof ApiError && Array.isArray(err.body.details)) {
        setError(`${err.message}\n${(err.body.details as string[]).join("\n")}`);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const overrideAndRetry = (fingerprints: string[], reason: string) =>
    publish(async () => {
      for (const fingerprint of fingerprints) {
        await api.addScanOverride(name, fingerprint, reason);
      }
      setFindings(null);
    });

  return (
    <div>
      <h1>Upload an artifact</h1>
      <p className="form-hint">
        Share a Claude Skill (a folder containing SKILL.md), a CLAUDE.md, or an AGENTS.md with the
        team. Uploads are scanned for secrets before publishing.
      </p>

      <div
        className={`drop-zone${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        data-testid="drop-zone"
      >
        {files.length === 0 ? (
          <>
            <p>Drag &amp; drop files here, or click to choose files</p>
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                dirInputRef.current?.click();
              }}
              data-testid="pick-folder"
            >
              Choose a skill folder
            </button>
          </>
        ) : (
          <p data-testid="picked-count">{files.length} file(s) selected</p>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => e.target.files && ingestFileList(e.target.files)}
      />
      <input
        ref={dirInputRef}
        type="file"
        hidden
        data-testid="folder-input"
        // @ts-expect-error non-standard attribute for directory picking
        webkitdirectory=""
        onChange={(e) => e.target.files && ingestFileList(e.target.files)}
      />

      {files.length > 0 && (
        <div className="file-list" data-testid="file-list">
          {files.map((f) => (
            <div key={f.path}>
              {f.path} ({f.data.length} bytes)
            </div>
          ))}
        </div>
      )}

      <label htmlFor="artifact-name">Name (kebab-case slug)</label>
      <input
        id="artifact-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="my-useful-skill"
        data-testid="name-input"
      />

      <label htmlFor="artifact-type">Type</label>
      <select
        id="artifact-type"
        value={type}
        onChange={(e) => setType(e.target.value)}
        data-testid="type-input"
      >
        <option value="CLAUDE_SKILL">Claude Skill (directory with SKILL.md)</option>
        <option value="CLAUDE_MD">CLAUDE.md</option>
        <option value="AGENTS_MD">AGENTS.md</option>
      </select>

      <label htmlFor="artifact-description">Description</label>
      <textarea
        id="artifact-description"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        data-testid="description-input"
      />

      <label htmlFor="artifact-tags">Tags (comma-separated)</label>
      <input
        id="artifact-tags"
        type="text"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="terraform, productivity"
        data-testid="tags-input"
      />

      {error && (
        <div className="error-box" data-testid="upload-error">
          {error}
        </div>
      )}
      {findings && (
        <FindingsList findings={findings} onOverrideAndRetry={overrideAndRetry} busy={busy} />
      )}

      <p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || files.length === 0 || name.trim() === ""}
          onClick={() => publish()}
          data-testid="publish-button"
        >
          {busy ? "Publishing…" : "Scan & publish"}
        </button>
      </p>
    </div>
  );
}
