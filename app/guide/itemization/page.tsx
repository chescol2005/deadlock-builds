import { ItemizationPageClient } from "./components/ItemizationPageClient";

export const metadata = { title: "Itemization Guide | Deadlock Foundry" };

export default function ItemizationGuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-6 text-sm text-zinc-500">
          <span>Home</span>
          <span className="mx-2">/</span>
          <span>Guides</span>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">Itemization</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Itemization Guide</h1>
          <p className="mt-2 text-zinc-400">
            Categories, tiers, upgrades, and the investment bonuses that reward committing souls to
            one category over spreading them thin.
          </p>
        </div>
        <ItemizationPageClient />
      </div>
    </main>
  );
}
