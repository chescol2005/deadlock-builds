import { guideMetadata } from "@/lib/seo";
import Link from "next/link";
import { BoonsPageClient } from "./components/BoonsPageClient";

export const metadata = guideMetadata("/guide/boons", "Boons Guide");

export default function BoonsGuidePage() {
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
          <span className="text-zinc-300">Boons</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Boons Guide</h1>
          <p className="mt-2 text-zinc-400">
            Your hero levels up automatically as you earn souls — understand what each boon
            threshold unlocks and when your ultimate comes online.
          </p>
        </div>
        <BoonsPageClient />
      </div>
    </main>
  );
}
