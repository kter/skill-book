"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getStoredSession, signOut } from "@/lib/auth";

export function Nav() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(getStoredSession()?.email ?? null);
  }, []);

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          📚 skill-book
        </Link>
        <Link href="/">Browse</Link>
        <Link href="/upload/" data-testid="nav-upload">
          Upload
        </Link>
        <div className="spacer" />
        {email ? (
          <>
            <span className="user-email" data-testid="user-email">
              {email}
            </span>
            <a href="/login/" onClick={() => signOut()} data-testid="logout-link">
              Sign out
            </a>
          </>
        ) : (
          <Link href="/login/" data-testid="login-link">
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
