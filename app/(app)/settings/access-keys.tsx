"use client";

import { useActionState, useState, useTransition } from "react";
import { createAccessKey, revokeAccessKey } from "@/lib/keys/actions";
import type { AccessKey } from "@/lib/keys/read";
import { utc } from "@/lib/utc";

const INSTRUCTION =
  "Before editing a file that other files import, call the flowlens blast_radius tool on it " +
  "(list_analyses gives the analysis id) and check the files it lists. If the analysis commit " +
  "isn't the commit you're working on, say the map may be out of date.";

/** Lists, creates and revokes the organization's access keys, with the command that uses one. */
export function AccessKeys({ keys, endpoint }: { keys: AccessKey[]; endpoint: string }) {
  const [created, create, creating] = useActionState(createAccessKey, null);
  const fresh = created && "key" in created ? created : null;
  const command = `claude mcp add --transport http flowlens ${endpoint} --header "Authorization: Bearer ${fresh?.key ?? "<key>"}"`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-xs">
      <section className="border-b border-border">
        <div className="flex h-9 items-center gap-4 border-b border-border px-3">
          <h1 className="font-semibold">
            Access keys
            <span className="ml-1.5 font-normal tabular-nums text-muted">{keys.length}</span>
          </h1>
          <p className="text-muted">Let a coding agent read this organization&apos;s maps. Read-only.</p>
        </div>

        <form action={create} className="flex h-10 items-center gap-2 border-b border-border px-3">
          <label htmlFor="name" className="shrink-0 text-muted">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={60}
            defaultValue={created && "error" in created ? created.name : undefined}
            placeholder="laptop, ci, …"
            spellCheck={false}
            autoComplete="off"
            className="h-6 w-full max-w-60 rounded border border-border bg-background px-2 placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating}
            className="h-6 shrink-0 rounded bg-accent px-2.5 font-medium text-background disabled:opacity-50"
          >
            {creating ? "Creating" : "Create key"}
          </button>
          {created && "error" in created && (
            <p role="alert" className="min-w-0 truncate text-danger" title={created.error}>
              {created.error}
            </p>
          )}
        </form>

        {fresh && (
          <div className="border-b border-border px-3 py-2">
            <p>
              <span className="font-medium">{fresh.name}</span>
              <span className="text-muted"> — copy it now. Only its hash is kept; it can&apos;t be shown again.</span>
            </p>
            <Copyable value={fresh.key} />
          </div>
        )}

        {keys.length === 0 ? (
          <p className="px-3 py-2 text-muted">No keys yet.</p>
        ) : (
          <KeyTable keys={keys} />
        )}
      </section>

      <section className="border-b border-border px-3 py-2">
        <h2 className="font-semibold">Connect Claude Code</h2>
        <p className="mt-0.5 text-muted">
          Run in the repository you work on.{" "}
          {fresh ? "The new key is filled in." : "Replace <key> with a key from above."}
        </p>
        <Copyable value={command} />
      </section>

      <section className="border-b border-border px-3 py-2">
        <h2 className="font-semibold">Example instruction</h2>
        <p className="mt-0.5 text-muted">For the agent&apos;s CLAUDE.md, or say it in a session.</p>
        <Copyable value={INSTRUCTION} wrap />
      </section>
    </div>
  );
}

function KeyTable({ keys }: { keys: AccessKey[] }) {
  return (
    <table className="w-full min-w-160 table-fixed border-collapse">
      <colgroup>
        <col className="w-[30%]" />
        <col className="w-[20%]" />
        <col className="w-[20%]" />
        <col />
      </colgroup>
      <thead className="bg-surface text-left text-muted">
        <tr className="border-b border-border">
          <th className="h-7 px-3 font-normal">Name</th>
          <th className="h-7 px-3 font-normal">Created, UTC</th>
          <th className="h-7 px-3 font-normal">Last used, UTC</th>
          <th className="h-7 px-3 font-normal">State</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id} className={`border-b border-border last:border-b-0 ${k.revokedAt ? "text-muted" : ""}`}>
            <td className="h-7 truncate px-3" title={k.name}>
              {k.name}
            </td>
            <td className="h-7 px-3">
              <Timestamp value={k.createdAt} />
            </td>
            <td className="h-7 px-3">{k.lastUsedAt ? <Timestamp value={k.lastUsedAt} /> : <span className="text-muted">never</span>}</td>
            <td className="h-7 px-3">
              {k.revokedAt ? (
                <>
                  revoked <Timestamp value={k.revokedAt} />
                </>
              ) : (
                <Revoke id={k.id} name={k.name} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Timestamp({ value }: { value: string }) {
  const { date, time } = utc(value);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-muted">{date}</span> {time}
    </span>
  );
}

function Revoke({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          // Final: a revoked key can't be revived, only replaced.
          if (!window.confirm(`Revoke ${name}? Anything using it stops working on its next request.`)) return;
          start(async () => setError((await revokeAccessKey(id))?.error ?? null));
        }}
        className="h-5 rounded border border-border px-1.5 hover:border-danger hover:text-danger disabled:opacity-50"
      >
        {pending ? "Revoking" : "Revoke"}
      </button>
      {error && (
        <span role="alert" className="truncate text-danger" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}

function Copyable({ value, wrap = false }: { value: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-1.5 flex max-w-4xl items-start gap-2">
      <code
        className={`min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono ${wrap ? "whitespace-pre-wrap" : "overflow-x-auto whitespace-nowrap"}`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
        className="h-6 shrink-0 rounded border border-border px-2 hover:border-accent"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
