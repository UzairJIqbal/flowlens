import { auth } from "@clerk/nextjs/server";

// Read from the session token's claims during server rendering, so it is in
// the first HTML response rather than filled in after hydration.
export default async function WorkspacePage() {
  const { orgId, orgSlug, orgRole } = await auth();

  return (
    <section className="p-3">
      <h1 className="mb-2 text-xs font-semibold text-muted">Workspace</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">organization</dt>
        <dd className="font-mono">{orgSlug ?? orgId}</dd>
        <dt className="text-muted">id</dt>
        <dd className="font-mono">{orgId}</dd>
        <dt className="text-muted">role</dt>
        <dd className="font-mono">{orgRole}</dd>
      </dl>
    </section>
  );
}
