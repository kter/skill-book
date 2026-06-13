import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { ArtifactType } from "@skill-book/shared";
import type { ApiConfig } from "../config.js";

export interface ExplanationInput {
  type: ArtifactType;
  fileList: { path: string; size: number }[];
  contentText: string;
}

/** Produces a short human-readable summary of an artifact version's content. */
export interface Explainer {
  generate(input: ExplanationInput): Promise<string | null>;
}

/** Used in local/test or when Bedrock is disabled — explanations are simply omitted. */
export class NoopExplainer implements Explainer {
  async generate(): Promise<string | null> {
    return null;
  }
}

// Cap the content we send so a large artifact can't blow the input token budget.
const MAX_CONTENT_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 512;

const TYPE_LABEL: Record<ArtifactType, string> = {
  CLAUDE_SKILL: "Claude Skill",
  CLAUDE_MD: "CLAUDE.md",
  AGENTS_MD: "AGENTS.md",
};

function buildPrompt(input: ExplanationInput): string {
  const files = input.fileList.map((f) => `- ${f.path}`).join("\n");
  const content =
    input.contentText.length > MAX_CONTENT_CHARS
      ? `${input.contentText.slice(0, MAX_CONTENT_CHARS)}\n…(以下省略)`
      : input.contentText;
  return [
    `次は社内レジストリに公開された「${TYPE_LABEL[input.type]}」アーティファクトの中身です。`,
    "利用者が一覧でパッと見て用途を判断できるよう、日本語で簡潔に説明してください。",
    "- 1〜2文の概要に続けて、主な用途やポイントを最大3点、箇条書きで。",
    "- 前置きや「このアーティファクトは」等の決まり文句は不要。中身そのものを説明する。",
    "",
    "## 含まれるファイル",
    files || "(なし)",
    "",
    "## 内容",
    content,
  ].join("\n");
}

/** Calls Bedrock (Converse) to summarize content. Best-effort: returns null on any error. */
export class BedrockExplainer implements Explainer {
  private readonly client: BedrockRuntimeClient;

  constructor(
    private readonly modelId: string,
    region: string,
  ) {
    this.client = new BedrockRuntimeClient({ region, maxAttempts: 3, retryMode: "adaptive" });
  }

  async generate(input: ExplanationInput): Promise<string | null> {
    if (!input.contentText.trim()) return null;
    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [{ role: "user", content: [{ text: buildPrompt(input) }] }],
          inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.2 },
        }),
      );
      const text = response.output?.message?.content?.[0]?.text?.trim();
      return text || null;
    } catch (err) {
      console.error("explanation generation failed:", err);
      return null;
    }
  }
}

export function createExplainer(config: ApiConfig): Explainer {
  if (!config.bedrockEnabled || !config.bedrockModelId) {
    return new NoopExplainer();
  }
  return new BedrockExplainer(config.bedrockModelId, config.bedrockRegion);
}
