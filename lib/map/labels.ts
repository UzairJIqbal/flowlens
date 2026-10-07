/**
 * The shortest trailing run of path segments that is still unique among
 * `paths`. "src/components/ui" is "ui" until something else on screen also
 * ends in "ui", then both grow a segment, and so on.
 */
export function shortestUnique(paths: readonly string[]): Map<string, string> {
  const segments = new Map(paths.map((p) => [p, p.split("/")]));
  const take = new Map(paths.map((p) => [p, 1]));
  const label = (p: string) => segments.get(p)!.slice(-take.get(p)!).join("/");

  for (;;) {
    const byLabel = new Map<string, string[]>();
    for (const p of paths) byLabel.set(label(p), [...(byLabel.get(label(p)) ?? []), p]);

    let grew = false;
    for (const clash of byLabel.values()) {
      if (clash.length < 2) continue;
      for (const p of clash) {
        if (take.get(p)! < segments.get(p)!.length) {
          take.set(p, take.get(p)! + 1);
          grew = true;
        }
      }
    }
    // Paths are distinct, so a clash always has a member that can still grow.
    if (!grew) return new Map(paths.map((p) => [p, label(p)]));
  }
}
