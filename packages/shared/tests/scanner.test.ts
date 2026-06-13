import { describe, expect, it } from "vitest";
import {
  fingerprint,
  isProbablyBinary,
  maskSecret,
  scanFile,
  scanFiles,
  shannonEntropy,
} from "../src/scanner/index.js";

// All "secrets" below are synthetic test fixtures, not real credentials.
const FAKE_AWS_KEY_ID = "AKIA" + "IOSFODNN7EXAMPLE";
const FAKE_AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const FAKE_GITHUB_PAT = "ghp_" + "x".repeat(20) + "Y9z8W7v6U5t4S3r2"; // 36 chars after prefix
const FAKE_SLACK = "xoxb-1234567890-abcdefghijklmnop";
const FAKE_ANTHROPIC = "sk-ant-api03-abcdefghijklmnopqrstuvwx";
const FAKE_GOOGLE = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"; // 35 chars after AIza
const FAKE_STRIPE = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";

describe("scanner true positives", () => {
  it.each([
    ["aws-access-key-id", `key = "${FAKE_AWS_KEY_ID}"`],
    ["aws-secret-access-key", `aws_secret_access_key = "${FAKE_AWS_SECRET}"`],
    ["github-pat", `token: ${FAKE_GITHUB_PAT}`],
    ["slack-token", `SLACK_TOKEN=${FAKE_SLACK}`],
    ["anthropic-api-key", `ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`],
    ["google-api-key", `googleKey: "${FAKE_GOOGLE}"`],
    ["stripe-api-key", `stripe = "${FAKE_STRIPE}"`],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"],
  ])("detects %s", (ruleId, text) => {
    const findings = scanFile({ path: "config.md", text });
    expect(findings.map((f) => f.ruleId)).toContain(ruleId);
  });

  it("detects a generic high-entropy api key assignment", () => {
    const findings = scanFile({
      path: "notes.md",
      text: `api_key = "9fX2kQ8rT5wY7zB4nM6vC1pL3sD0gH8j"`,
    });
    expect(findings.map((f) => f.ruleId)).toContain("generic-api-key");
  });

  it("reports correct line numbers", () => {
    const text = `line one\nline two\nkey = "${FAKE_AWS_KEY_ID}"\n`;
    const findings = scanFile({ path: "a.md", text });
    expect(findings[0]?.line).toBe(3);
  });
});

describe("scanner false positives", () => {
  it.each([
    ["plain documentation", "Set your api_key in the dashboard settings."],
    ["low-entropy assignment", `password = "aaaaaaaaaaaaaaaaaaaa"`],
    ["lorem ipsum", "Lorem ipsum dolor sit amet, consectetur adipiscing elit."],
    ["the word AKIA alone", "AKIA is an AWS key prefix"],
    ["short tokens", `token = "abc123"`],
    ["markdown prose about secrets", "Never commit your AWS secret access key to git."],
  ])("does not flag %s", (_label, text) => {
    expect(scanFile({ path: "README.md", text })).toEqual([]);
  });
});

describe("fingerprints and masking", () => {
  it("fingerprint is stable across rescans", () => {
    const text = `key = "${FAKE_AWS_KEY_ID}"`;
    const [a] = scanFile({ path: "x.md", text });
    const [b] = scanFile({ path: "x.md", text: `// unrelated comment\n${text}` });
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("fingerprint differs across files and rules", () => {
    expect(fingerprint("a.md", "rule", "secret")).not.toBe(fingerprint("b.md", "rule", "secret"));
    expect(fingerprint("a.md", "rule1", "secret")).not.toBe(fingerprint("a.md", "rule2", "secret"));
  });

  it("masked match never contains the middle of the secret", () => {
    const findings = scanFile({ path: "x.md", text: `key = "${FAKE_AWS_KEY_ID}"` });
    const masked = findings[0]!.maskedMatch;
    expect(masked).not.toContain(FAKE_AWS_KEY_ID.slice(4, -4));
    expect(masked.length).toBeLessThanOrEqual(64);
  });

  it("maskSecret keeps at most 8 visible chars", () => {
    const masked = maskSecret("abcdefghijklmnopqrstuvwxyz");
    const visible = masked.replace(/\*/g, "");
    expect(visible.length).toBeLessThanOrEqual(8);
    expect(masked.startsWith("abcd")).toBe(true);
    expect(masked.endsWith("wxyz")).toBe(true);
  });

  it("fully masks short secrets", () => {
    expect(maskSecret("12345678")).toBe("********");
  });
});

describe("scanFiles", () => {
  it("deduplicates the same secret within a file", () => {
    const text = `a = "${FAKE_AWS_KEY_ID}"\nb = "${FAKE_AWS_KEY_ID}"`;
    const findings = scanFiles([{ path: "dup.md", text }]);
    expect(findings.filter((f) => f.ruleId === "aws-access-key-id")).toHaveLength(1);
  });

  it("keeps findings from multiple files", () => {
    const findings = scanFiles([
      { path: "a.md", text: `key = "${FAKE_AWS_KEY_ID}"` },
      { path: "b.md", text: `key = "${FAKE_AWS_KEY_ID}"` },
    ]);
    expect(findings).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("shannonEntropy distinguishes random from repeated", () => {
    expect(shannonEntropy("aaaaaaaa")).toBe(0);
    expect(shannonEntropy("9fX2kQ8rT5wY7zB4")).toBeGreaterThan(3.5);
  });

  it("isProbablyBinary detects NUL bytes", () => {
    expect(isProbablyBinary(new Uint8Array([104, 105, 0, 1]))).toBe(true);
    expect(isProbablyBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});
