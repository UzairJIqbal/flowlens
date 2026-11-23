import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the landing page and the demo are readable signed out; everything else
// would answer a crawler with a redirect to sign-in.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/sign-in", "/sign-up", "/setup", "/analyses", "/previews", "/settings", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
