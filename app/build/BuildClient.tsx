"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeadlockHeroListItem, ShopItem, ShopCategory, SignatureSlot, AbilityLevel, AbilityLevels } from "@/lib/deadlock";
import { serializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import { getItemAssignments } from "@/lib/buildSerializer";
import { ItemBrowser } from "@/app/build/components/ItemBrowser";
import { AbilityLevelingPanel } from "@/app/build/components/AbilityLevelingPanel";
import { BuildSummaryPanel } from "@/app/build/components/BuildSummaryPanel";
import { SuggestedItemsPanel } from "@/app/build/components/SuggestedItemsPanel";
import { CategoryManager } from "@/app/build/components/CategoryManager";
import type {
  AssignmentData,
  BuildCategory,
  Item,
  ItemAssignment,
  ItemDestination,
} from "@/lib/items";
import type { BuildGoal } from "@/lib/scoring/goalWeights";
import {
  canActivateItem,
  cleanAssignmentMap,
  cleanCategories,
  getConsumedComponents,
  MAX_ACTIVE_ITEMS,
  resolveAddItem,
} from "@/lib/buildUtils";
import { arrayMove } from "@dnd-kit/sortable";
import type { HeroBaseStats } from "@/lib/heroStats";
import { calculateStatsAtBoon } from "@/lib/heroStats";
import type { HeroAbility } from "@/lib/abilityCoefficients";
import { totalPointsSpent, pointCostForNextLevel } from "@/lib/abilityCoefficients";
import {
  BOON_THRESHOLDS,
  getAbilityPointsAtSouls,
  getAbilityUnlocksAtSouls,
} from "@/lib/boonSystem";
import { calculateStatTotals, combineStatTotal } from "@/lib/buildCalculations";
import type { StatTotals } from "@/lib/buildCalculations";
import { InfoTooltip } from "@/app/components/Tooltip";
import { HeroDifficultyBadge } from "@/app/components/HeroDifficultyBadge";
import { AudienceTabs } from "@/app/components/AudienceTabs";
import { BuildEmptyState } from "@/app/build/components/BuildEmptyState";
import { HeroStatsPanel } from "@/app/build/components/HeroStatsPanel";
import { HeroBasketSuggestion } from "@/app/build/components/HeroBasketSuggestion";
import type { HeroAccuracy, ItemAnalytics } from "@/lib/analyticsStore";
import { resolveAccuracyAtRank } from "@/lib/analyticsStore";
import type { RankTierRaw } from "@/lib/api/analyticsApi";
import { constructBasket, makeBasketContext } from "@/lib/engine/basketSelect";
import { deriveHeroNeedVector, deriveProcPlatformFactor } from "@/lib/engine/heroNeed";
import { toItemCandidates } from "@/lib/engine/itemAdapter";

const VIEW_MODE_TABS = [
  { value: "simplified", label: "Simplified" },
  { value: "advanced", label: "Advanced" },
] as const;

const GOALS: { value: BuildGoal; label: string }[] = [
  { value: "burst", label: "Burst" },
  { value: "dps", label: "DPS" },
  { value: "tank", label: "Tank" },
  { value: "sustain", label: "Sustain" },
  { value: "mobility", label: "Mobility" },
];

const DEFAULT_ASSIGNMENT: AssignmentData = {
  phase: null,
  active: false,
  sellPriority: false,
  optional: false,
};

export default function BuildClient({
  heroes,
  selectedHeroId,
  upgrades,
  heroAbilities = [],
  heroBaseStats = null,
  initialState = null,
  allItems = [],
  heroRoster = [],
  itemAnalytics,
  heroAccuracy,
  rankTiers = [],
}: {
  heroes: DeadlockHeroListItem[];
  selectedHeroId: string | null;
  upgrades: ShopItem[];
  heroAbilities?: HeroAbility[];
  heroBaseStats?: HeroBaseStats | null;
  initialState?: BuildState | null;
  allItems?: Item[];
  /** Every visible hero's base stats — the cross-hero baseline the need vector
   * normalizes against. Empty is safe: deriveHeroNeedVector degrades to a
   * neutral tankiness/mobility need rather than failing. */
  heroRoster?: HeroBaseStats[];
  /** Real per-item win rates, keyed by Item.numericId. Optional by design —
   * the analytics fetcher fails open, and the basket engine treats a missing
   * map as "no empirical signal" rather than an error. */
  itemAnalytics?: ReadonlyMap<number, ItemAnalytics>;
  /** Observed shot accuracy per hero, overall and by rank tier. Optional —
   * the analytics fetchers fail open, and gun need falls back to nominal DPS. */
  heroAccuracy?: ReadonlyMap<number, HeroAccuracy>;
  /** Rank tiers (0 Obscurus … 11 Eternus), fetched from /v1/assets/ranks. */
  rankTiers?: RankTierRaw[];
}) {
  const router = useRouter();
  const [heroId, setHeroId] = useState<string>(selectedHeroId ?? "");
  const [activeTab, setActiveTab] = useState<ShopCategory>("weapon");
  const [selectedGoal, setSelectedGoal] = useState<BuildGoal>("burst");
  // New players should never see the full complexity at once — default to
  // the simplified view; veterans opt into Advanced for full control.
  const [viewMode, setViewMode] = useState<"simplified" | "advanced">("simplified");
  const simplified = viewMode === "simplified";

  // The player's own rank, used only to pick which accuracy sample to discount
  // gun DPS by. null = "don't know / all ranks", which uses each hero's pooled
  // accuracy — so stating a rank can only refine the estimate, never break it.
  const [selectedRankTier, setSelectedRankTier] = useState<number | null>(null);

  const [buildItems, setBuildItems] = useState<Item[]>(() => {
    if (!initialState) return [];
    const byId = new Map(allItems.map((i) => [i.id, i]));
    return initialState.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  });

  const [abilityLevels, setAbilityLevels] = useState<AbilityLevels>(
    initialState?.abilityLevels ?? {},
  );

  const [manualBoonLevel, setManualBoonLevel] = useState<number>(
    initialState?.heroLevel ?? 0,
  );

  const [categories, setCategories] = useState<BuildCategory[]>(
    initialState?.categories ?? [],
  );

  const [assignmentMap, setAssignmentMap] = useState<Map<string, AssignmentData>>(() => {
    if (!initialState) return new Map();
    const assignments = getItemAssignments(initialState);
    return new Map(
      assignments.map((a) => [
        a.itemId,
        {
          phase: a.phase,
          active: a.active,
          sellPriority: a.sellPriority,
          optional: a.optional,
        },
      ]),
    );
  });

  const [activeError, setActiveError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const cleanedCategories = useMemo(
    () => cleanCategories(categories, buildItems),
    [categories, buildItems],
  );

  // Derived, not hand-synced: filters out stale entries for items no longer in
  // buildItems (e.g. left behind when resolveAddItem silently drops a consumed
  // component) so callers never have to remember to prune assignmentMap themselves.
  const cleanedAssignmentMap = useMemo(
    () => cleanAssignmentMap(assignmentMap, buildItems),
    [assignmentMap, buildItems],
  );

  const selectedIds = useMemo(() => new Set(buildItems.map((it) => it.id)), [buildItems]);

  const selectedHero = useMemo(
    () => heroes.find((h) => String(h.id) === String(heroId)),
    [heroes, heroId],
  );

  const activeCount = useMemo(
    () => Array.from(cleanedAssignmentMap.values()).filter((a) => a.active).length,
    [cleanedAssignmentMap],
  );

  const itemAssignments = useMemo<ItemAssignment[]>(
    () =>
      buildItems.map((it) => {
        const a = cleanedAssignmentMap.get(it.id) ?? DEFAULT_ASSIGNMENT;
        return {
          itemId: it.id,
          phase: a.phase,
          active: a.active,
          sellPriority: a.sellPriority,
          optional: a.optional,
        };
      }),
    [buildItems, cleanedAssignmentMap],
  );

  const boonSouls = useMemo(
    () => BOON_THRESHOLDS[manualBoonLevel]?.souls ?? 0,
    [manualBoonLevel],
  );
  const availableAbilityPoints = useMemo(
    () => getAbilityPointsAtSouls(boonSouls),
    [boonSouls],
  );
  const unlockedAbilitySlots = useMemo(
    () => getAbilityUnlocksAtSouls(boonSouls),
    [boonSouls],
  );
  const pointsSpent = useMemo(() => totalPointsSpent(abilityLevels), [abilityLevels]);

  const itemStatTotals = useMemo(
    () => calculateStatTotals(buildItems, itemAssignments),
    [buildItems, itemAssignments],
  );

  const totalSpiritPower = useMemo(() => {
    if (!heroBaseStats) return 0;
    const base = calculateStatsAtBoon(heroBaseStats, manualBoonLevel).spiritPower;
    return combineStatTotal(base, itemStatTotals.spiritPowerFlat, itemStatTotals.spiritPowerPercent);
  }, [heroBaseStats, manualBoonLevel, itemStatTotals]);

  const totalWeaponDamage = useMemo(() => {
    if (!heroBaseStats) return 0;
    const base = calculateStatsAtBoon(heroBaseStats, manualBoonLevel).bulletDamage;
    return combineStatTotal(base, itemStatTotals.weaponDamageFlat, itemStatTotals.weaponDamagePercent);
  }, [heroBaseStats, manualBoonLevel, itemStatTotals]);

  function handleLevelChange(slot: SignatureSlot, level: AbilityLevel) {
    setAbilityLevels((prev) => ({ ...prev, [slot]: level }));
  }

  function handleToggleItem(shopItem: ShopItem) {
    const item = allItems.find((i) => i.id === shopItem.id);
    if (!item) return;
    setBuildItems((prev) =>
      prev.some((it) => it.id === item.id)
        ? prev.filter((it) => it.id !== item.id)
        : resolveAddItem(prev, item),
    );
  }

  const consumedComponents = useMemo(() => getConsumedComponents(buildItems), [buildItems]);

  function handleAddSuggestedItem(item: Item) {
    setBuildItems((prev) =>
      prev.some((it) => it.id === item.id) ? prev : resolveAddItem(prev, item),
    );
  }

  function handleRemoveItem(itemId: string) {
    setBuildItems((prev) => prev.filter((it) => it.id !== itemId));
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
    setCategories((prev) =>
      prev.map((c) => ({ ...c, itemIds: c.itemIds.filter((id) => id !== itemId) })),
    );
  }

  function handleItemMove(itemId: string, dest: ItemDestination) {
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(itemId) ?? { ...DEFAULT_ASSIGNMENT };
      switch (dest.type) {
        case "phase":
          next.set(itemId, { ...cur, phase: dest.phase });
          break;
        case "category":
        case "uncategorized":
          next.set(itemId, { ...cur, phase: null });
          break;
      }
      return next;
    });

    if (dest.type === "category") {
      setCategories((prev) =>
        prev.map((c) => {
          if (c.id === dest.categoryId) {
            return {
              ...c,
              itemIds: c.itemIds.includes(itemId) ? c.itemIds : [...c.itemIds, itemId],
            };
          }
          return { ...c, itemIds: c.itemIds.filter((id) => id !== itemId) };
        }),
      );
    } else {
      setCategories((prev) =>
        prev.map((c) => ({ ...c, itemIds: c.itemIds.filter((id) => id !== itemId) })),
      );
    }
  }

  function handleToggleSellPriority(itemId: string) {
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(itemId) ?? { ...DEFAULT_ASSIGNMENT };
      next.set(itemId, { ...cur, sellPriority: !cur.sellPriority });
      return next;
    });
  }

  function handleToggleOptional(itemId: string) {
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(itemId) ?? { ...DEFAULT_ASSIGNMENT };
      const newOptional = !cur.optional;
      next.set(itemId, { ...cur, optional: newOptional, active: newOptional ? false : cur.active });
      return next;
    });
  }

  function handleReorderBuildItems(itemId: string, overId: string) {
    setBuildItems((prev) => {
      const from = prev.findIndex((it) => it.id === itemId);
      const to = prev.findIndex((it) => it.id === overId);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function handleToggleActive(itemId: string) {
    // The cap check must happen INSIDE the functional updater, computed from
    // `prev` at update time — reading activeCount/cleanedAssignmentMap from the
    // outer closure is a stale render-time snapshot, so two toggles dispatched
    // before a re-render could both pass the same check and both commit,
    // exceeding MAX_ACTIVE_ITEMS (a TOCTOU race). The updater itself only sets
    // assignmentMap; the block reason is captured in this closure variable and
    // surfaced via setActiveError afterward, once the atomic update is done.
    let blockedReason: string | null = null;

    setAssignmentMap((prev) => {
      const cur = prev.get(itemId) ?? DEFAULT_ASSIGNMENT;
      if (cur.optional) return prev;

      const isCurrentlyActive = cur.active;
      if (!isCurrentlyActive) {
        // Recompute active count from `prev` (this update's actual input), not
        // the outer closure's activeCount, and restrict to items still present
        // in buildItems to match cleanedAssignmentMap's semantics.
        const buildIds = new Set(buildItems.map((it) => it.id));
        const liveActiveCount = Array.from(prev.entries()).filter(
          ([id, a]) => buildIds.has(id) && a.active,
        ).length;
        const result = canActivateItem(liveActiveCount, cur.optional);
        if (!result.allowed) {
          blockedReason = result.reason ?? "Active build full — remove an active item first";
          return prev;
        }
      }

      const next = new Map(prev);
      next.set(itemId, { ...cur, active: !isCurrentlyActive });
      return next;
    });

    if (blockedReason) {
      setActiveError(blockedReason);
      setTimeout(() => setActiveError(null), 3000);
    }
  }

  async function handleCopyShareLink() {
    const state: BuildState = {
      heroId,
      itemIds: buildItems.map((it) => it.id),
      abilityLevels,
      heroLevel: manualBoonLevel,
      categories: cleanedCategories,
      phases: buildItems.map((it) => cleanedAssignmentMap.get(it.id)?.phase ?? null),
      active: buildItems.map((it) => cleanedAssignmentMap.get(it.id)?.active ?? false),
      sell: buildItems.map((it) => cleanedAssignmentMap.get(it.id)?.sellPriority ?? false),
      optional: buildItems.map((it) => cleanedAssignmentMap.get(it.id)?.optional ?? false),
    };
    const encoded = serializeBuild(state);
    const url = `${window.location.origin}${window.location.pathname}?build=${encoded}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      setFailedUrl(null);
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      setFailedUrl(url);
    }
  }

  // Hero-need basket (Milestone E). Distinct from SuggestedItemsPanel, which
  // ranks every candidate INDEPENDENTLY against a player-chosen goal preset:
  // this derives what the hero's own kit needs and then picks a SET of items
  // that jointly covers it across gun/spirit/vitality.
  //
  // The soul budget is whatever the current boon level affords minus what the
  // build already commits, so the basket answers "what should I buy at this
  // point in the game?" and grows as the boon slider moves. No invented
  // budget: BOON_THRESHOLDS[0] is the real 600 starting souls.
  const heroBasket = useMemo(() => {
    if (!heroBaseStats || heroAbilities.length === 0 || allItems.length === 0) return null;

    // Discount each hero's nominal gun DPS by how much of it actually lands at
    // the player's own rank. Nominal DPS assumes perfect accuracy, which
    // over-rates spread weapons that count every pellet.
    const gunAccuracyByHeroId = heroAccuracy
      ? resolveAccuracyAtRank(heroAccuracy, selectedRankTier)
      : undefined;

    const needVector = deriveHeroNeedVector({
      abilities: heroAbilities,
      baseStats: heroBaseStats,
      roster: heroRoster,
      gunAccuracyByHeroId,
    });

    const ownedIds = new Set(buildItems.map((i) => i.id));

    // Item values are NOT flat — Mystic Shot's proc is `40 + 0.9 x spirit
    // power`, so pricing it at 40 understates it ~3.3x at 100 spirit. Resolve
    // the published coefficients against what the player actually has.
    //
    // Both inputs come from the hero and the ALREADY-OWNED build, never from
    // the candidates being chosen: an item's value must not depend on which
    // other items the basket happens to pick, or selection becomes circular.
    const candidates = toItemCandidates(
      allItems.filter((i) => !ownedIds.has(i.id)),
      { spiritPower: totalSpiritPower, boonLevel: manualBoonLevel },
    );

    const committed = buildItems.reduce((sum, i) => sum + i.cost, 0);

    // Separate from gun need on purpose: a bullet proc's worth scales with how
    // many bullets LAND per second, not with how hard each one hits. The two
    // genuinely diverge — a hero can have the roster's weakest gun and still be
    // one of its best platforms for per-hit items.
    const procPlatformFactor = deriveProcPlatformFactor({
      baseStats: heroBaseStats,
      roster: heroRoster,
      gunAccuracyByHeroId,
    });

    const ctx = makeBasketContext({
      needVector,
      soulBudget: Math.max(0, boonSouls - committed),
      maxItems: Math.max(0, MAX_ACTIVE_ITEMS - buildItems.length),
      itemAnalytics,
      procPlatformFactor,
    });

    return constructBasket(candidates, ctx);
  }, [
    heroBaseStats,
    heroAbilities,
    heroRoster,
    allItems,
    buildItems,
    boonSouls,
    itemAnalytics,
    heroAccuracy,
    selectedRankTier,
    totalSpiritPower,
    manualBoonLevel,
  ]);

  const ultimateUnlocked = manualBoonLevel >= 7;

  return (
    <main style={{ padding: 32 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Build</h1>

        <select
          value={heroId}
          onChange={(e) => {
            const next = e.target.value;
            setHeroId(next);
            setBuildItems([]);
            setAbilityLevels({});
            setCategories([]);
            setAssignmentMap(new Map());
            if (!next) router.push("/build");
            else router.push(`/build/${next}`);
          }}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <option value="">Select a hero…</option>
          {heroes.map((h) => (
            <option key={h.id} value={String(h.id)}>
              {h.name}
            </option>
          ))}
        </select>

        <Link
          href="/items"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            color: "rgba(255,255,255,0.85)",
            textDecoration: "none",
          }}
        >
          Browse Items
        </Link>

        {selectedHero ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {selectedHero.images?.icon_image_small_webp || selectedHero.images?.icon_image_small ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  selectedHero.images.icon_image_small_webp ??
                  selectedHero.images.icon_image_small
                }
                alt={selectedHero.name}
                width={40}
                height={40}
                style={{ borderRadius: 10 }}
              />
            ) : null}

            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, lineHeight: 1.1 }}>{selectedHero.name}</span>
                <HeroDifficultyBadge complexity={selectedHero.complexity} />
              </div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{selectedHero.class_name}</div>
            </div>
          </div>
        ) : null}

        {heroId ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 600 }}>Goal:</span>
            {GOALS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setSelectedGoal(value)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: `1px solid ${selectedGoal === value ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)"}`,
                  background:
                    selectedGoal === value ? "rgba(255,255,255,0.15)" : "transparent",
                  color: "inherit",
                  fontWeight: selectedGoal === value ? 700 : 400,
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {heroId ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AudienceTabs tabs={VIEW_MODE_TABS} value={viewMode} onChange={setViewMode} />
            <InfoTooltip content="Simplified hides veteran-only detail (raw coefficients, soul-investment math, sell/optional flags) so you can focus on picking items. Switch to Advanced any time for full control." />
          </div>
        ) : null}

        {heroId ? (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 8,
              alignItems: "center",
              position: "relative",
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.5 }}>
              {activeCount}/{MAX_ACTIVE_ITEMS} active · {buildItems.length} items
            </span>
            <button
              onClick={() => {
                setBuildItems([]);
                setCategories([]);
                setAssignmentMap(new Map());
              }}
              disabled={buildItems.length === 0}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "inherit",
                cursor: buildItems.length === 0 ? "not-allowed" : "pointer",
                opacity: buildItems.length === 0 ? 0.4 : 1,
                fontSize: 12,
              }}
            >
              Clear
            </button>
            <button
              onClick={handleCopyShareLink}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background:
                  copyState === "copied" ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.12)",
                color: copyState === "copied" ? "#4ade80" : "inherit",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: "nowrap",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {copyState === "copied" ? "Copied!" : "Copy Share Link"}
            </button>
            {copyState === "failed" && failedUrl ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "#1e1e2e",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  zIndex: 50,
                  minWidth: 320,
                  maxWidth: 400,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  Clipboard unavailable — copy manually:
                </div>
                <input
                  readOnly
                  value={failedUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {!heroId ? (
        <BuildEmptyState />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px minmax(0, 1fr) 300px 260px",
            gap: 0,
            marginTop: 24,
            alignItems: "start",
            justifyContent: "stretch",
          }}
        >
          {/* Left panel */}
          <div>
            {/* Boon level control */}
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: `1px solid ${ultimateUnlocked ? "rgba(250,204,21,0.4)" : manualBoonLevel === 6 ? "rgba(250,204,21,0.25)" : "rgba(255,255,255,0.12)"}`,
                background: ultimateUnlocked
                  ? "rgba(250,204,21,0.08)"
                  : manualBoonLevel === 6
                    ? "rgba(250,204,21,0.04)"
                    : "rgba(255,255,255,0.04)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.7 }}>Boon Level</span>
                <InfoTooltip content="Boon Level simulates how far into a match you are — it estimates the souls you've earned and unlocks ability points, ability slots, and stat scaling as it rises. Use it to preview your build at different points in a game." />
                <button
                  onClick={() => setManualBoonLevel(Math.max(0, manualBoonLevel - 1))}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 5,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "inherit",
                    cursor: manualBoonLevel > 0 ? "pointer" : "not-allowed",
                    opacity: manualBoonLevel > 0 ? 1 : 0.35,
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  −
                </button>
                <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700, fontSize: 15 }}>
                  {manualBoonLevel}
                </span>
                <button
                  onClick={() => setManualBoonLevel(Math.min(35, manualBoonLevel + 1))}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 5,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "inherit",
                    cursor: manualBoonLevel < 35 ? "pointer" : "not-allowed",
                    opacity: manualBoonLevel < 35 ? 1 : 0.35,
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
                <span style={{ fontSize: 12, color: "#888" }}>
                  {availableAbilityPoints} ability pts
                </span>
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  opacity: 0.7,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {pointsSpent}/{availableAbilityPoints} pts used
                </span>
                <span style={{ fontSize: 11, opacity: 0.65 }}>
                  {manualBoonLevel === 0 ? "0 souls" : `~${boonSouls.toLocaleString()} souls`}
                </span>
              </div>
              {ultimateUnlocked ? (
                <div style={{ marginTop: 4, fontSize: 11, color: "#facc15", fontWeight: 600 }}>
                  ⚡ Ultimate unlocked
                </div>
              ) : manualBoonLevel === 6 ? (
                <div style={{ marginTop: 4, fontSize: 11, color: "#facc15" }}>
                  1 boon to ultimate unlock
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.45 }}>
                  Ultimate unlocks at boon 7
                </div>
              )}
            </div>

            {/* Hero base stats */}
            {heroBaseStats ? (
              <HeroStatsPanel
                stats={heroBaseStats}
                heroLevel={manualBoonLevel}
                itemTotals={itemStatTotals}
              />
            ) : null}

            <AbilityLevelingPanel
              abilities={heroAbilities}
              abilityLevels={abilityLevels}
              onLevelChange={handleLevelChange}
              availableAbilityPoints={availableAbilityPoints}
              unlockedAbilitySlots={unlockedAbilitySlots}
              planSouls={boonSouls}
              spiritPower={totalSpiritPower}
              weaponDamage={totalWeaponDamage}
              pointsSpent={pointsSpent}
              pointCostForNextLevel={pointCostForNextLevel}
              simplified={simplified}
            />
          </div>

          {/* Center panel */}
          <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            {buildItems.length === 0 ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(250,204,21,0.3)",
                  background: "rgba(250,204,21,0.06)",
                  fontSize: 13,
                }}
              >
                No items yet — browse the shop below and click an item to add it to your build.
              </div>
            ) : null}
            <CategoryManager
              categories={cleanedCategories}
              buildItems={buildItems}
              itemAssignments={itemAssignments}
              onCategoriesChange={setCategories}
              onItemMove={handleItemMove}
              onRemoveBuildItem={handleRemoveItem}
              onToggleActive={handleToggleActive}
              onToggleSellPriority={handleToggleSellPriority}
              onToggleOptional={handleToggleOptional}
              onReorderBuildItems={handleReorderBuildItems}
              consumedComponents={consumedComponents}
              simplified={simplified}
            />

            <ItemBrowser
              items={upgrades}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              selectedIds={selectedIds}
              onToggle={handleToggleItem}
              slotsFull={false}
            />
          </div>

          {/* Right panel */}
          <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <BuildSummaryPanel
              selectedItems={buildItems}
              assignments={itemAssignments}
              activeError={activeError}
              onToggleActive={handleToggleActive}
              manualBoonLevel={manualBoonLevel}
              allItems={allItems}
              heroAbilities={heroAbilities}
              abilityLevels={abilityLevels}
              itemStatTotals={itemStatTotals}
              simplified={simplified}
            />
          </div>

          {/* Far right panel */}
          <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <SuggestedItemsPanel
              allItems={allItems}
              currentBuild={buildItems}
              selectedGoal={selectedGoal}
              onAdd={handleAddSuggestedItem}
              consumedComponents={consumedComponents}
              slotsFull={false}
              simplified={simplified}
            />

            {/* Additive surface — deliberately alongside SuggestedItemsPanel,
                not replacing it. The two answer different questions: "what is
                the best next item for my goal?" vs. "what set of items covers
                this hero's needs?" */}
            {/* Tailwind-only per the Component Patterns rule. The inline styles
                elsewhere in this file predate that convention — don't copy them
                into new markup. */}
            <div className="mt-4">
              {rankTiers.length > 0 && heroAccuracy && heroAccuracy.size > 0 && (
                <div className="mb-2.5">
                  <label
                    htmlFor="rank-tier"
                    className="mb-1 flex items-center gap-1.5 text-xs text-zinc-300"
                  >
                    Your rank
                    <InfoTooltip content="Higher-ranked players land a larger share of their shots, so gun items are worth more to them. Setting your rank re-scores how much this hero's gun is worth investing in, using real hit-rate data for players at that rank. Leave on 'All ranks' if you're not sure." />
                  </label>
                  <select
                    id="rank-tier"
                    value={selectedRankTier ?? ""}
                    onChange={(e) =>
                      setSelectedRankTier(e.target.value === "" ? null : Number(e.target.value))
                    }
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                  >
                    <option value="">All ranks (average)</option>
                    {rankTiers
                      .filter((t) => t.tier > 0)
                      .map((t) => (
                        <option key={t.tier} value={t.tier}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <HeroBasketSuggestion
                basket={heroBasket}
                allItems={allItems}
                onAdd={handleAddSuggestedItem}
                slotsFull={false}
                simplified={simplified}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
