import { BoonsPageClient } from "./components/BoonsPageClient";

export const metadata = { title: "Boons Guide | Deadlock Foundry" };

export default function BoonsGuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-6 text-sm text-zinc-500">
          <span>Home</span>
          <span className="mx-2">/</span>
          <span>Guides</span>
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
