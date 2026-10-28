"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { Item } from "@/lib/items";
import { LANE_NAMES, laneReview } from "@/lib/matchReview";
import type { MatchMetadata } from "@/lib/matchReview";
import { buildMatchCoachContext, gameClock } from "@/lib/matchReviewCoachContext";
import { EMPTY_MEMORY, MATCH_REVIEW_MAX_MESSAGES, getCoachMessages } from "@/lib/coach";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import { InfoTooltip } from "@/app/components/Tooltip";
import { MatchLookupForm } from "./components/MatchLookupForm";
import { MatchHeroPicker } from "./components/MatchHeroPicker";
import { LaneReportPanel } from "./components/LaneReportPanel";
import { LaneCoachPanel } from "./components/LaneCoachPanel";
import { MATCH_ID_PATTERN, fetchMatchMetadata } from "./matchApi";
import type { MatchLoadError } from "./matchApi";
import { NO_REVIEW_MESSAGES, loadErrorMessage } from "./matchMessages";
import type { CoachLine, LaneGroup, LaneItemView, MatchHeroInfo } from "./matchViewTypes";

export interface MatchPageHero extends MatchHeroInfo {
  /** Valve's 1–4 difficulty; null when the API has none. */
  complexity: number | null;
}

interface MatchReviewClientProps {
  heroes: ReadonlyArray<MatchPageHero>;
  allItems: ReadonlyArray<Item>;
  /** From the URL (?id=), so a shared review link reloads itself. */
  initialMatchId: string;
  initialHeroId: number | null;
}

const VIEW_MODE_TABS = [
  { value: "simplified", label: "Simplified" },
  { value: "advanced", label: "Advanced" },
] as const;

const PAGE_HELP =
  "Paste a match ID, pick the hero you played, and see how your lane went in the first 9 minutes compared with your two lane opponents.";

// The key is kept for this tab only when the visitor opts in: sessionStorage, never
// localStorage, cookies or the URL (docs/match-review-use-cases.md §5, Fixture 23).
const KEY_STORE = "deadlock-foundry.match.api-key";
const keyListeners = new Set<() => void>();

function readStoredKey(): string | null {
  try {
    return window.sessionStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

function writeStoredKey(key: string | null): void {
  try {
    if (key === null) window.sessionStorage.removeItem(KEY_STORE);
    else window.sessionStorage.setItem(KEY_STORE, key);
  } catch {
    // Storage blocked: the key still works for this page view.
  }
  keyListeners.forEach((l) => l());
}

function subscribeStoredKey(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

type LoadState =
  | { status: "idle" }
  | { status: "loading"; matchId: string }
  | { status: "error"; error: MatchLoadError }
  | { status: "loaded"; match: MatchMetadata };

/**
 * One lookup: a newer lookup aborts the older one, so only the latest answer lands.
 * Module-level so the arrival effect and the form share it without stale closures.
 */
async function runLoad(
  matchId: string,
  keepHero: number | null,
  apiKey: string,
  abortRef: RefObject<AbortController | null>,
  setLoad: (s: LoadState) => void,
  setHeroId: (id: number | null) => void,
): Promise<void> {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  setLoad({ status: "loading", matchId });
  try {
    const result = await fetchMatchMetadata(matchId, apiKey, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setLoad({ status: "error", error: result.error });
      return;
    }
    const inMatch = keepHero !== null && result.match.players.some((p) => p.hero_id === keepHero);
    const nextHero = inMatch ? keepHero : null;
    setHeroId(nextHero);
    setLoad({ status: "loaded", match: result.match });
    syncUrl(matchId, nextHero);
  } catch {
    // Aborted by a newer lookup: that lookup owns the state now.
  }
}

/** Puts the match and hero (never the key) in the address bar, so the review can be shared. */
function syncUrl(matchId: string | null, heroId: number | null): void {
  const params = new URLSearchParams();
  if (matchId) params.set("id", matchId);
  if (matchId && heroId !== null) params.set("hero", String(heroId));
  const query = params.toString();
  window.history.replaceState(null, "", query ? `/match?${query}` : "/match");
}

export function MatchReviewClient({
  heroes,
  allItems,
  initialMatchId,
  initialHeroId,
}: MatchReviewClientProps) {
  const [viewMode, setViewMode] = useState<"simplified" | "advanced">("simplified");
  const simplified = viewMode === "simplified";
  const [matchIdInput, setMatchIdInput] = useState(initialMatchId);
  const storedKey = useSyncExternalStore(subscribeStoredKey, readStoredKey, () => null);
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const apiKey = typedKey ?? storedKey ?? "";
  const rememberKey = storedKey !== null;
  const [load, setLoad] = useState<LoadState>({ status: "idle" });
  const [heroId, setHeroId] = useState<number | null>(initialHeroId);
  const abortRef = useRef<AbortController | null>(null);

  const heroById = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  const heroInfo = useMemo(() => {
    const map = new Map<number, MatchHeroInfo>();
    for (const h of heroes) map.set(h.id, { id: h.id, name: h.name, icon: h.icon });
    return map;
  }, [heroes]);
  const heroNames = useMemo(() => new Map(heroes.map((h) => [h.id, h.name])), [heroes]);

  // A shared link (?id=) loads its match on arrival, with any key remembered for this tab.
  useEffect(() => {
    if (!MATCH_ID_PATTERN.test(initialMatchId)) return;
    void runLoad(
      initialMatchId,
      initialHeroId,
      readStoredKey() ?? "",
      abortRef,
      setLoad,
      setHeroId,
    );
  }, [initialMatchId, initialHeroId]);

  function handleSubmit() {
    void runLoad(matchIdInput.trim(), heroId, apiKey, abortRef, setLoad, setHeroId);
  }

  function handleSelectHero(id: number) {
    setHeroId(id);
    if (load.status === "loaded") syncUrl(String(load.match.match_id), id);
  }

  function handleApiKeyChange(value: string) {
    setTypedKey(value);
    if (rememberKey) writeStoredKey(value);
  }

  function handleRememberKeyChange(remember: boolean) {
    writeStoredKey(remember ? apiKey : null);
    setTypedKey(apiKey);
  }

  const match = load.status === "loaded" ? load.match : null;

  const lanes = useMemo<LaneGroup[]>(() => {
    if (!match) return [];
    const byLane = new Map<number, LaneGroup>();
    for (const p of [...match.players].sort((a, b) => a.player_slot - b.player_slot)) {
      let group = byLane.get(p.assigned_lane);
      if (!group) {
        group = {
          lane: p.assigned_lane,
          laneName: LANE_NAMES[p.assigned_lane] ?? String(p.assigned_lane),
          teams: [[], []],
        };
        byLane.set(p.assigned_lane, group);
      }
      const info = heroInfo.get(p.hero_id) ?? {
        id: p.hero_id,
        name: `Hero ${p.hero_id}`,
        icon: null,
      };
      group.teams[p.team === 0 ? 0 : 1].push(info);
    }
    return [...byLane.values()].sort((a, b) => a.lane - b.lane);
  }, [match, heroInfo]);

  const review = useMemo(
    () => (match && heroId !== null ? laneReview(match, heroId, allItems) : null),
    [match, heroId, allItems],
  );

  const laneItems = useMemo<LaneItemView[]>(() => {
    if (!review?.ok) return [];
    const byNumericId = new Map(allItems.map((i) => [i.numericId, i]));
    // Report items come from this same catalogue, so every one resolves.
    return review.report.items.flatMap((it) => {
      const item = byNumericId.get(it.numericId);
      return item
        ? [
            {
              id: it.itemId,
              name: it.name,
              cost: it.cost,
              category: item.category,
              icon: item.icon,
              boughtAt: gameClock(it.boughtAtS),
            },
          ]
        : [];
    });
  }, [review, allItems]);

  // A fresh memory per review: each review hears its own top insights.
  const coachLines = useMemo<CoachLine[]>(() => {
    if (!review?.ok) return [];
    const you = heroById.get(review.report.you.heroId);
    const { context, knownItemNames } = buildMatchCoachContext({
      playerMode: simplified ? "new" : "veteran",
      report: review.report,
      hero: {
        id: review.report.you.heroId,
        name: you?.name ?? "",
        // Not read by the lane insights; CoachContext requires a number.
        complexity: you?.complexity ?? 0,
      },
      heroNames,
      allItems,
    });
    return getCoachMessages(
      context,
      EMPTY_MEMORY,
      knownItemNames,
      MATCH_REVIEW_MAX_MESSAGES,
    ).messages.map((m) => ({ insight: m.insight, text: m.text }));
  }, [review, simplified, heroById, heroNames, allItems]);

  const formError =
    load.status === "error"
      ? loadErrorMessage(load.error)
      : review && !review.ok
        ? NO_REVIEW_MESSAGES[review.reason]
        : null;

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Match review</h1>
              <InfoTooltip content={PAGE_HELP} label="About match review" />
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              How did your lane go? The first 9 minutes against your two lane opponents.
            </p>
          </div>
          <AudienceTabs tabs={VIEW_MODE_TABS} value={viewMode} onChange={setViewMode} />
        </header>

        <MatchLookupForm
          matchId={matchIdInput}
          onMatchIdChange={setMatchIdInput}
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
          rememberKey={rememberKey}
          onRememberKeyChange={handleRememberKeyChange}
          onSubmit={handleSubmit}
          loading={load.status === "loading"}
          error={formError}
          simplified={simplified}
        />

        {match && (
          <MatchHeroPicker
            lanes={lanes}
            selectedHeroId={heroId}
            onSelect={handleSelectHero}
            simplified={simplified}
          />
        )}

        {review?.ok && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <LaneReportPanel
              report={review.report}
              heroes={heroInfo}
              items={laneItems}
              simplified={simplified}
            />
            <LaneCoachPanel messages={coachLines} simplified={simplified} />
          </div>
        )}
      </div>
    </main>
  );
}
