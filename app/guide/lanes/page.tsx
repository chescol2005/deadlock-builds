import { guideMetadata } from "@/lib/seo";
import Link from "next/link";
import { LanesPageClient } from "./components/LanesPageClient";

export const metadata = guideMetadata("/guide/lanes", "Lane Mechanics Guide");

export default function LanesGuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/guide" className="hover:text-zinc-300">
            Guides
          </Link>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">Lane Mechanics</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Lane Mechanics Guide</h1>
          <p className="mt-2 text-zinc-400">
            Deadlock runs a 2-2-2 duo setup across three lanes — Guardians, Walkers, and the Patron
            guard the path to each base.
          </p>
        </div>
        <LanesPageClient />
      </div>
    </main>
  );
}
