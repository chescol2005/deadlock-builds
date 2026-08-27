import { LanesPageClient } from "./components/LanesPageClient";

export const metadata = { title: "Lane Mechanics Guide | Deadlock Foundry" };

export default function LanesGuidePage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-6 text-sm text-zinc-500">
          <span>Home</span>
          <span className="mx-2">/</span>
          <span>Guides</span>
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
