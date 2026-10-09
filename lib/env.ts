// Imported by next.config.ts, so a missing value stops `next dev` and
// `next build` before anything serves, instead of surfacing later as a
// confusing auth or network error.

const required = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  // Every sign-in method finishes at these, which is what keeps them all
  // landing in the same place.
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // The pipeline's writer. Server only: it bypasses row-level security.
  "SUPABASE_SECRET_KEY",
  // The model's key. Tracing is optional and read where the client is built,
  // because a missing LangSmith key must not stop anything.
  "GOOGLE_API_KEY",
  // The app's own GitHub token, for API reads of public repositories.
  "GH_READ_TOKEN",
] as const;

type EnvKey = (typeof required)[number];

function read(): Record<EnvKey, string> {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables (set them in .env.local):\n  ${missing.join("\n  ")}`,
    );
  }
  return Object.fromEntries(
    required.map((key) => [key, process.env[key]!.trim()]),
  ) as Record<EnvKey, string>;
}

export const env = read();
