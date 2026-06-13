import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = send;
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { BedrockExplainer, NoopExplainer, createExplainer } = await import("../src/ai/explainer.js");

const input = {
  type: "CLAUDE_SKILL" as const,
  fileList: [{ path: "SKILL.md", size: 10 }],
  contentText: "hello world",
};

describe("BedrockExplainer", () => {
  afterEach(() => {
    send.mockReset();
    vi.restoreAllMocks();
  });

  it("returns the trimmed model text on success", async () => {
    send.mockResolvedValue({ output: { message: { content: [{ text: "  a short summary  " }] } } });
    const result = await new BedrockExplainer("model-id", "ap-northeast-1").generate(input);
    expect(result).toBe("a short summary");
    expect(send).toHaveBeenCalledOnce();
  });

  it("returns null (best-effort) when Bedrock throws, without blocking the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValue(new Error("ThrottlingException"));
    const result = await new BedrockExplainer("model-id", "ap-northeast-1").generate(input);
    expect(result).toBeNull();
  });

  it("skips the call entirely for empty content", async () => {
    const result = await new BedrockExplainer("model-id", "ap-northeast-1").generate({
      ...input,
      contentText: "   ",
    });
    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("createExplainer", () => {
  it("returns a NoopExplainer when Bedrock is disabled", () => {
    const explainer = createExplainer({
      bedrockEnabled: false,
      bedrockModelId: "model-id",
      bedrockRegion: "ap-northeast-1",
    } as never);
    expect(explainer).toBeInstanceOf(NoopExplainer);
  });

  it("returns a BedrockExplainer when enabled with a model id", () => {
    const explainer = createExplainer({
      bedrockEnabled: true,
      bedrockModelId: "model-id",
      bedrockRegion: "ap-northeast-1",
    } as never);
    expect(explainer).toBeInstanceOf(BedrockExplainer);
  });
});
