import Link from "next/link";
import { GUIDES } from "@/lib/navigation";

export const metadata = {
  title: "Guides",
  description:
    "Plain-English Deadlock guides: farming, lanes, boons and itemization, for players new to the game.",
};

export default function GuidesIndexPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-300">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-zinc-300">Guides</span>
        </nav>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Guides</h1>
          <p className="mt-2 text-zinc-400">
            Deadlock doesn&apos;t explain most of its systems in-game. Each guide covers one, in
            plain English, with the exact numbers when you want them.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <li key={guide.href}>
              <Link
                href={guide.href}
                className="flex h-full flex-col gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-5 transition-colors hover:border-amber-500"
              >
                <span className="text-lg font-semibold text-white">{guide.label}</span>
                <span className="text-sm text-zinc-400">{guide.description}</span>
                <span className="mt-auto pt-2 text-sm font-medium text-amber-400">
                  Read guide →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
