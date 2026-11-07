import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Vercel Image Optimization is off (2026-11-07, docs/milestone-o.md §11): the
    // icons are ~10 KB WebP shown at 24–56 px, and the asset host sends no
    // Cache-Control, so each size was re-transformed every few hours against the
    // plan's quota. <Image> now serves the source URL as is. Fixture 16 guards it.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets-bucket.deadlock-api.com",
      },
    ],
  },
};

export default nextConfig;
