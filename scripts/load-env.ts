// Loads the environment the way `next dev` does, for scripts that run outside
// it. Import it first: modules read process.env when they're evaluated, and
// imports evaluate in order.
//
// Next's precedence, highest first: what the shell already set, then
// .env.development.local, .env.local, .env.development, .env. Node never
// overwrites a variable that's already set, so loading in that order gives
// the same answer. Next skips .env.local under test, and so does this. One
// difference: Next expands $VARIABLES inside values and Node doesn't, so a
// value that refers to another would arrive here unexpanded.

import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.env.NODE_ENV ?? "development";
const files = [`.env.${mode}.local`, ...(mode === "test" ? [] : [".env.local"]), `.env.${mode}`, ".env"];

for (const file of files) {
  const full = path.join(root, file);
  if (existsSync(full)) process.loadEnvFile(full);
}
