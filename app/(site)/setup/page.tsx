"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import type { UserResource } from "@clerk/nextjs/types";
import { useEffect, useRef, useState } from "react";

// The proxy sends anyone whose token has no organization here. Nobody is asked
// anything: an existing membership (e.g. from an accepted invitation) is
// activated, otherwise a first organization is created for them. Either way the
// organization ends up as a claim on the session token.
export default function SetupPage() {
  const { isLoaded, user } = useUser();
  const { createOrganization, setActive } = useClerk();
  const [error, setError] = useState<string | null>(null);
  // Effects run twice in development; creating twice would leave a stray org.
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || !user || started.current) return;
    started.current = true;

    (async () => {
      const existing = user.organizationMemberships[0]?.organization;
      const organization =
        existing ?? (await createOrganization({ name: teamName(user) }));
      await setActive({ organization });
      // A full load rather than a client transition: the destination may be
      // the hero's hand-off, and every request after this carries the new token.
      window.location.replace(destination(window.location.search));
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [isLoaded, user, createOrganization, setActive]);

  return (
    <div className="max-w-[46ch] text-center text-[13px]">
      {error ? (
        <p role="alert" className="text-danger">Could not set up an organization: {error}</p>
      ) : (
        <p className="text-muted">Setting up your organization…</p>
      )}
    </div>
  );
}

/** Where the proxy said they were going; only a path on this site, never another origin. */
function destination(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/analyses";
}

function teamName(user: UserResource): string {
  const who =
    user.firstName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress.split("@")[0] ??
    "My";
  return `${who}'s team`;
}
