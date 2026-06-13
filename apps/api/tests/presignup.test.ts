import { describe, expect, it } from "vitest";
import { handler } from "../src/presignup.js";

function event(email: string, triggerSource = "PreSignUp_SignUp") {
  return { triggerSource, request: { userAttributes: { email } }, response: {} };
}

describe("cognito pre-sign-up trigger", () => {
  it("allows whitelisted domains (native and federated)", async () => {
    await expect(handler(event("alice@tomohiko.io"))).resolves.toBeDefined();
    await expect(
      handler(event("bob@mbk-digital.co.jp", "PreSignUp_ExternalProvider")),
    ).resolves.toBeDefined();
  });

  it("rejects non-whitelisted domains", async () => {
    await expect(handler(event("eve@gmail.com"))).rejects.toThrow(/permitted/);
    await expect(
      handler(event("mallory@example.com", "PreSignUp_ExternalProvider")),
    ).rejects.toThrow(/permitted/);
  });

  it("rejects a missing email", async () => {
    await expect(
      handler({ triggerSource: "PreSignUp_SignUp", request: {}, response: {} }),
    ).rejects.toThrow();
  });
});
