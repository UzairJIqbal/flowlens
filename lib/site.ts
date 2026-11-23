// The production address, for the few places that need an absolute URL:
// robots, the sitemap and the landing page's structured data. Vercel sets this
// on every deployment, previews included, so a preview still points crawlers
// at production rather than at itself.
export const SITE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const SITE_DESCRIPTION =
  "Parses a public TypeScript or JavaScript repository and draws what imports what, every line traced to an import that resolved to a real file.";

export const REPOSITORY_URL = "https://github.com/UzairJIqbal/flowlens";
