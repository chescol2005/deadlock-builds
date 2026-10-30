"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { Item } from "@/lib/items";
import {
  LANE_NAMES,
  MAX_RANK_TIER,
  MIN_RANK_TIER,
  benchmarkLane,
  defaultBenchmarkTier,
  laneReview,
  parsePlayerId,
} from "@/lib/matchReview";
import type { CurvePoint, RecentMatch } from "@/lib/matchReview";
import type { MatchMetadata } from "@/lib/matchReview";
import { buildMatchCoachContext, gameClock } from "@/lib/matchReviewCoachContext";
import { EMPTY_MEMORY, MATCH_REVIEW_MAX_MESSAGES, getCoachMessages } from "@/lib/coach";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import { InfoTooltip } from "@/app/components/Tooltip";
import { MatchLookupForm } from "./components/MatchLookupForm";
import { MatchHeroPicker } from "./components/MatchHeroPicker";
import { LaneReportPanel } from "./components/LaneReportPanel";
import { LaneCoachPanel } from "./components/LaneCoachPanel";
import { LaneBenchmarkPanel } from "./components/LaneBenchmarkPanel";
import {
  MATCH_ID_PATTERN,
  fetchMatchHistory,
  fetchMatchMetadata,
  fetchPerformanceCurve,
} from "./matchApi";
import type { MatchLoadError } from "./matchApi";
import {
  NO_BENCHMARK_MESSAGES,
  NO_REVIEW_MESSAGES,
  PLAYER_ID_MESSAGES,
  loadErrorMessage,
} from "./matchMessages";
import { RecentMatchesPanel } from "./components/RecentMatchesPanel";
import type {
  BenchmarkView,
  CoachLine,
  LaneGroup,
  LaneItemView,
  MatchHeroInfo,
  RankOption,
  RecentMatchView,
} from "./matchViewTypes";

export interface MatchPageHero extends MatchHeroInfo {
  /** Valve's 1–4 difficulty; null when the API has none. */
  complexity: number | null;
}

interface MatchReviewClientProps {
  heroes: ReadonlyArray<MatchPageHero>;
  allItems: ReadonlyArray<Item>;
  /** Rank tier names (`/v1/assets/ranks`); may be empty, then tiers show as "Rank N". */
  rankNames: ReadonlyArray<{ tier: number; name: string }>;
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

/**
 * The player's recent matches. The account id lives only in this state: never in the
 * URL (a shared review must not expose a Steam account) and never in storage.
 */
type HistoryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; matches: RecentMatch[] };

const PLAYED_AT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

/** The curve fetched for one hero and bracket; `curve` null = it couldn't be loaded. */
interface CurveState {
  key: string;
  curve: CurvePoint | null;
}

function curveKey(heroId: number, tier: number | null): string {
  return `${heroId}:${tier ?? "all"}`;
}

/**
 * Loads the typical player's 9:00 point (docs/match-review-use-cases.md §10). A newer
 * load aborts the older one; a failure lands as a null curve ("unavailable").
 */
async function runCurveLoad(
  heroId: number,
  tier: number | null,
  apiKey: string,
  abortRef: RefObject<AbortController | null>,
  setCurve: (s: CurveState) => void,
): Promise<void> {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  try {
    const curve = await fetchPerformanceCurve(heroId, tier, apiKey, controller.signal);
    if (!controller.signal.aborted) setCurve({ key: curveKey(heroId, tier), curve });
  } catch {
    // Aborted by a newer load: that load owns the state now.
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
  rankNames,
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
  const [playerInput, setPlayerInput] = useState("");
  const [history, setHistory] = useState<HistoryState>({ status: "idle" });
  const historyAbortRef = useRef<AbortController | null>(null);
  // The benchmark bracket the visitor picked, for one review only: a new match or hero
  // starts again from that player's own rank (§10.2). Never in the URL.
  const [tierChoice, setTierChoice] = useState<{ reviewKey: string; tier: number | null } | null>(
    null,
  );
  const [curveState, setCurveState] = useState<CurveState | null>(null);
  const curveAbortRef = useRef<AbortController | null>(null);
  // The key for the benchmark call, read when it starts (typing it doesn't refetch).
  const apiKeyRef = useRef(apiKey);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

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
    if (history.status === "error") setHistory({ status: "idle" });
    void runLoad(matchIdInput.trim(), heroId, apiKey, abortRef, setLoad, setHeroId);
  }

  async function handleFindMatches() {
    const parsed = parsePlayerId(playerInput);
    if (!parsed.ok) {
      setHistory({ status: "error", message: PLAYER_ID_MESSAGES[parsed.reason] });
      return;
    }
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;
    setHistory({ status: "loading" });
    try {
      const result = await fetchMatchHistory(parsed.accountId, apiKey, controller.signal);
      if (controller.signal.aborted) return;
      setHistory(
        result.ok
          ? { status: "loaded", matches: result.matches }
          : { status: "error", message: loadErrorMessage(result.error) },
      );
    } catch {
      // Aborted by a newer lookup: that lookup owns the state now.
    }
  }

  /** A recent match: load it with the hero the player used already picked. */
  function handleSelectRecent(m: RecentMatchView) {
    setMatchIdInput(String(m.matchId));
    void runLoad(String(m.matchId), m.hero.id, apiKey, abortRef, setLoad, setHeroId);
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

  const reviewKey = review?.ok ? `${review.report.matchId}:${review.report.you.heroId}` : null;
  const benchmarkTier = useMemo(() => {
    if (!review?.ok) return null;
    return tierChoice?.reviewKey === reviewKey
      ? tierChoice.tier
      : defaultBenchmarkTier(review.report);
  }, [review, reviewKey, tierChoice]);
  const benchmarkHeroId = review?.ok ? review.report.you.heroId : null;

  useEffect(() => {
    if (benchmarkHeroId === null) return;
    void runCurveLoad(
      benchmarkHeroId,
      benchmarkTier,
      apiKeyRef.current,
      curveAbortRef,
      setCurveState,
    );
  }, [benchmarkHeroId, benchmarkTier]);

  const rankOptions = useMemo<RankOption[]>(() => {
    const names = new Map(rankNames.map((r) => [r.tier, r.name]));
    const tiers: RankOption[] = [];
    for (let t = MIN_RANK_TIER; t <= MAX_RANK_TIER; t += 1) {
      tiers.push({ tier: t, name: names.get(t) ?? `Rank ${t}` });
    }
    return [{ tier: null, name: "All ranks" }, ...tiers];
  }, [rankNames]);

  const benchmarkView = useMemo<BenchmarkView>(() => {
    if (!review?.ok || benchmarkHeroId === null) return { status: "loading" };
    if (curveState?.key !== curveKey(benchmarkHeroId, benchmarkTier)) return { status: "loading" };
    const result = benchmarkLane(review.report, curveState.curve, benchmarkTier);
    return result.ok
      ? { status: "ok", benchmark: result.benchmark }
      : { status: "none", message: NO_BENCHMARK_MESSAGES[result.reason] };
  }, [review, benchmarkHeroId, benchmarkTier, curveState]);

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
      benchmark:
        benchmarkView.status === "ok"
          ? {
              result: benchmarkView.benchmark,
              rankName:
                benchmarkTier === null
                  ? null
                  : (rankOptions.find((r) => r.tier === benchmarkTier)?.name ?? null),
            }
          : null,
    });
    return getCoachMessages(
      context,
      EMPTY_MEMORY,
      knownItemNames,
      MATCH_REVIEW_MAX_MESSAGES,
    ).messages.map((m) => ({ insight: m.insight, text: m.text }));
  }, [
    review,
    simplified,
    heroById,
    heroNames,
    allItems,
    benchmarkView,
    benchmarkTier,
    rankOptions,
  ]);

  const recentViews = useMemo<RecentMatchView[]>(
    () =>
      history.status === "loaded"
        ? history.matches.map((m) => ({
            matchId: m.matchId,
            hero: heroInfo.get(m.heroId) ?? { id: m.heroId, name: `Hero ${m.heroId}`, icon: null },
            won: m.won,
            kills: m.kills,
            deaths: m.deaths,
            assists: m.assists,
            duration: gameClock(m.durationS),
            playedAt: PLAYED_AT.format(new Date(m.startTime * 1000)),
          }))
        : [],
    [history, heroInfo],
  );

  const formError =
    history.status === "error"
      ? history.message
      : load.status === "error"
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
          playerInput={playerInput}
          onPlayerInputChange={setPlayerInput}
          onFindMatches={() => void handleFindMatches()}
          historyLoading={history.status === "loading"}
          error={formError}
          simplified={simplified}
        />

        {history.status === "loaded" && (
          <RecentMatchesPanel
            matches={recentViews}
            selectedMatchId={match?.match_id ?? null}
            onSelect={handleSelectRecent}
            simplified={simplified}
          />
        )}

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
            <div className="flex min-w-0 flex-col gap-6">
              <LaneReportPanel
                report={review.report}
                heroes={heroInfo}
                items={laneItems}
                simplified={simplified}
              />
              <LaneBenchmarkPanel
                heroName={heroById.get(review.report.you.heroId)?.name ?? "player"}
                ranks={rankOptions}
                tier={benchmarkTier}
                onTierChange={(tier) => reviewKey && setTierChoice({ reviewKey, tier })}
                view={benchmarkView}
                simplified={simplified}
              />
            </div>
            <LaneCoachPanel messages={coachLines} simplified={simplified} />
          </div>
        )}
      </div>
    </main>
  );
}
