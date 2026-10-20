import Link from "next/link";
import { FarmingPageClient } from "./components/FarmingPageClient";

export const metadata = { title: "Farming Guide | Deadlock Foundry" };

export default function FarmingGuidePage() {
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
          <span className="text-zinc-300">Farming</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Farming Guide</h1>
          <p className="mt-2 text-zinc-400">
            Earn more souls without losing your lane. Farm on the way to objectives — never detour
            for camps.
          </p>
        </div>
        <FarmingPageClient />
      </div>
    </main>
  );
}
