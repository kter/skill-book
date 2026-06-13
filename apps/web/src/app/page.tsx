"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactSummary } from "@skill-book/shared";
import { ArtifactCard } from "@/components/ArtifactCard";
import { api, ApiError } from "@/lib/api";

export default function BrowsePage() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("updated");
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses overwriting newer filter results
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const [list, tags] = await Promise.all([
        api.listArtifacts({ q, tag, type, sort }),
        api.tags(),
      ]);
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      setArtifacts(list.artifacts);
      setAllTags(tags.tags);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if (err instanceof ApiError && err.status === 401) return; // redirected to login
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [q, tag, type, sort]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  return (
    <div>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search skills, CLAUDE.md, AGENTS.md..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} data-testid="type-filter">
          <option value="">All types</option>
          <option value="CLAUDE_SKILL">Claude Skill</option>
          <option value="CLAUDE_MD">CLAUDE.md</option>
          <option value="AGENTS_MD">AGENTS.md</option>
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} data-testid="tag-filter">
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} data-testid="sort-select">
          <option value="updated">Recently updated</option>
          <option value="downloads">Most downloaded</option>
          <option value="stars">Highest rated</option>
        </select>
      </div>

      {error && <div className="error-box">{error}</div>}
      {artifacts === null && !error && <p>Loading…</p>}
      {artifacts !== null && artifacts.length === 0 && (
        <p data-testid="empty-state">No artifacts found. Be the first to upload one!</p>
      )}
      <div className="artifact-grid" data-testid="artifact-grid">
        {artifacts?.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}
