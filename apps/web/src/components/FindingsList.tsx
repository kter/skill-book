"use client";

import { useState } from "react";
import type { ScanFinding } from "@skill-book/shared";

export function FindingsList({
  findings,
  onOverrideAndRetry,
  busy,
}: {
  findings: ScanFinding[];
  onOverrideAndRetry: (fingerprints: string[], reason: string) => void;
  busy: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");

  const toggle = (fingerprint: string) => {
    const next = new Set(checked);
    if (next.has(fingerprint)) {
      next.delete(fingerprint);
    } else {
      next.add(fingerprint);
    }
    setChecked(next);
  };

  return (
    <div data-testid="findings-list">
      <div className="error-box">
        Upload blocked: {findings.length} potential secret(s) detected. Remove them and re-upload,
        or mark confirmed false positives below and retry.
      </div>
      {findings.map((finding) => (
        <div key={finding.fingerprint} className="finding-item" data-testid="finding-item">
          <label style={{ display: "flex", gap: 8, alignItems: "baseline", margin: 0 }}>
            <input
              type="checkbox"
              checked={checked.has(finding.fingerprint)}
              onChange={() => toggle(finding.fingerprint)}
              data-testid={`finding-checkbox-${finding.fingerprint}`}
            />
            <span>
              <strong>{finding.ruleId}</strong> in <code>{finding.filePath}</code> line{" "}
              {finding.line}: <code>{finding.maskedMatch}</code>
            </span>
          </label>
        </div>
      ))}
      <label>Override reason (required)</label>
      <input
        type="text"
        value={reason}
        placeholder="e.g. documented example value, not a real credential"
        onChange={(e) => setReason(e.target.value)}
        data-testid="override-reason"
      />
      <p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || checked.size === 0 || reason.trim() === ""}
          onClick={() => onOverrideAndRetry([...checked], reason.trim())}
          data-testid="override-and-retry"
        >
          Mark as false positive &amp; retry
        </button>
      </p>
    </div>
  );
}
