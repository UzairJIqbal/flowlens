import type { Live } from "@/lib/analyses/use-progress";

/**
 * Says whether the page will actually move. A channel the policy refused looks
 * exactly like a run that has stopped, so the difference is spelled out.
 */
export function LiveLabel({ live }: { live: Live }) {
  switch (live.state) {
    case "idle":
      return null;
    case "connecting":
      return <span className="ml-auto text-muted">connecting</span>;
    case "live":
      return <span className="ml-auto text-muted">live</span>;
    case "error":
      return (
        <span className="ml-auto min-w-0 truncate text-danger" title={live.reason}>
          Not receiving updates: {live.reason}
        </span>
      );
  }
}
