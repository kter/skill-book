"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { emailDomainNotAllowedMessage, isEmailDomainAllowed } from "@skill-book/shared/auth";
import { config } from "@/lib/config";
import { getStoredSession, signInWithPassword, startGoogleSignIn } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Don't show a sign-in form on top of an authenticated
  // session — send them to the registry.
  useEffect(() => {
    if (!config.devAuthBypass && getStoredSession()) router.replace("/");
  }, [router]);

  if (config.devAuthBypass) {
    return (
      <div className="card login-card">
        <h1>Sign in</h1>
        <p data-testid="bypass-notice">
          Auth bypass is enabled (local development). You are signed in as a dev user.
        </p>
        <button
          type="button"
          className="btn btn-primary full-width"
          onClick={() => router.push("/")}
        >
          Continue
        </button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailDomainAllowed(email)) {
      setError(emailDomainNotAllowedMessage());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card login-card">
      <h1>Sign in to skill-book</h1>
      <button
        type="button"
        className="btn full-width"
        onClick={() => startGoogleSignIn()}
        data-testid="google-signin"
      >
        Sign in with Google
      </button>
      <div className="divider">
        <span>or with email</span>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="email-input"
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          data-testid="password-input"
        />
        {error && (
          <div className="error-box" data-testid="login-error">
            {error}
          </div>
        )}
        <p>
          <button
            type="submit"
            className="btn btn-primary full-width"
            disabled={busy}
            data-testid="login-submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
