// src/scripts/starterBuildFixtures.ts — live-data regression fixtures for the
// "Start from a suggested build" feature (lib/engine/starterBuild.ts).
//
// Spec: docs/starter-build-use-cases.md (APPROVED). Hard rules H1-H9 are plain
// asserts. Expected leans L4-L6 and the measured phase expectations M1-M3
// (which replaced L1-L3, doc §4.3) go through the ratchet in section 6: a failing
// lean must be listed in KNOWN_LEAN_GAPS, and a listed lean that starts passing
// fails the harness until it is removed.
//
// Live network: reads the same API data the planner does, so results move with
// patches. Node-only (scripts).

import type { Item } from "@/lib/items";
import { MAX_ACTIVE_ITEMS } from "@/lib/buildUtils";
import { componentClosure, heroPairLift } from "@/lib/engine/pairLift";
import { heroCategorySplit, heroPhaseSplits } from "@/lib/engine/categorySplit";
import { heroPhaseItems } from "@/lib/engine/phaseItems";
import type { CategoryShares } from "@/lib/engine/categorySplit";
import { buildStarterBuild } from "@/lib/engine/starterBuild";
import type { StarterBuild, StarterBuildInputs } from "@/lib/engine/starterBuild";
import { deriveHeroDamageModel } from "@/lib/engine/heroBasket";
import { heroDps } from "@/lib/engine/heroDamage";
import { findHero, loadHeroKit, loadLiveBasketData } from "./basketData";
import { applyStarterBuild, isAppliedBuild, itemsRemovedByApply } from "@/lib/starterBuildApply";
import { headlineReason, headlineTerm, measuredPairReason } from "@/lib/basketReasons";
import { SCORE_CATEGORIES } from "@/lib/engine/types";
import { deserializeBuild, getItemAssignments, serializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import type { LiveBasketData, LiveHeroKit } from "./basketData";

type Assert = (condition: boolean, label: string, detail?: string) => void;

export const REFERENCE_HEROES = [
  "Seven",
  "Lady Geist",
  "Haze",
  "Wraith",
  "Infernus",
  "Abrams",
  "Warden",
  "Deadman Danny",
] as const;

/**
 * Expected leans that fail on today's engine (docs/starter-build-use-cases.md
 * section 6, "the ratchet"). The list can only shrink: when a lean starts
 * passing, the fixture fails until its key is removed here.
 */
const KNOWN_LEAN_GAPS: ReadonlySet<string> = new Set<string>([
  // State after the value-scale stack (one value scale, shop budgets + laning
  // tempo, phase items), 2026-10-24: all 24 M1 keys and M2 pass, including the
  // four regressions accepted on 2026-10-20.
  //
  // T1: real Oracle+ players on these heroes RUSH one 3,200 item early (Seven
  // Cultist Sacrifice, Lady Geist Radiant Regeneration, Wraith Tesla Bullets).
  // The shop budget keeps it out of the early phase, so it arrives a phase
  // later as an upgrade (doc §5.7), a reasonable path for a new player.
  "T1:Seven",
  "T1:Lady Geist",
  "T1:Wraith",
]);

/**
 * M3 baseline: mean pairwise Jaccard of the reference heroes' mid phases. May
 * only be lowered (docs/starter-build-use-cases.md §4.3).
 */
// Rebased on the post-patch tables (item scoring review §2.1, 2026-10-25): 0.096.
// Was 0.095 on the 09-24 tables, 0.38 before the value-scale stack.
// Raised once, 0.076 -> 0.0781 (Milestone G3, user-approved 2026-10-25): heal amp put
// Healing Booster in Abrams' and Lady Geist's mid phase, as real players buy it;
// measured overlap 0.08802 (docs/starter-build-use-cases.md M3). Lowered to 0.077
// by the G4 profile refit in fight-value units (2026-10-25).
const MID_OVERLAP_BASELINE = 0.077; // history: 0.096 refit -> 0.076 review C2/C3 -> 0.0781 G3 -> 0.077 G4

/**
 * Noise band for the live ratchets (M3, O2): a refit of the measured tables alone
 * moves them by ~0.01 (2026-10-25). Exact tracking lives in the frozen baselines
 * (lib/engine/__fixtures__/frozen/), which don't drift (item scoring review §2.1).
 */
const LIVE_NOISE = 0.01;

/** Mean M1 distance (L1) to real play across the 24 hero x phase keys (§2.2 gate). */
const MEAN_L1_MAX = 0.12;

/** O1: early picks that must be among the hero's real top 10 early buys. */
const O1_MIN_HITS = 2;
/** T1: allowed gap in the early share of souls on 3,200+ items, engine vs real. */
const T1_TOLERANCE = 0.15;
/**
 * O2 baseline: share of the reference heroes' mid picks that are in the hero's
 * real 10–20 min top 10. May only be raised (docs/starter-build-use-cases.md §4.3).
 */
// Rebased on the post-patch tables (§2.1): 36/53 = 0.679. Was 0.69 (37/53, 2026-10-24).
// Raised to 40/49 = 0.816 by the G4 profile refit in fight-value units (2026-10-25).
const MID_REAL_TOP_BASELINE = 0.816; // baseline history: 0.679 refit -> 0.731 review C2/C3 -> 0.816 G4

const sum = (xs: ReadonlyArray<number>) => xs.reduce((a, b) => a + b, 0);

/**
 * What the player HOLDS after phase `upto` (inclusive), owned items excluded:
 * every phase's items minus components a later upgrade consumed. Leans are
 * measured on this, so an upgrade's full cost isn't double-counted with the
 * component it replaced.
 */
function cumulativeItems(build: StarterBuild, upto: number): Item[] {
  let held: Item[] = [];
  for (const p of build.phases.slice(0, upto + 1)) {
    const gone = new Set(p.consumed.map((i) => i.id));
    held = [...held.filter((i) => !gone.has(i.id)), ...p.items];
  }
  return held;
}

function soulsByCategory(items: ReadonlyArray<Item>) {
  const out = { gun: 0, spirit: 0, vitality: 0 };
  for (const i of items) out[i.category] += i.cost;
  return out;
}

/** Everything held at the end: owned + phase items, minus consumed components. */
function allBuildItems(build: StarterBuild): Item[] {
  let held: Item[] = [...build.ownedItems];
  for (const p of build.phases) {
    const gone = new Set(p.consumed.map((i) => i.id));
    held = [...held.filter((i) => !gone.has(i.id)), ...p.items];
  }
  return held;
}

export async function runStarterBuildFixtures(assert: Assert): Promise<void> {
  const d: LiveBasketData = await loadLiveBasketData();
  const itemById = new Map(d.allItems.map((i) => [i.id, i]));
  const componentsOf = (id: string) => itemById.get(id)?.componentItems;

  const inputsFor = (
    kit: LiveHeroKit,
    over: Partial<StarterBuildInputs> = {},
  ): StarterBuildInputs => ({
    heroAbilities: kit.heroAbilities,
    heroBaseStats: kit.heroBaseStats,
    heroRoster: d.heroRoster,
    allItems: d.allItems,
    ownedItems: [],
    itemAnalytics: d.itemAnalytics,
    heroAccuracy: d.heroAccuracy,
    rankTier: null,
    pairLift: heroPairLift(d.pairLiftTable, kit.hero.id) ?? undefined,
    categorySplit: heroCategorySplit(d.categorySplitTable, kit.hero.id) ?? undefined,
    phaseItems: heroPhaseItems(d.phaseItemsTable, kit.hero.id) ?? undefined,
    ...over,
  });

  // Hard rules H1 / H5 / H6, reused for the fail-open run (H9).
  // H1 at EFFECTIVE cost: an upgrade of a held component costs the difference
  // and consumes it (PR 2c). Checks the pick prices and the held build agree.
  const checkBudget = (b: StarterBuild): string | null => {
    let spent = sum(b.ownedItems.map((i) => i.cost));
    let held: Item[] = [...b.ownedItems];
    for (const p of b.phases) {
      const heldIds = new Set(held.map((i) => i.id));
      for (const pick of p.basket.picks) {
        const consumedCost = sum(
          pick.consumes.map((id) => {
            if (!heldIds.has(id)) return Number.NaN;
            return itemById.get(id)?.cost ?? Number.NaN;
          }),
        );
        if (!Number.isFinite(consumedCost))
          return `${p.phase}: ${pick.item.itemId} consumes an unheld item`;
        if (pick.effectiveCost !== Math.max(0, pick.item.cost - consumedCost)) {
          return `${p.phase}: ${pick.item.itemId} effective ${pick.effectiveCost} != ${pick.item.cost} - ${consumedCost}`;
        }
        spent += pick.effectiveCost;
      }
      const gone = new Set(p.consumed.map((i) => i.id));
      held = [...held.filter((i) => !gone.has(i.id)), ...p.items];
      if (spent > p.souls) return `${p.phase}: spent ${spent} > ${p.souls}`;
      // Souls spent always equal the full cost of what is held (an upgrade's
      // price already includes its consumed component's).
      const heldCost = sum(held.map((i) => i.cost));
      if (heldCost !== spent) return `${p.phase}: held cost ${heldCost} != spent ${spent}`;
    }
    return null;
  };
  const checkPhases = (b: StarterBuild): string | null => {
    const seen = new Set(b.ownedItems.map((i) => i.id));
    const order = b.phases.map((p) => p.phase).join(",");
    if (order !== "early,mid,late") return `phase order ${order}`;
    for (let k = 1; k < b.phases.length; k++) {
      if (b.phases[k].souls <= b.phases[k - 1].souls) return "souls not ascending";
    }
    for (const p of b.phases) {
      for (const i of p.items) {
        if (seen.has(i.id)) return `${i.id} repeated (${p.phase})`;
        seen.add(i.id);
      }
    }
    return null;
  };
  const checkLegal = (b: StarterBuild): string | null => {
    const all = allBuildItems(b);
    if (all.length > MAX_ACTIVE_ITEMS) return `${all.length} items > ${MAX_ACTIVE_ITEMS}`;
    for (const i of all) {
      if (Number(i.tier) === 5) return `${i.id} is tier 5`;
      if (!itemById.has(i.id)) return `${i.id} not in allItems`;
    }
    return null;
  };

  // ---------------------------------------------------------------------
  // Reference heroes
  // ---------------------------------------------------------------------
  const builds = new Map<string, StarterBuild>();
  const kits = new Map<string, LiveHeroKit>();
  for (const name of REFERENCE_HEROES) {
    const hero = findHero(d.heroes, name);
    assert(hero !== undefined, `Reference hero found: ${name}`);
    if (!hero) continue;
    const kit = await loadHeroKit(hero);
    assert(kit !== null, `Hero kit loads: ${name}`);
    if (!kit) continue;
    kits.set(name, kit);
    const build = buildStarterBuild(inputsFor(kit));
    assert(build !== null, `Starter build is produced: ${name}`);
    if (build) builds.set(name, build);
  }

  for (const [name, build] of builds) {
    // H1 — budget at effective cost, consumed components priced in (PR 2c).
    const budgetErr = checkBudget(build);
    assert(budgetErr === null, `H1 budget holds each phase: ${name}`, budgetErr ?? undefined);

    // H2 — a PHASE never holds an item together with its own component
    // (transitively). Upgrading an EARLIER phase's (or an owned) component in a
    // later phase is the normal upgrade path and is allowed (doc §4.1 H2; L6
    // looks for exactly that). Pricing such an upgrade at its effective cost,
    // and showing the component as consumed, is PR 2c (H1).
    const pairs: string[] = [];
    for (const p of build.phases) {
      const ids = new Set(p.items.map((i) => i.id));
      for (const i of p.items) {
        for (const c of componentClosure(i.id, componentsOf)) {
          if (ids.has(c)) pairs.push(`${p.phase}: ${i.id}+${c}`);
        }
      }
    }
    assert(
      pairs.length === 0,
      `H2 no phase holds an item with its own component: ${name}`,
      pairs.join(", "),
    );

    // H3 — every pick has a finite non-zero term and a reason.
    const badPicks: string[] = [];
    for (const p of build.phases) {
      for (const pick of p.basket.picks) {
        const ok = pick.terms.some(
          (t) => Number.isFinite(t.value) && t.value !== 0 && t.reason.trim().length > 0,
        );
        if (!ok) badPicks.push(`${p.phase}:${pick.item.itemId}`);
      }
    }
    assert(badPicks.length === 0, `H3 every pick has a reason: ${name}`, badPicks.join(", "));

    // H4 — deterministic.
    const kit = kits.get(name);
    const again = kit ? buildStarterBuild(inputsFor(kit)) : null;
    assert(
      again !== null && JSON.stringify(again) === JSON.stringify(build),
      `H4 deterministic (two runs identical): ${name}`,
    );

    // H5 — no repeats; phases ordered.
    const phaseErr = checkPhases(build);
    assert(phaseErr === null, `H5 phases ordered, no repeats: ${name}`, phaseErr ?? undefined);

    // H6 — legal items only.
    const legalErr = checkLegal(build);
    assert(legalErr === null, `H6 legal items, within cap: ${name}`, legalErr ?? undefined);
  }

  // H7 — owned items stay out of the phases and are echoed back. That they count
  // toward COVERAGE is asserted hermetically (engine fixtures, section 17) and
  // below: owning coverage changes what the early phase picks.
  const coldFront = d.allItems.find((i) => i.name === "Cold Front");
  const extraHealth = d.allItems.find((i) => i.name === "Extra Health");
  assert(coldFront !== undefined, "H7 setup: Cold Front found");
  assert(extraHealth !== undefined, "H7 setup: Extra Health found");
  const sevenKit = kits.get("Seven");
  if (coldFront && extraHealth && sevenKit) {
    const owned = [coldFront, extraHealth];
    const withOwned = buildStarterBuild(inputsFor(sevenKit, { ownedItems: owned }));
    assert(withOwned !== null, "H7 starter build with owned items is produced");
    if (withOwned) {
      const phaseIds = new Set(withOwned.phases.flatMap((p) => p.items.map((i) => i.id)));
      assert(
        owned.every((i) => !phaseIds.has(i.id)),
        "H7 owned items appear in no phase",
      );
      assert(
        withOwned.ownedItems.length === owned.length &&
          withOwned.ownedItems.every((i, k) => i.id === owned[k].id),
        "H7 result.ownedItems equals the input",
      );
      const err = checkBudget(withOwned) ?? checkPhases(withOwned) ?? checkLegal(withOwned);
      assert(err === null, "H7 owned build still satisfies H1/H5/H6", err ?? undefined);

      // Owned coverage is credited: with nothing consumed, the early basket's
      // final coverage exceeds what its own picks provide by the owned items'.
      const early = withOwned.phases[0].basket;
      const coverageSum = Object.values(early.coverage).reduce((a, b) => a + b, 0);
      const pickSum = sum(
        // Clamped at 0 per category, exactly as the engine sums coverage.
        early.picks.map((p) =>
          Object.values(p.item.categoryValues).reduce((a, b) => a + Math.max(0, b), 0),
        ),
      );
      const consumedAny = early.picks.some((p) => p.consumes.length > 0);
      assert(
        consumedAny || coverageSum > pickSum + 1e-9,
        "H7 owned items count toward coverage (early coverage > its picks' own values)",
        `coverage ${coverageSum.toFixed(1)} vs picks ${pickSum.toFixed(1)}`,
      );
    }
  }

  // A1–A6 — applying the starter build to the planner (Work 2d, lib/starterBuildApply.ts;
  // docs/starter-build-use-cases.md UC1–UC5).
  for (const [name, build] of builds) {
    const applied = applyStarterBuild(build, new Map());
    const finalIds = new Set<string>();
    for (const p of build.phases) {
      for (const c of p.consumed) finalIds.delete(c.id);
      for (const i of p.items) finalIds.add(i.id);
    }
    const ids = applied.items.map((i) => i.id);
    const phaseOf = new Map(build.phases.flatMap((p) => p.items.map((i) => [i.id, p.phase])));
    assert(
      ids.length === finalIds.size &&
        ids.every((id) => finalIds.has(id)) &&
        ids.every((id) => applied.assignments.get(id)?.phase === phaseOf.get(id)) &&
        applied.assignments.size === ids.length,
      `A1 applied build = the final phased items, each in its phase (UC1): ${name}`,
    );
    const active = ids.filter((id) => applied.assignments.get(id)?.active);
    const earlyHeld = ids.filter((id) => phaseOf.get(id) === "early");
    assert(
      active.length <= MAX_ACTIVE_ITEMS &&
        earlyHeld.every((id) => applied.assignments.get(id)?.active) &&
        applied.boonLevel === build.phases[build.phases.length - 1].boonLevel,
      `A2 early items active, <= ${MAX_ACTIVE_ITEMS} active, slider at the late checkpoint: ${name}`,
      `active ${active.length}, early ${earlyHeld.length}`,
    );
    const state: BuildState = {
      heroId: "1",
      itemIds: ids,
      abilityLevels: {},
      heroLevel: applied.boonLevel,
      categories: [],
      phases: ids.map((id) => applied.assignments.get(id)?.phase ?? null),
      active: ids.map((id) => applied.assignments.get(id)?.active ?? false),
      sell: ids.map(() => false),
      optional: ids.map(() => false),
    };
    const back = getItemAssignments(deserializeBuild(serializeBuild(state)));
    assert(
      back.length === ids.length &&
        back.every(
          (a, k) =>
            a.itemId === ids[k] &&
            a.phase === applied.assignments.get(a.itemId)?.phase &&
            a.active === applied.assignments.get(a.itemId)?.active,
        ),
      `A4 the share link reproduces the applied build (UC5): ${name}`,
    );

    // A3 — a build reopened from that link is recognised as the applied build
    // (UC3); changing one flag or dropping one item is not. Rebuilt from the
    // link, so isAppliedBuild never compares an object with itself.
    const reopenedItems = back.flatMap((a) => itemById.get(a.itemId) ?? []);
    const asAssignments = new Map(
      back.map((a) => [
        a.itemId,
        { phase: a.phase, active: a.active, sellPriority: a.sellPriority, optional: a.optional },
      ]),
    );
    const flipped = new Map(asAssignments);
    const firstId = ids[0];
    const first = firstId ? flipped.get(firstId) : undefined;
    if (firstId && first) flipped.set(firstId, { ...first, sellPriority: !first.sellPriority });
    assert(
      ids.length > 0 &&
        isAppliedBuild(reopenedItems, asAssignments, applied) &&
        !isAppliedBuild(reopenedItems, flipped, applied) &&
        !isAppliedBuild(reopenedItems.slice(1), asAssignments, applied) &&
        itemsRemovedByApply([], applied).length === 0 &&
        JSON.stringify([...applyStarterBuild(build, new Map()).assignments]) ===
          JSON.stringify([...applied.assignments]),
      `A3 deterministic; a reopened link is recognised as applied, an edited build is not (UC3): ${name}`,
    );
  }

  // P1 — the simplified view's one-line reason is plain English (UC1): every
  // pick's headline term carries a `plain` line, free of internal category keys.
  for (const [name, build] of builds) {
    const bad: string[] = [];
    for (const p of build.phases) {
      for (const pick of p.basket.picks) {
        const top = headlineTerm(pick.terms);
        const text = headlineReason(pick.terms) ?? "";
        if (!top?.plain || SCORE_CATEGORIES.some((k) => /[A-Z]/.test(k) && text.includes(k))) {
          bad.push(`${pick.item.name}: ${text}`);
        }
      }
    }
    assert(bad.length === 0, `P1 every headline reason is plain English: ${name}`, bad.join(" | "));
  }

  // P2 — the measured pair lift is never the headline; where it argues for a
  // pick, the simplified view shows it as its own labelled line (review §2.4).
  {
    let withPair = 0;
    const bad: string[] = [];
    for (const [name, build] of builds) {
      for (const p of build.phases) {
        for (const pick of p.basket.picks) {
          if (headlineTerm(pick.terms)?.termId === "pair-lift") {
            bad.push(`${name}: ${pick.item.name} headlines the pair lift`);
          }
          const pairUp = pick.terms.some((t) => t.termId === "pair-lift" && t.value > 0);
          if (pairUp) withPair += 1;
          if (pairUp !== (measuredPairReason(pick.terms) !== null)) {
            bad.push(`${name}: ${pick.item.name} measured line mismatch`);
          }
        }
      }
    }
    assert(
      bad.length === 0,
      `P2 the pair lift is never a headline and shows as a measured line (${withPair} picks carry one)`,
      bad.join(" | "),
    );
  }

  // A5 — owned items keep their place and flags; only components an upgrade
  // trades in leave, and those are exactly what the player confirms (UC2, UC3).
  {
    const owned = coldFront && extraHealth ? [coldFront, extraHealth] : [];
    const sb =
      owned.length === 2 && sevenKit
        ? buildStarterBuild(inputsFor(sevenKit, { ownedItems: owned }))
        : null;
    assert(sb !== null, "A5 setup: Seven's starter build with owned items is produced");
    if (sb) {
      const ownedFlags = new Map(
        owned.map((i, k) => [
          i.id,
          { phase: null, active: true, sellPriority: k === 0, optional: false },
        ]),
      );
      const applied = applyStarterBuild(sb, ownedFlags);
      const consumed = new Set(sb.phases.flatMap((p) => p.consumed.map((i) => i.id)));
      const keptOwned = owned.filter((i) => !consumed.has(i.id));
      assert(
        keptOwned.every(
          (i) =>
            applied.items.some((x) => x.id === i.id) &&
            JSON.stringify(applied.assignments.get(i.id)) === JSON.stringify(ownedFlags.get(i.id)),
        ) &&
          itemsRemovedByApply(owned, applied)
            .map((i) => i.id)
            .sort()
            .join() ===
            [...consumed]
              .filter((id) => ownedFlags.has(id))
              .sort()
              .join(),
        "A5 owned items and their flags are kept; exactly the traded-in components leave",
        `consumed ${[...consumed].join(", ") || "none"}`,
      );
    }
  }

  // A6 — an upgrade takes over the active slot of the component it trades in.
  // A7 — on a full active build, the upgrade keeps the slot its traded-in
  //      component held even when a cheaper early item is bought first.
  {
    const base = builds.values().next().value;
    const proto = d.allItems[0];
    assert(base !== undefined && proto !== undefined, "A6/A7 setup: a reference build exists");
    if (base && proto) {
      const fake = (id: string, componentItems: string[] = []): Item => ({
        ...proto,
        id,
        componentItems,
      });
      const comp = fake("fx_component");
      const upg = fake("fx_upgrade", ["fx_component"]);
      const other = fake("fx_other");
      const [early, mid] = base.phases;
      const synthetic: StarterBuild = {
        ownedItems: [],
        phases: [
          { ...early, items: [comp], buyOrder: [comp], consumed: [] },
          { ...mid, items: [upg, other], buyOrder: [other, upg], consumed: [comp] },
        ],
      };
      const applied = applyStarterBuild(synthetic, new Map());
      assert(
        applied.items.map((i) => i.id).join() === "fx_other,fx_upgrade" &&
          applied.assignments.get("fx_upgrade")?.active === true &&
          applied.assignments.get("fx_other")?.active === false &&
          !applied.assignments.has("fx_component") &&
          itemsRemovedByApply([comp], applied)
            .map((i) => i.id)
            .join() === "fx_component",
        "A6 an upgrade inherits its traded-in component's active slot; other later items wait in the game plan",
        JSON.stringify([...applied.assignments]),
      );

      // 12 active owned items, one of them traded in this early phase for an
      // upgrade bought AFTER a cheap item: the upgrade takes the freed slot.
      const ownedFull = Array.from({ length: MAX_ACTIVE_ITEMS - 1 }, (_, k) =>
        fake(`fx_owned_${k}`),
      );
      ownedFull.push(comp);
      const fullFlags = new Map(
        ownedFull.map((i) => [
          i.id,
          { phase: null, active: true, sellPriority: false, optional: false },
        ]),
      );
      const cheap = fake("fx_cheap");
      const full: StarterBuild = {
        ownedItems: ownedFull,
        phases: [{ ...early, items: [upg, cheap], buyOrder: [cheap, upg], consumed: [comp] }],
      };
      const fullApplied = applyStarterBuild(full, fullFlags);
      const activeIds = [...fullApplied.assignments].filter(([, a]) => a.active).map(([id]) => id);
      assert(
        activeIds.length === MAX_ACTIVE_ITEMS &&
          fullApplied.assignments.get("fx_upgrade")?.active === true &&
          fullApplied.assignments.get("fx_cheap")?.active === false &&
          !fullApplied.assignments.has("fx_component"),
        "A7 at the cap, an upgrade keeps its component's slot before cheaper early items claim one",
        `active ${activeIds.length}: ${activeIds.join(", ")}`,
      );
    }
  }

  // H8 — every visible hero gets a non-empty early phase.
  const failures: string[] = [];
  let checked = 0;
  const BATCH = 6;
  for (let k = 0; k < d.heroes.length; k += BATCH) {
    const batch = d.heroes.slice(k, k + BATCH);
    const results = await Promise.all(
      batch.map(async (hero): Promise<string | null> => {
        try {
          const kit = await loadHeroKit(hero);
          if (!kit) return `${hero.name} (no base stats)`;
          const b = buildStarterBuild(inputsFor(kit));
          if (!b) return `${hero.name} (null build)`;
          if (b.phases[0].items.length === 0) return `${hero.name} (empty early)`;
          return null;
        } catch (err) {
          return `${hero.name} (kit error: ${err instanceof Error ? err.message : String(err)})`;
        }
      }),
    );
    for (const r of results) {
      checked++;
      if (r) failures.push(r);
    }
  }
  assert(
    checked === d.heroes.length && failures.length === 0,
    `H8 every visible hero has a non-empty early phase (${checked - failures.length}/${d.heroes.length})`,
    failures.join("; "),
  );

  // H9 — fails open: no analytics, accuracy or pair data.
  for (const name of REFERENCE_HEROES) {
    const kit = kits.get(name);
    if (!kit) continue;
    const b = buildStarterBuild(
      inputsFor(kit, {
        itemAnalytics: new Map(),
        heroAccuracy: undefined,
        pairLift: undefined,
        categorySplit: undefined,
        phaseItems: undefined,
      }),
    );
    const err = b ? (checkBudget(b) ?? checkPhases(b) ?? checkLegal(b)) : "null build";
    assert(
      b !== null && b.phases[0].items.length > 0 && err === null,
      `H9 fails open (no analytics / pairs / category split / phase items): ${name}`,
      err ?? undefined,
    );
  }

  // ---------------------------------------------------------------------
  // Expected leans, with the ratchet (doc section 6)
  // ---------------------------------------------------------------------
  const ratchet = (key: string, pass: boolean, detail: string) => {
    const listed = KNOWN_LEAN_GAPS.has(key);
    if (pass && listed) {
      assert(false, `${key} now passes — remove it from KNOWN_LEAN_GAPS`, detail);
    } else if (pass) {
      assert(true, `${key}: ${detail}`);
    } else if (listed) {
      console.log(`  ⏳ known gap ${key}: ${detail}`);
    } else {
      assert(false, `${key} fails and is not in KNOWN_LEAN_GAPS`, detail);
    }
  };

  // Kit-only reference (informational, never asserted): the same reference
  // heroes with no measured split, so it stays visible how much of each lean
  // comes from the engine's own reasoning versus the population prior.
  for (const name of REFERENCE_HEROES) {
    const kit = kits.get(name);
    if (!kit) continue;
    const b = buildStarterBuild(inputsFor(kit, { categorySplit: undefined }));
    if (!b) continue;
    const late = soulsByCategory(cumulativeItems(b, b.phases.length - 1));
    const total = late.gun + late.spirit + late.vitality;
    const pct = (v: number) => `${Math.round((v / Math.max(1, total)) * 100)}%`;
    console.log(
      `  ℹ kit-only late ${name}: gun ${pct(late.gun)} spirit ${pct(late.spirit)} vitality ${pct(late.vitality)}`,
    );
  }

  // M1 — phase fidelity (doc §4.3, replaces L1–L3): each reference hero's
  // early / mid / late shop split is within L1 0.30 of Oracle+ play. Early and
  // mid compare the items that phase ADDS with what players BUY in 0–10 / 10–20
  // min; late compares everything held with the final inventory.
  const M1_TOLERANCE = 0.3;
  const sharesOf = (items: ReadonlyArray<Item>) => {
    const s = soulsByCategory(items);
    const t = s.gun + s.spirit + s.vitality;
    return t > 0
      ? { gun: s.gun / t, spirit: s.spirit / t, vitality: s.vitality / t }
      : { gun: 0, spirit: 0, vitality: 0 };
  };
  const l1 = (a: CategoryShares, b: CategoryShares) =>
    Math.abs(a.gun - b.gun) + Math.abs(a.spirit - b.spirit) + Math.abs(a.vitality - b.vitality);
  const fmtSplit = (s: CategoryShares) =>
    `${Math.round(s.gun * 100)}/${Math.round(s.spirit * 100)}/${Math.round(s.vitality * 100)}`;
  const m1Distances: number[] = [];
  for (const name of REFERENCE_HEROES) {
    const b = builds.get(name);
    const kit = kits.get(name);
    const real = kit ? heroPhaseSplits(d.categorySplitTable, kit.hero.id) : null;
    assert(real !== null, `M1 setup: measured phase splits exist for ${name}`);
    if (!b || !real) continue;
    const engine = {
      early: sharesOf(b.phases[0].items),
      mid: sharesOf(b.phases[1].items),
      late: sharesOf(cumulativeItems(b, b.phases.length - 1)),
    };
    for (const phase of ["early", "mid", "late"] as const) {
      const dist = l1(engine[phase], real[phase]);
      m1Distances.push(dist);
      ratchet(
        `M1:${name}:${phase}`,
        dist <= M1_TOLERANCE,
        `${phase} real ${fmtSplit(real[phase])} engine ${fmtSplit(engine[phase])} d=${dist.toFixed(2)} (need <= ${M1_TOLERANCE})`,
      );
    }
  }

  const meanL1 = m1Distances.length > 0 ? sum(m1Distances) / m1Distances.length : 1;
  assert(
    m1Distances.length === REFERENCE_HEROES.length * 3 && meanL1 <= MEAN_L1_MAX,
    `M1 mean distance to real play ${meanL1.toFixed(3)} <= ${MEAN_L1_MAX} (${m1Distances.length} keys)`,
  );

  // C1 lean (docs/item-scoring-review.md §2.2): on live kits, a DPS ability is
  // priced per cast (rate x seconds), so Seven's and Abrams' ability DPS is at
  // least what it was when one cast counted as one second.
  for (const name of ["Seven", "Abrams"] as const) {
    const kit = kits.get(name);
    if (!kit) continue;
    const modelFor = (abilities: LiveHeroKit["heroAbilities"]) =>
      deriveHeroDamageModel({
        baseStats: kit.heroBaseStats,
        abilities,
        boonLevel: 16,
        spiritPower: 30,
        accuracy: 0.5,
      });
    const now = modelFor(kit.heroAbilities);
    const perSecondOnly = modelFor(
      kit.heroAbilities.map((a) => ({ ...a, damageSeconds: undefined })),
    );
    const rateAbilities = kit.heroAbilities.filter((a) => (a.damageSeconds ?? 0) > 1);
    assert(
      now !== undefined &&
        perSecondOnly !== undefined &&
        rateAbilities.length > 0 &&
        heroDps(now).ability >= heroDps(perSecondOnly).ability,
      `C1 lean: ${name}'s DPS abilities are priced per cast (${rateAbilities.map((a) => `${a.name} x${a.damageSeconds}s`).join(", ")})`,
      now && perSecondOnly
        ? `ability DPS ${heroDps(now).ability.toFixed(1)} vs ${heroDps(perSecondOnly).ability.toFixed(1)} per second only`
        : "no damage model",
    );
  }

  // M2 — early diversity: >= 4 distinct early phases across the reference
  // heroes, and no single item in every one of them.
  {
    const earlies = [...builds.values()].map((b) => b.phases[0].items.map((i) => i.id).sort());
    const distinct = new Set(earlies.map((e) => e.join(","))).size;
    const counts = new Map<string, number>();
    for (const e of earlies) for (const id of e) counts.set(id, (counts.get(id) ?? 0) + 1);
    const everywhere = [...counts].filter(([, n]) => n === earlies.length).map(([id]) => id);
    ratchet(
      "M2",
      earlies.length > 0 && distinct >= 4 && everywhere.length === 0,
      `${distinct} distinct early phases of ${earlies.length} (need >= 4); in every early phase: ${everywhere.join(", ") || "none"}`,
    );
  }

  // M3 — mid-game overlap only falls: mean pairwise Jaccard of the reference
  // heroes' mid phases stays <= the recorded baseline, which may only be lowered.
  // A value well under the baseline fails too, until the baseline is lowered
  // to it, so an improvement is locked in rather than silently given back.
  {
    const mids = [...builds.values()].map((b) => new Set(b.phases[1].items.map((i) => i.id)));
    let sumJ = 0;
    let pairs = 0;
    for (let x = 0; x < mids.length; x++) {
      for (let y = x + 1; y < mids.length; y++) {
        const inter = [...mids[x]].filter((id) => mids[y].has(id)).length;
        const union = new Set([...mids[x], ...mids[y]]).size;
        sumJ += union > 0 ? inter / union : 1;
        pairs++;
      }
    }
    const overlap = pairs > 0 ? sumJ / pairs : 1;
    assert(
      overlap <= MID_OVERLAP_BASELINE + LIVE_NOISE + 1e-9,
      `M3 mid-phase overlap ${overlap.toFixed(3)} <= baseline ${MID_OVERLAP_BASELINE} + noise ${LIVE_NOISE}`,
    );
    assert(
      overlap >= MID_OVERLAP_BASELINE - 0.02,
      `M3 mid-phase overlap ${overlap.toFixed(3)} has not fallen well below the baseline (lower MID_OVERLAP_BASELINE to lock it in)`,
    );
  }

  // O1 / O2 / T1 — the build looks like real play on THIS hero (doc §4.3,
  // 2026-10-24). Measured against heroPhaseItems.json, the table phaseItemTerm
  // reads, so they check the engine follows it without breaking M1–M3.
  const topIds = (rates: Readonly<Record<string, number>>, n: number) =>
    new Set(
      Object.entries(rates)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, n)
        .map(([id]) => id),
    );
  let midHits = 0;
  let midPicks = 0;
  for (const name of REFERENCE_HEROES) {
    const b = builds.get(name);
    const kit = kits.get(name);
    const rates = kit ? heroPhaseItems(d.phaseItemsTable, kit.hero.id) : null;
    assert(rates !== null, `O1 setup: measured phase items exist for ${name}`);
    if (!b || !rates) continue;
    // O1 — at least 2 early picks among the hero's real top 10 early buys.
    const earlyTop = topIds(rates.early, 10);
    const hits = b.phases[0].items.filter((i) => earlyTop.has(i.id)).length;
    ratchet(
      `O1:${name}`,
      hits >= O1_MIN_HITS,
      `${hits} of ${b.phases[0].items.length} early picks in the real top 10 (need >= ${O1_MIN_HITS})`,
    );
    const midTop = topIds(rates.mid, 10);
    midHits += b.phases[1].items.filter((i) => midTop.has(i.id)).length;
    midPicks += b.phases[1].items.length;
    // T1 — tempo: the early share of souls in 3,200+ items is within 15 points
    // of real play (Σ buy rate × cost over the hero's early purchases).
    let realBig = 0;
    let realAll = 0;
    for (const [id, rate] of Object.entries(rates.early)) {
      const cost = itemById.get(id)?.cost ?? 0;
      realAll += rate * cost;
      if (cost >= 3200) realBig += rate * cost;
    }
    const picks = b.phases[0].basket.picks;
    const paid = sum(picks.map((p) => p.effectiveCost));
    const big = sum(picks.filter((p) => p.item.cost >= 3200).map((p) => p.effectiveCost));
    const engineShare = paid > 0 ? big / paid : 0;
    const realShare = realAll > 0 ? realBig / realAll : 0;
    ratchet(
      `T1:${name}`,
      Math.abs(engineShare - realShare) <= T1_TOLERANCE,
      `early souls in 3,200+ items: engine ${Math.round(engineShare * 100)}%, real ${Math.round(realShare * 100)}% (need within ${T1_TOLERANCE * 100} pts)`,
    );
  }
  // Informational, never asserted: the same overlap WITHOUT the phase-item
  // signal. O1/O2 read the table phaseItemTerm is tuned on, so this line keeps
  // visible how much of the overlap the engine reaches on its own (audit
  // 2026-10-24).
  {
    let earlyHits = 0;
    let midHitsOff = 0;
    let midPicksOff = 0;
    for (const name of REFERENCE_HEROES) {
      const kit = kits.get(name);
      const rates = kit ? heroPhaseItems(d.phaseItemsTable, kit.hero.id) : null;
      if (!kit || !rates) continue;
      const b = buildStarterBuild(inputsFor(kit, { phaseItems: undefined }));
      if (!b) continue;
      const earlyTop = topIds(rates.early, 10);
      const midTop = topIds(rates.mid, 10);
      earlyHits += b.phases[0].items.filter((i) => earlyTop.has(i.id)).length;
      midHitsOff += b.phases[1].items.filter((i) => midTop.has(i.id)).length;
      midPicksOff += b.phases[1].items.length;
    }
    console.log(
      `  ℹ without phase items: ${earlyHits} early picks and ${midHitsOff}/${midPicksOff} mid picks in the real top 10`,
    );
  }

  // O2 — mid picks in the hero's real 10–20 min top 10: a numeric ratchet that
  // may only rise (like M3, inverted).
  {
    const share = midPicks > 0 ? midHits / midPicks : 0;
    assert(
      share >= MID_REAL_TOP_BASELINE - LIVE_NOISE - 1e-9,
      `O2 ${midHits}/${midPicks} mid picks (${share.toFixed(3)}) in the real mid top 10 >= baseline ${MID_REAL_TOP_BASELINE} - noise ${LIVE_NOISE}`,
    );
    assert(
      share <= MID_REAL_TOP_BASELINE + 0.05,
      `O2 share ${share.toFixed(3)} has not risen well above the baseline (raise MID_REAL_TOP_BASELINE to lock it in)`,
    );
  }

  // L4 — archetypes differ: late-build Jaccard <= 0.5.
  const lateIds = (name: string): Set<string> => {
    const b = builds.get(name);
    return new Set(b ? cumulativeItems(b, b.phases.length - 1).map((i) => i.id) : []);
  };
  for (const [a, b] of [
    ["Seven", "Haze"],
    ["Lady Geist", "Haze"],
  ] as const) {
    const sa = lateIds(a);
    const sb = lateIds(b);
    const inter = [...sa].filter((x) => sb.has(x)).length;
    const union = new Set([...sa, ...sb]).size;
    const j = union > 0 ? inter / union : 1;
    ratchet(
      `L4:${a}/${b}`,
      union > 0 && j <= 0.5,
      `late Jaccard ${j.toFixed(2)} (${inter} shared of ${union}; need <= 0.50)`,
    );
  }

  // L5 — the early phase uses its souls: >= 2 items, < 800 souls unspent.
  for (const name of REFERENCE_HEROES) {
    const b = builds.get(name);
    if (!b) continue;
    const early = b.phases[0];
    const cost = sum(early.items.map((i) => i.cost));
    const left = early.souls - sum(b.ownedItems.map((i) => i.cost)) - cost;
    ratchet(
      `L5:${name}`,
      early.items.length >= 2 && left < 800,
      `${early.items.length} items, ${left} souls left of ${early.souls}`,
    );
  }

  // L6 — upgrade paths appear: some later-phase pick actually CONSUMED an
  // earlier phase's component (a real upgrade, priced at the difference).
  {
    const found: string[] = [];
    for (const [name, b] of builds) {
      for (const p of b.phases.slice(1)) {
        for (const pick of p.basket.picks) {
          for (const c of pick.consumes) found.push(`${name}: ${c} -> ${pick.item.itemId}`);
        }
      }
    }
    ratchet(
      "L6",
      found.length > 0,
      found.length > 0 ? `${found.length} upgrade path(s), e.g. ${found[0]}` : "no upgrade paths",
    );
  }
}
