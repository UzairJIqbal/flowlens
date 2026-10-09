import type { Metadata } from "next";
import { headers } from "next/headers";
import { listAccessKeys } from "@/lib/keys/read";
import { AccessKeys } from "./access-keys";

export const metadata: Metadata = { title: "Settings" };

/** Access keys for coding agents, and how to connect one. */
export default async function SettingsPage() {
  const [keys, h] = await Promise.all([listAccessKeys(), headers()]);
  // Whatever address this page was reached at is the one an agent on the
  // same machine or network can reach the endpoint at.
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return <AccessKeys keys={keys} endpoint={`${proto}://${host}/api/mcp`} />;
}
