import type { AbilityLevels, SignatureSlot, AbilityLevel } from "@/lib/deadlock";
import type { BuildCategory, ItemAssignment, ItemPhase } from "@/lib/items";

export type BuildState = {
  heroId: string;
  itemIds: string[];
  abilityLevels: AbilityLevels;
  // 0-35 hero-level scale (matches lib/heroStats.ts MAX_BOON) — NOT the same
  // concept as lib/boonSystem.ts's 1-36 souls-tier `boonLevel` field. Serialized
  // under the legacy wire key "boonLevel" for share-link backward compatibility;
  // see serializeBuild()/deserializeBuild() below.
  heroLevel: number;
  categories: BuildCategory[];
  // Parallel arrays — index matches itemIds index
  phases: Array<ItemPhase | null>;
  active: boolean[];
  sell: boolean[];
  optional: boolean[];
};

export function serializeBuild(state: BuildState): string {
  // Wire format keeps the legacy "boonLevel" key so old share links keep
  // decoding correctly — only the in-memory field name changed to heroLevel.
  const wire = {
    heroId: state.heroId,
    itemIds: state.itemIds,
    abilityLevels: state.abilityLevels,
    boonLevel: state.heroLevel,
    categories: state.categories,
    phases: state.phases,
    active: state.active,
    sell: state.sell,
    optional: state.optional,
  };
  const json = JSON.stringify(wire);
  const b64 = btoa(json);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function deserializeBuild(encoded: string): BuildState {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const json = atob(padded);
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid build state: not an object");
  }

  const raw = parsed as Record<string, unknown>;

  if (typeof raw.heroId !== "string") {
    throw new Error("Invalid build state: missing heroId");
  }

  if (!Array.isArray(raw.itemIds)) {
    throw new Error("Invalid build state: missing itemIds");
  }

  // Pair each raw.itemIds[i] with its corresponding phases/active/sell/optional[i]
  // BEFORE filtering out invalid ids — filtering itemIds first and then re-indexing
  // the flag arrays by the post-filter length would misalign every entry after the
  // first dropped id (e.g. ["a", null, "b"] filters to ["a","b"], but "b" was
  // originally at index 2, not 1 — indexing flags by post-filter position would
  // silently hand it index 1's flags instead).
  const rawItemIds = raw.itemIds as unknown[];
  const rawPhases = Array.isArray(raw.phases) ? (raw.phases as unknown[]) : [];
  const rawActive = Array.isArray(raw.active) ? (raw.active as unknown[]) : [];
  const rawSell = Array.isArray(raw.sell) ? (raw.sell as unknown[]) : [];
  const rawOptional = Array.isArray(raw.optional) ? (raw.optional as unknown[]) : [];

  const paired = rawItemIds
    .map((id, i) => ({
      id,
      phase: rawPhases[i],
      active: rawActive[i],
      sell: rawSell[i],
      optional: rawOptional[i],
    }))
    .filter(
      (
        entry,
      ): entry is {
        id: string;
        phase: unknown;
        active: unknown;
        sell: unknown;
        optional: unknown;
      } => typeof entry.id === "string",
    );

  const itemIds = paired.map((entry) => entry.id);

  return {
    heroId: raw.heroId,
    itemIds,
    abilityLevels: parseAbilityLevels(raw.abilityLevels),
    // Reads the legacy "boonLevel" wire key (see serializeBuild) into the
    // renamed heroLevel field.
    heroLevel:
      typeof raw.boonLevel === "number" ? Math.max(0, Math.min(35, Math.floor(raw.boonLevel))) : 0,
    categories: parseCategories(raw.categories),
    phases: paired.map((entry) => (isPhase(entry.phase) ? entry.phase : null)),
    active: paired.map((entry) => entry.active === true),
    sell: paired.map((entry) => entry.sell === true),
    optional: paired.map((entry) => entry.optional === true),
  };
}

export function getItemAssignments(state: BuildState): ItemAssignment[] {
  return state.itemIds.map((itemId, i) => ({
    itemId,
    phase: state.phases[i] ?? null,
    active: state.active[i] ?? false,
    sellPriority: state.sell[i] ?? false,
    optional: state.optional[i] ?? false,
  }));
}

function isPhase(v: unknown): v is ItemPhase {
  return v === "early" || v === "mid" || v === "late";
}

function parseAbilityLevels(raw: unknown): AbilityLevels {
  if (typeof raw !== "object" || raw === null) return {};
  const result: AbilityLevels = {};
  const slots: SignatureSlot[] = ["signature1", "signature2", "signature3", "signature4"];
  for (const slot of slots) {
    const val = (raw as Record<string, unknown>)[slot];
    if (val === 0 || val === 1 || val === 2 || val === 3) {
      result[slot] = val as AbilityLevel;
    }
  }
  return result;
}

function parseCategories(raw: unknown): BuildCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: unknown): BuildCategory[] => {
    if (typeof item !== "object" || item === null) return [];
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") return [];
    const itemIds = Array.isArray(r.itemIds)
      ? (r.itemIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    return [{ id: r.id, name: r.name, itemIds }];
  });
}
