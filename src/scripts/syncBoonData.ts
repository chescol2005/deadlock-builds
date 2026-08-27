// src/scripts/syncBoonData.ts — re-derive lib/boonSystem.ts from the live API
// Run: npm run sync-boon-data
// Manual maintenance script — NOT part of the runtime/app request path.
// Rarely run by hand when Valve changes the boon/soul progression table.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { BOON_THRESHOLDS, ABILITY_SLOT_UNLOCK_SOULS, type BoonThreshold } from "@/lib/boonSystem";

const BOON_FILE = "lib/boonSystem.ts";
const FREE_STARTING_SOULS = 600;

// Thrown for expected, already-logged abort conditions. Caught at the bottom
// and turned into process.exitCode instead of process.exit(), because forcing
// process.exit() while Node's fetch() keep-alive handles are still settling
// crashes tsx on Windows (libuv assertion in src\win\async.c). Letting the
// event loop drain naturally avoids that entirely.
class ScriptExitError extends Error {
  constructor(public code: number) {
    super(`script exit ${code}`);
  }
}

// Minimal inline type — intentionally NOT imported from lib/api/deadlockApi.ts,
// so this script stays self-contained and off the runtime path.
type LevelInfo = Record<string, { required_gold: number; bonus_currencies?: string[] }>;

async function fetchLevelInfo(heroId: number): Promise<LevelInfo> {
  const res = await fetch(`https://api.deadlock-api.com/v1/assets/heroes/${heroId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch hero ${heroId}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.level_info;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function spliceBetweenMarkers(src: string, name: string, replacement: string): string {
  const startMarker = `// GENERATED:${name}:START`;
  const endMarker = `// GENERATED:${name}:END`;
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    console.error(
      `❌ Could not find markers ${startMarker} / ${endMarker} in ${BOON_FILE}.\n` +
        `   The file structure changed — this script needs updating. Aborting without writing.`,
    );
    throw new ScriptExitError(1);
  }
  const before = src.slice(0, startIdx + startMarker.length);
  const after = src.slice(endIdx);
  return `${before}\n${replacement}\n${after}`;
}

async function main() {
  console.log("\n=== Deadlock Foundry — sync-boon-data ===\n");

  console.log("Fetching hero 1 and hero 2 level_info...");
  const [hero1, hero2] = await Promise.all([fetchLevelInfo(1), fetchLevelInfo(2)]);

  if (!deepEqual(hero1, hero2)) {
    console.error("❌ hero 1 and hero 2 level_info differ!");
    console.error(
      "   This script assumes boon/soul progression is hero-independent (previously\n" +
        "   verified identical on hero ids 1 and 2). That assumption may no longer\n" +
        "   hold — investigate manually before trusting any derived table.",
    );
    throw new ScriptExitError(1);
  }
  console.log("✅ hero 1 and hero 2 level_info are identical — hero-independence holds.\n");

  // Sort levels ascending numerically (level_info keys are level numbers as strings)
  const levels = Object.keys(hero1)
    .map(Number)
    .sort((a, b) => a - b);

  const computed: BoonThreshold[] = [];
  const abilityUnlockSouls: number[] = [];
  let cumulativeAbilityPoints = 0;

  levels.forEach((level, i) => {
    const entry = hero1[String(level)];
    const bonusCurrencies = entry.bonus_currencies ?? [];
    const isAbilityUnlock = bonusCurrencies.includes("EAbilityUnlocks");
    const isAbilityPoint = bonusCurrencies.includes("EAbilityPoints");
    const souls = entry.required_gold + FREE_STARTING_SOULS;

    // abilityPoints on THIS row = cumulative count of EAbilityPoints levels seen
    // so far INCLUDING this row if this row itself grants a point (a row is never
    // both an unlock row and a points row, so unlock rows are naturally excluded —
    // matching "not including the current row if the current row is an unlock row").
    if (isAbilityPoint) cumulativeAbilityPoints += 1;

    computed.push({
      souls,
      boonLevel: i + 1,
      abilityUnlock: isAbilityUnlock,
      abilityPoints: cumulativeAbilityPoints,
      isUltimateUnlock: false, // patched below once we know which unlock is last
    });

    if (isAbilityUnlock) abilityUnlockSouls.push(souls);
  });

  // Mark the last (chronological) ability-unlock row as the ultimate unlock
  const unlockIndices = computed
    .map((row, i) => (row.abilityUnlock ? i : -1))
    .filter((i) => i !== -1);
  const lastUnlockIndex = unlockIndices[unlockIndices.length - 1];
  if (lastUnlockIndex !== undefined) {
    computed[lastUnlockIndex] = { ...computed[lastUnlockIndex], isUltimateUnlock: true };
  }

  // ---- Validate before writing anything ----
  const fail = (msg: string): never => {
    console.error(`❌ Validation failed: ${msg}`);
    throw new ScriptExitError(1);
  };

  if (computed.length !== 36) fail(`expected 36 rows, got ${computed.length}`);
  computed.forEach((row, i) => {
    if (row.boonLevel !== i + 1) fail(`boonLevel out of order at index ${i}: ${row.boonLevel}`);
  });
  if (computed[0].souls !== 600) fail(`first souls value must be 600, got ${computed[0].souls}`);
  for (let i = 1; i < computed.length; i++) {
    if (computed[i].souls <= computed[i - 1].souls) {
      fail(`souls not strictly increasing at boonLevel ${computed[i].boonLevel}`);
    }
  }
  const unlockCount = computed.filter((r) => r.abilityUnlock).length;
  if (unlockCount !== 4) fail(`expected exactly 4 abilityUnlock rows, got ${unlockCount}`);
  const ultimateRows = computed.filter((r) => r.isUltimateUnlock);
  if (ultimateRows.length !== 1)
    fail(`expected exactly 1 isUltimateUnlock row, got ${ultimateRows.length}`);
  if (lastUnlockIndex === undefined || computed[lastUnlockIndex] !== ultimateRows[0]) {
    fail(`isUltimateUnlock row must be the last (chronological) abilityUnlock row`);
  }
  const maxPoints = Math.max(...computed.map((r) => r.abilityPoints));
  if (maxPoints !== 32) fail(`expected max abilityPoints === 32, got ${maxPoints}`);
  if (abilityUnlockSouls.length !== 4)
    fail(`expected 4 abilityUnlockSouls, got ${abilityUnlockSouls.length}`);

  console.log("✅ Computed table passes all validation checks.\n");

  // ---- Diff against current lib/boonSystem.ts values ----
  console.log("Diffing against current lib/boonSystem.ts...\n");
  let anyChange = false;

  for (let i = 0; i < 36; i++) {
    const current = BOON_THRESHOLDS[i];
    const next = computed[i];
    const fields: (keyof BoonThreshold)[] = [
      "souls",
      "abilityUnlock",
      "abilityPoints",
      "isUltimateUnlock",
    ];
    for (const field of fields) {
      if (current[field] !== next[field]) {
        console.log(
          `boonLevel ${next.boonLevel}: ${field} ${current[field]} -> ${next[field]} (CHANGED)`,
        );
        anyChange = true;
      }
    }
  }

  const unlockSoulsChanged =
    ABILITY_SLOT_UNLOCK_SOULS.length !== abilityUnlockSouls.length ||
    ABILITY_SLOT_UNLOCK_SOULS.some((v, i) => v !== abilityUnlockSouls[i]);
  if (unlockSoulsChanged) {
    console.log(
      `ABILITY_SLOT_UNLOCK_SOULS: [${ABILITY_SLOT_UNLOCK_SOULS.join(", ")}] -> [${abilityUnlockSouls.join(", ")}] (CHANGED)`,
    );
    anyChange = true;
  }

  if (!anyChange) {
    console.log("\nNo changes — table is already up to date.");
    return;
  }

  // ---- Rewrite via marker-comment splice ----
  console.log("\nChanges detected — rewriting lib/boonSystem.ts...");

  const src = readFileSync(BOON_FILE, "utf8");

  const thresholdsBlock = computed
    .map(
      (r) =>
        `  { souls: ${r.souls}, boonLevel: ${r.boonLevel}, abilityUnlock: ${r.abilityUnlock}, abilityPoints: ${r.abilityPoints}, isUltimateUnlock: ${r.isUltimateUnlock} },`,
    )
    .join("\n");
  const thresholdsReplacement = `export const BOON_THRESHOLDS: BoonThreshold[] = [\n${thresholdsBlock}\n];`;

  const unlockSoulsReplacement = `export const ABILITY_SLOT_UNLOCK_SOULS = [${abilityUnlockSouls.join(", ")}] as const;`;

  const spliced = spliceBetweenMarkers(
    spliceBetweenMarkers(src, "BOON_THRESHOLDS", thresholdsReplacement),
    "ABILITY_SLOT_UNLOCK_SOULS",
    unlockSoulsReplacement,
  );

  writeFileSync(BOON_FILE, spliced, "utf8");
  console.log(`✅ Wrote ${BOON_FILE}`);

  execSync(`npx prettier --write ${BOON_FILE}`, { stdio: "inherit" });

  console.log("\nRun `npm run mini` and review `git diff lib/boonSystem.ts` before committing.");
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    if (err instanceof ScriptExitError) {
      process.exitCode = err.code;
      return;
    }
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
