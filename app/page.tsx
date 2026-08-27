import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-center">
      <h1 className="text-4xl font-bold text-white">Deadlock Foundry</h1>
      <p className="max-w-md text-zinc-300">
        Plan your Deadlock build: pick a hero, choose items, and see exactly why they matter — no
        wiki required.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/heroes"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2.5 font-medium text-white transition-colors hover:border-amber-500 hover:text-amber-400"
        >
          Browse Heroes
        </Link>
        <Link
          href="/items"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-2.5 font-medium text-white transition-colors hover:border-amber-500 hover:text-amber-400"
        >
          Browse Items
        </Link>
        <Link
          href="/build"
          className="rounded-lg border border-amber-500 bg-amber-500/10 px-5 py-2.5 font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
        >
          Start a Build
        </Link>
      </div>
    </main>
  );
}
