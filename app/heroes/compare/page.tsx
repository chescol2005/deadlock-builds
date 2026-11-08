import type { Metadata } from "next";
import Link from "next/link";
import { getRosterProfileInputs, rosterCompareFrom } from "@/lib/heroProfileStore";
import { parseRankParam } from "@/lib/heroProfile/view";
import { HeroCompareClient } from "./components/HeroCompareClient";

export const metadata: Metadata = {
  title: "Compare heroes",
  description:
    "Every Deadlock hero ranked late game: gun damage that lands at your rank, ability spirit scaling, health and melee, with each hero's gun or spirit lean.",
  alternates: { canonical: "/heroes/compare" },
};

export default async function HeroComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, inputs] = await Promise.all([searchParams, getRosterProfileInputs()]);
  const rankTier = parseRankParam(
    query.rank,
    inputs.rankTiers.map((t) => t.tier),
  );
  const rows = rosterCompareFrom(inputs, rankTier);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4">
        <Link href="/heroes" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← All heroes
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-zinc-100">Compare heroes</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          Every hero side by side, late game with no items. Sort by any column to see who has the
          strongest gun, whose abilities pay off most from spirit items, and who is hardest to kill.
          Pick a hero for the full breakdown.
        </p>
      </div>
      <HeroCompareClient rows={rows} rankTier={rankTier} rankTiers={inputs.rankTiers} />
    </main>
  );
}
