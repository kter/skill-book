"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { completeGoogleSignIn } from "@/lib/auth";

function CallbackInner() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    const code = params.get("code");
    const oauthError = params.get("error_description") ?? params.get("error");
    if (oauthError) {
      setError(oauthError);
      return;
    }
    if (!code || exchanged.current) return;
    exchanged.current = true;
    completeGoogleSignIn(code)
      .then(() => {
        window.location.href = "/";
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [params]);

  if (error) {
    return (
      <div className="card login-card">
        <h1>Sign-in failed</h1>
        <div className="error-box">{error}</div>
        <a href="/login/">Back to sign in</a>
      </div>
    );
  }
  return <p>Completing sign-in…</p>;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p>Completing sign-in…</p>}>
      <CallbackInner />
    </Suspense>
  );
}
