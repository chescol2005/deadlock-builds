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
  // Measured 2026-10-20 after PR 2c (doc section 5.4). L3 and L4 were removed
  // by PR 2c (owned coverage).
  "L1:Seven",
  "L1:Lady Geist",
  "L2:Haze",
  // Re-listed in PR 2c (user decision 2026-10-20), an explained exception to
  // "the list only shrinks": its earlier pass was an artifact of the double
  // count (F3), where upgrade stats were stacked on the component's. With
  // correct pricing an upgrade adds only the difference, and the basket ranks by
  // value, not value per soul, so fresh items win. Needs a soul-efficiency /
  // slot-pressure signal (planned after the need-vector PR).
  "L6",
]);

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
      inputsFor(kit, { itemAnalytics: new Map(), heroAccuracy: undefined, pairLift: undefined }),
    );
    const err = b ? (checkBudget(b) ?? checkPhases(b) ?? checkLegal(b)) : "null build";
    assert(
      b !== null && b.phases[0].items.length > 0 && err === null,
      `H9 fails open (no analytics / pairs): ${name}`,
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

  const phaseNames = ["early", "mid", "late"];
  const cumShares = (name: string) => {
    const b = builds.get(name);
    if (!b) return [];
    return b.phases.map((_, k) => soulsByCategory(cumulativeItems(b, k)));
  };
  const fmtShares = (name: string) =>
    cumShares(name)
      .map((s, k) => `${phaseNames[k]} gun ${s.gun} spirit ${s.spirit}`)
      .join("; ");

  // L1 — spirit casters lean spirit in every phase.
  for (const name of ["Seven", "Lady Geist"]) {
    const shares = cumShares(name);
    ratchet(
      `L1:${name}`,
      shares.length > 0 && shares.every((s) => s.spirit >= s.gun),
      fmtShares(name),
    );
  }

  // L2 — Haze leans gun in every phase.
  {
    const shares = cumShares("Haze");
    ratchet(
      "L2:Haze",
      shares.length > 0 && shares.every((s) => s.gun >= s.spirit),
      fmtShares("Haze"),
    );
  }

  // L3 — tanks get durability: late vitality >= 30% of late souls.
  for (const name of ["Abrams", "Warden"]) {
    const shares = cumShares(name);
    const late = shares[shares.length - 1];
    const total = late ? late.gun + late.spirit + late.vitality : 0;
    const frac = total > 0 && late ? late.vitality / total : 0;
    ratchet(
      `L3:${name}`,
      total > 0 && frac >= 0.3,
      `late vitality ${late?.vitality ?? 0} / ${total} = ${(frac * 100).toFixed(1)}% (need 30%)`,
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
