import type { NextConfig } from "next";
import { env } from "./lib/env";

const dev = process.env.NODE_ENV === "development";

// The exact hosts the browser talks to, read from the keys rather than
// wildcarded, so the policy allows this deployment's services and no one
// else's. A Clerk publishable key is its Frontend API host, base64-encoded.
const clerk = Buffer.from(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.split("_")[2] ?? "", "base64")
  .toString()
  .replace(/\$$/, "");
if (!/^[a-z0-9.-]+$/.test(clerk)) throw new Error("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY doesn't name a Clerk host");
const supabase = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;

// What the app loads, and nothing else. Inline scripts are Next's own
// bootstrap; without nonces, which would make every page dynamic, they need
// 'unsafe-inline'. Inline styles are React Flow's and Clerk's. Analytics loads
// from this origin in production and from Vercel's script host in development.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://${clerk} https://challenges.cloudflare.com${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self'",
  `connect-src 'self' https://${clerk} https://clerk-telemetry.com https://${supabase} wss://${supabase}${dev ? " ws://localhost:*" : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
