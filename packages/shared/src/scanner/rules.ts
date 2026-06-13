// Secret detection rules derived from the gitleaks default ruleset (MIT).
// Each rule is regex + optional keyword gate + optional entropy threshold.

export interface ScanRule {
  id: string;
  description: string;
  regex: RegExp;
  /** When set, a line must contain one of these (case-insensitive) before the regex runs. */
  keywords?: string[];
  /** Shannon entropy threshold applied to the captured secret. */
  entropy?: number;
  /** Capture group index holding the secret (default: whole match). */
  secretGroup?: number;
}

export const SCAN_RULES: ScanRule[] = [
  {
    id: "aws-access-key-id",
    description: "AWS access key ID",
    regex: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g,
    secretGroup: 1,
  },
  {
    id: "aws-secret-access-key",
    description: "AWS secret access key",
    regex: /(?:aws|secret)[\w-]{0,20}["']?\s*(?:=|:|=>)\s*["']?([A-Za-z0-9/+=]{40})(?:["'\s]|$)/gi,
    keywords: ["aws", "secret"],
    entropy: 4.0,
    secretGroup: 1,
  },
  {
    id: "github-pat",
    description: "GitHub personal access token",
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    secretGroup: 1,
  },
  {
    id: "github-fine-grained-pat",
    description: "GitHub fine-grained personal access token",
    regex: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
    secretGroup: 1,
  },
  {
    id: "gitlab-pat",
    description: "GitLab personal access token",
    regex: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
    secretGroup: 1,
  },
  {
    id: "slack-token",
    description: "Slack token",
    regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,250})\b/g,
    secretGroup: 1,
  },
  {
    id: "openai-api-key",
    description: "OpenAI API key",
    regex:
      /\b(sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g,
    secretGroup: 1,
  },
  {
    id: "anthropic-api-key",
    description: "Anthropic API key",
    regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    secretGroup: 1,
  },
  {
    id: "google-api-key",
    description: "Google API key",
    regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    secretGroup: 1,
  },
  {
    id: "stripe-api-key",
    description: "Stripe API key",
    regex: /\b((?:sk|rk)_(?:test|live)_[0-9a-zA-Z]{10,99})\b/g,
    secretGroup: 1,
  },
  {
    id: "sendgrid-api-key",
    description: "SendGrid API key",
    regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g,
    secretGroup: 1,
  },
  {
    id: "npm-access-token",
    description: "npm access token",
    regex: /\b(npm_[A-Za-z0-9]{36})\b/g,
    secretGroup: 1,
  },
  {
    id: "private-key",
    description: "Private key block",
    regex: /(-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g,
    secretGroup: 1,
  },
  {
    id: "jwt",
    description: "JSON Web Token",
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    secretGroup: 1,
  },
  {
    id: "generic-api-key",
    description: "Generic high-entropy credential assignment",
    regex:
      /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)["']?\s*(?:=|:|=>)\s*["']([A-Za-z0-9_\-+/=]{16,80})["']/gi,
    keywords: ["key", "secret", "token", "password", "passwd"],
    entropy: 3.6,
    secretGroup: 1,
  },
];
