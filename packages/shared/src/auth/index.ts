// Single source of truth for which email domains may register / use skill-book.
// Referenced by the web frontend, the API auth middleware, and the Cognito
// pre-sign-up Lambda so the whitelist never drifts across layers.

export const ALLOWED_EMAIL_DOMAINS = ["tomohiko.io", "mbk-digital.co.jp"] as const;

/** True when the email's domain (case-insensitive) is on the whitelist. */
export function isEmailDomainAllowed(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return false;
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

/**
 * User-facing message shown when a domain is rejected. Intentionally does NOT
 * disclose which domains are allowed (avoid leaking the whitelist).
 */
export function emailDomainNotAllowedMessage(): string {
  return "This email address isn't permitted to sign up. Contact the administrator if you need access.";
}
