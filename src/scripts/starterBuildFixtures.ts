// src/scripts/starterBuildFixtures.ts — live-data regression fixtures for the
// "Start from a suggested build" feature (lib/engine/starterBuild.ts).
//
// Spec: docs/starter-build-use-cases.md (APPROVED). Hard rules H1-H9 are plain
// asserts. Expected leans L1-L6 go through the ratchet in section 6: a failing
// lean must be listed in KNOWN_LEAN_GAPS, and a listed lean that starts passing
// fails the harness until it is removed.
//
// Live network: reads the same API data the planner does, so results move with
// patches. Node-only (scripts).

import type { Item } from "@/lib/items";
import { MAX_ACTIVE_ITEMS } from "@/lib/buildUtils";
import { componentClosure, heroPairLift } from "@/lib/engine/pairLift";
import { heroCategorySplit, heroPhaseSplits } from "@/lib/engine/categorySplit";
import type { CategoryShares } from "@/lib/engine/categorySplit";
import { buildStarterBuild } from "@/lib/engine/starterBuild";
import type { StarterBuild, StarterBuildInputs } from "@/lib/engine/starterBuild";
import { findHero, loadHeroKit, loadLiveBasketData } from "./basketData";
import type { LiveBasketData, LiveHeroKit } from "./basketData";

type Assert = (condition: boolean, label: string, detail?: string) => void;

const REFERENCE_HEROES = [
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
  // State after coverage-model PR 2 (phase-aware split + stat profile) stacked on
  // PR 1, 2026-10-20: 11 of 24 M1 keys pass (6 on main). STACKED: the pair may
  // only merge when this list is a subset of main's (doc §4.3). Still regressed
  // vs main: Wraith:early, Abrams:early, Abrams:late, Warden:early. Cause:
  // item valuation (the gun items players open with score little per soul).
  "M1:Seven:mid",
  "M1:Lady Geist:early",
  "M1:Lady Geist:mid",
  "M1:Haze:early",
  "M1:Haze:mid",
  "M1:Haze:late",
  "M1:Wraith:early",
  "M1:Wraith:late",
  "M1:Infernus:mid",
  "M1:Abrams:early",
  "M1:Abrams:late",
  "M1:Warden:early",
  "M1:Deadman Danny:early",
  "M2",
]);

/**
 * M3 baseline: mean pairwise Jaccard of the reference heroes' mid phases. May
 * only be lowered (docs/starter-build-use-cases.md §4.3).
 */
const MID_OVERLAP_BASELINE = 0.38; // main 0.377; PR 1+2 measure 0.373 (2026-10-20)

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
      }),
    );
    const err = b ? (checkBudget(b) ?? checkPhases(b) ?? checkLegal(b)) : "null build";
    assert(
      b !== null && b.phases[0].items.length > 0 && err === null,
      `H9 fails open (no analytics / pairs / category split): ${name}`,
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
      ratchet(
        `M1:${name}:${phase}`,
        dist <= M1_TOLERANCE,
        `${phase} real ${fmtSplit(real[phase])} engine ${fmtSplit(engine[phase])} d=${dist.toFixed(2)} (need <= ${M1_TOLERANCE})`,
      );
    }
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
      overlap <= MID_OVERLAP_BASELINE + 1e-9,
      `M3 mid-phase overlap ${overlap.toFixed(3)} <= baseline ${MID_OVERLAP_BASELINE}`,
    );
    assert(
      overlap >= MID_OVERLAP_BASELINE - 0.02,
      `M3 mid-phase overlap ${overlap.toFixed(3)} has not fallen well below the baseline (lower MID_OVERLAP_BASELINE to lock it in)`,
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
