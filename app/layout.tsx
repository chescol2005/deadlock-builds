import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/app/components/SiteNav";
import { BASE_OPEN_GRAPH, DEFAULT_OG_IMAGE, SITE_NAME, siteUrl } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description:
    "Build planner and guides for Valve's Deadlock — pick a hero, plan your items, and understand your build.",
  // The generic card; hero, item and build pages set their own.
  openGraph: { ...BASE_OPEN_GRAPH, images: [DEFAULT_OG_IMAGE] },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
