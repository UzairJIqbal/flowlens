import path from "node:path";
import { readResult } from "@/lib/parser/io";
import type { ParseResult } from "@/lib/parser/types";

// Scaffolding for phase 4: parser output for sadmann7/skateshop at e954d54,
// checked in so the map can be built without an account, database or network.
// Regenerate with `pnpm parse <checkout> --out lib/sample/skateshop.json`.
// Goes away once analyses are stored properly.
export function loadSample(): ParseResult {
  // Read through the contract check rather than imported as JSON, so a stale
  // file fails here instead of somewhere inside the canvas.
  return readResult(path.join(process.cwd(), "lib/sample/skateshop.json"));
}
