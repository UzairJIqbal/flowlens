"use client";

import { useSession } from "@clerk/nextjs";
import { useEffect, useEffectEvent, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { readPreviewProgress } from "@/lib/previews/actions";
import { readProgress } from "./actions";
import { analysisTopic, broadcastProgress, previewTopic, type Progress } from "./progress";

export type Live =
  | { state: "idle" | "connecting" | "live" }
  | { state: "error"; reason: string };

type Connection = {
  key: string;
  joined: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
};

// Analyses and previews publish the same shape on their own topics; only the
// channel name and the catch-up read differ.
const RUNS = {
  analysis: { topic: analysisTopic, read: readProgress },
  preview: { topic: previewTopic, read: readPreviewProgress },
} as const;

export type RunKind = keyof typeof RUNS;

/**
 * Subscribes to each run's private channel and hands every published
 * stage to `onProgress`. Nothing is polled: the only read is one catch-up per
 * join, for whatever was published before the socket was listening.
 *
 * The returned state says whether the page is actually live, because a channel
 * the policy refuses looks exactly like a run that isn't moving.
 */
export function useRunProgress(
  kind: RunKind,
  ids: readonly string[],
  onProgress: (id: string, progress: Progress) => void,
): Live {
  const { session } = useSession();
  const sessionId = session?.id;
  const key = ids.join(",");
  const [connection, setConnection] = useState<Connection | null>(null);

  const deliver = useEffectEvent((id: string, progress: Progress) => onProgress(id, progress));
  const token = useEffectEvent(async () => (await session?.getToken()) ?? null);

  useEffect(() => {
    if (!sessionId || key === "") return;
    const { topic, read } = RUNS[kind];

    let active = true;
    const supabase = createBrowserSupabaseClient(() => token());
    // Events seen per channel. A catch-up read that comes back after a newer
    // event has arrived is older than what's on screen, so it's dropped.
    const seen = new Map<string, number>();

    const record = (id: string, error: string | null) =>
      setConnection((current) => {
        const base = current?.key === key ? current : { key, joined: new Set<string>(), errors: new Map<string, string>() };
        const joined = new Set(base.joined);
        const errors = new Map(base.errors);
        if (error === null) {
          joined.add(id);
          errors.delete(id);
        } else {
          joined.delete(id);
          errors.set(id, error);
        }
        return { key, joined, errors };
      });

    for (const id of key.split(",")) {
      supabase
        .channel(topic(id), { config: { private: true } })
        .on<Record<string, unknown>>("broadcast", { event: "*" }, ({ event, payload }) => {
          const progress = broadcastProgress(event, payload);
          if (!progress || !active) return;
          seen.set(id, (seen.get(id) ?? 0) + 1);
          deliver(id, progress);
        })
        .subscribe((status, err) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            record(id, null);
            const at = seen.get(id) ?? 0;
            read(id).then(
              (progress) => {
                if (progress && active && (seen.get(id) ?? 0) === at) deliver(id, progress);
              },
              (error: unknown) => {
                if (active) record(id, `could not read the latest state: ${error instanceof Error ? error.message : String(error)}`);
              },
            );
          } else if (status === "CHANNEL_ERROR") {
            record(id, err?.message ?? "the channel refused to join");
          } else if (status === "TIMED_OUT") {
            record(id, "timed out joining the channel");
          }
        });
    }

    return () => {
      active = false;
      void supabase.removeAllChannels();
    };
  }, [sessionId, key, kind]);

  if (key === "") return { state: "idle" };
  if (connection?.key !== key) return { state: "connecting" };
  const reason = connection.errors.values().next().value;
  if (reason !== undefined) return { state: "error", reason };
  return { state: connection.joined.size === ids.length ? "live" : "connecting" };
}
