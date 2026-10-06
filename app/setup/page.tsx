"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import type { UserResource } from "@clerk/nextjs/types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The proxy sends anyone whose token has no organization here. Nobody is asked
// anything: an existing membership (e.g. from an accepted invitation) is
// activated, otherwise a first organization is created for them. Either way the
// organization ends up as a claim on the session token.
export default function SetupPage() {
  const { isLoaded, user } = useUser();
  const { createOrganization, setActive } = useClerk();
  const router = useRouter();
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
      router.replace("/");
      router.refresh();
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, [isLoaded, user, createOrganization, setActive, router]);

  return (
    <main className="flex flex-1 items-center justify-center text-xs text-muted">
      {error ? (
        <p className="text-danger">Could not set up an organization: {error}</p>
      ) : (
        <p>Setting up your organization…</p>
      )}
    </main>
  );
}

function teamName(user: UserResource): string {
  const who =
    user.firstName ??
    user.username ??
    user.primaryEmailAddress?.emailAddress.split("@")[0] ??
    "My";
  return `${who}'s team`;
}
