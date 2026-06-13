import { createHash } from "node:crypto";
import type { ScanFinding } from "../types.js";
import { SCAN_RULES, type ScanRule } from "./rules.js";

export type { ScanRule } from "./rules.js";
export { SCAN_RULES } from "./rules.js";

export interface ScannableFile {
  path: string;
  text: string;
}

export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function maskSecret(secret: string): string {
  const capped = secret.slice(0, 64);
  if (capped.length <= 8) {
    return "*".repeat(capped.length);
  }
  return `${capped.slice(0, 4)}${"*".repeat(Math.min(capped.length - 8, 24))}${capped.slice(-4)}`;
}

/**
 * Stable across re-uploads and unrelated edits: derived from file path, rule,
 * and the secret itself (never stored raw — only this hash).
 */
export function fingerprint(filePath: string, ruleId: string, secret: string): string {
  return createHash("sha256").update(`${filePath}:${ruleId}:${secret}`).digest("hex").slice(0, 32);
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function ruleMatches(rule: ScanRule, file: ScannableFile): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (rule.keywords && !rule.keywords.some((kw) => file.text.toLowerCase().includes(kw))) {
    return findings;
  }
  const regex = new RegExp(rule.regex.source, rule.regex.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(file.text)) !== null) {
    const secret = rule.secretGroup != null ? match[rule.secretGroup] : match[0];
    if (!secret) continue;
    if (rule.entropy != null && shannonEntropy(secret) < rule.entropy) continue;
    findings.push({
      ruleId: rule.id,
      filePath: file.path,
      line: lineNumberAt(file.text, match.index),
      maskedMatch: maskSecret(secret),
      fingerprint: fingerprint(file.path, rule.id, secret),
    });
    // Guard against zero-width matches looping forever
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }
  return findings;
}

export function scanFile(file: ScannableFile): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const rule of SCAN_RULES) {
    findings.push(...ruleMatches(rule, file));
  }
  return findings;
}

export function scanFiles(files: ScannableFile[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const file of files) {
    findings.push(...scanFile(file));
  }
  // Deduplicate by fingerprint (the same secret repeated in one file counts once)
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.fingerprint)) return false;
    seen.add(f.fingerprint);
    return true;
  });
}

/** Heuristic: treat files containing NUL bytes as binary and skip scanning them. */
export function isProbablyBinary(data: Uint8Array): boolean {
  const sample = data.subarray(0, 8000);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
