// Cognito Pre-Sign-Up Lambda trigger.
//
// Fires before Cognito creates a user — for both native sign-up
// (`PreSignUp_SignUp`) and federated sign-up via Google
// (`PreSignUp_ExternalProvider`). Throwing rejects the registration and
// surfaces the message back to the Hosted UI / OAuth callback.
//
// The allowed-domain list is bundled from `@skill-book/shared/auth` (esbuild)
// so it stays in lock-step with the web frontend and the API middleware.

import { emailDomainNotAllowedMessage, isEmailDomainAllowed } from "@skill-book/shared/auth";

interface PreSignUpEvent {
  triggerSource: string;
  request: {
    userAttributes?: Record<string, string | undefined>;
  };
  response: Record<string, unknown>;
}

export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  const email = event.request.userAttributes?.email ?? "";
  if (!isEmailDomainAllowed(email)) {
    // Cognito returns this message to the client and aborts user creation.
    throw new Error(emailDomainNotAllowedMessage());
  }
  return event;
}
