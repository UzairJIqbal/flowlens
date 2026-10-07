"use client";

import { useActionState } from "react";
import { submitAnalysis } from "@/lib/analyses/actions";

/** Submits a repository URL and preserves rejected input alongside the server error. */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitAnalysis, null);

  return (
    <form
      action={action}
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-xs"
    >
      <label htmlFor="url" className="shrink-0 text-muted">
        Public repository
      </label>
      <input
        id="url"
        name="url"
        type="text"
        required
        // The form resets after every submission; a rejected URL comes back
        // so it can be corrected rather than retyped.
        defaultValue={state?.url}
        placeholder="https://github.com/owner/repository"
        spellCheck={false}
        autoComplete="off"
        className="h-6 w-full max-w-md rounded border border-border bg-background px-2 font-mono placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-6 shrink-0 rounded bg-accent px-2.5 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Submitting" : "Analyse"}
      </button>
      {state && (
        <p role="alert" className="min-w-0 truncate text-danger" title={state.error}>
          {state.error}
        </p>
      )}
    </form>
  );
}
