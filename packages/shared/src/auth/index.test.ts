import { describe, expect, it } from "vitest";
import { emailDomainNotAllowedMessage, isEmailDomainAllowed } from "./index.js";

describe("isEmailDomainAllowed", () => {
  it("allows whitelisted domains", () => {
    expect(isEmailDomainAllowed("alice@tomohiko.io")).toBe(true);
    expect(isEmailDomainAllowed("bob@mbk-digital.co.jp")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isEmailDomainAllowed("Carol@Tomohiko.IO")).toBe(true);
    expect(isEmailDomainAllowed("dave@MBK-Digital.Co.JP")).toBe(true);
  });

  it("rejects non-whitelisted domains", () => {
    expect(isEmailDomainAllowed("eve@gmail.com")).toBe(false);
    expect(isEmailDomainAllowed("mallory@example.com")).toBe(false);
  });

  it("rejects lookalike / subdomain spoofs", () => {
    expect(isEmailDomainAllowed("x@evil.tomohiko.io.attacker.com")).toBe(false);
    expect(isEmailDomainAllowed("x@tomohiko.io.attacker.com")).toBe(false);
    expect(isEmailDomainAllowed("x@nottomohiko.io")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isEmailDomainAllowed("not-an-email")).toBe(false);
    expect(isEmailDomainAllowed("")).toBe(false);
    expect(isEmailDomainAllowed("trailing@tomohiko.io ".trim())).toBe(true);
    expect(isEmailDomainAllowed("@tomohiko.io")).toBe(true);
    expect(isEmailDomainAllowed("noat.tomohiko.io")).toBe(false);
  });
});

describe("emailDomainNotAllowedMessage", () => {
  it("does not disclose the allowed domains", () => {
    const msg = emailDomainNotAllowedMessage();
    expect(msg).not.toContain("tomohiko.io");
    expect(msg).not.toContain("mbk-digital.co.jp");
    expect(msg.length).toBeGreaterThan(0);
  });
});
