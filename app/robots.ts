import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    // No disallow: share-preview images live under /api/og, and unfurl bots
    // (Twitterbot among them) skip images that robots.txt blocks.
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
