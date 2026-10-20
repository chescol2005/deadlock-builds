import Link from "next/link";
import { fetchVisibleHeroes } from "@/lib/heroApi";
import { GUIDES } from "@/lib/navigation";
import { HomeHeroPicker } from "@/app/components/HomeHeroPicker";
import { InfoTooltip } from "@/app/components/Tooltip";

export const metadata = {
  title: "Deadlock Foundry — the build planner that explains itself",
  description:
    "Pick a Deadlock hero and get item suggestions with a plain-English reason for each, tailored to the hero's kit and what you already own.",
};

const STEPS = [
  {
    title: "1. Pick your hero",
    body: "We read the hero's abilities and gun to work out what it needs: spirit power, weapon damage, durability or mobility.",
  },
  {
    title: "2. See what to buy",
    body: "Suggestions fill those gaps within your soul budget, each with a plain-English reason. Items you already own count too.",
  },
  {
    title: "3. Tune and share",
    body: "Switch to Advanced for the full scoring detail, arrange your game plan by phase, and copy a share link.",
  },
] as const;

export default async function Home() {
  // Fail open: the picker shows a "Browse heroes" fallback. The fetch revalidates
  // hourly, so a failure baked in at build time clears within the hour.
  const heroes = await fetchVisibleHeroes().catch((err: unknown) => {
    console.error("Homepage hero fetch failed", err);
    return [];
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-8">
        <section>
          <p className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
            Deadlock Foundry
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            The build planner that explains itself.
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-300">
            Pick a hero and get item suggestions, each with a reason. They&apos;re tailored to your
            hero&apos;s kit and what you already own, and they never assume you&apos;ve read the
            wiki.
          </p>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Pick a hero to start</h2>
            <InfoTooltip content="Each hero opens the build planner. Difficulty comes from Valve's own 1–3 rating. Start with an easier hero while you learn." />
          </div>
          <HomeHeroPicker heroes={heroes} />
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
            <Link href="/heroes" className="hover:text-amber-400">
              Browse all heroes
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/items" className="hover:text-amber-400">
              Browse items
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/build" className="hover:text-amber-400">
              Open an empty build
            </Link>
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold text-white">How it works</h2>
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.title} className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                <h3 className="font-semibold text-amber-400">{step.title}</h3>
                <p className="mt-2 text-sm text-zinc-300">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold text-white">Learn the systems</h2>
              <p className="mt-1 text-sm text-zinc-400">
                New to Deadlock? These explain what the game doesn&apos;t.
              </p>
            </div>
            <Link href="/guide" className="text-sm font-medium text-amber-400 hover:text-amber-300">
              All guides →
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {GUIDES.map((guide) => (
              <li key={guide.href}>
                <Link
                  href={guide.href}
                  className="block h-full rounded-lg border border-zinc-700 bg-zinc-900 p-4 transition-colors hover:border-amber-500"
                >
                  <span className="font-semibold text-white">{guide.label}</span>
                  <span className="mt-1 block text-sm text-zinc-400">{guide.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
