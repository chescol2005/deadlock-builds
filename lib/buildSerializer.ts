import type { AbilityLevels, SignatureSlot, AbilityLevel } from "@/lib/deadlock";
import type { BuildCategory, ItemAssignment, ItemPhase } from "@/lib/items";

export type BuildState = {
  heroId: string;
  itemIds: string[];
  abilityLevels: AbilityLevels;
  boonLevel: number;
  categories: BuildCategory[];
  // Parallel arrays — index matches itemIds index
  phases: Array<ItemPhase | null>;
  active: boolean[];
  sell: boolean[];
  optional: boolean[];
};

export function serializeBuild(state: BuildState): string {
  const json = JSON.stringify(state);
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

  const itemIds = (raw.itemIds as unknown[]).filter((id): id is string => typeof id === "string");
  const len = itemIds.length;

  return {
    heroId: raw.heroId,
    itemIds,
    abilityLevels: parseAbilityLevels(raw.abilityLevels),
    boonLevel:
      typeof raw.boonLevel === "number" ? Math.max(0, Math.min(35, Math.floor(raw.boonLevel))) : 0,
    categories: parseCategories(raw.categories),
    phases: parsePhases(raw.phases, len),
    active: parseBooleans(raw.active, len),
    sell: parseBooleans(raw.sell, len),
    optional: parseBooleans(raw.optional, len),
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

function parsePhases(raw: unknown, len: number): Array<ItemPhase | null> {
  if (!Array.isArray(raw)) return new Array<ItemPhase | null>(len).fill(null);
  return Array.from({ length: len }, (_, i) => {
    const v = (raw as unknown[])[i];
    return isPhase(v) ? v : null;
  });
}

function parseBooleans(raw: unknown, len: number): boolean[] {
  if (!Array.isArray(raw)) return new Array<boolean>(len).fill(false);
  return Array.from({ length: len }, (_, i) => (raw as unknown[])[i] === true);
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

if (process.env.NODE_ENV === "development") {
  (() => {
    const testState: BuildState = {
      heroId: "test-hero-42",
      itemIds: ["111", "222", "333"],
      abilityLevels: { signature1: 1, signature2: 2, signature4: 3 },
      boonLevel: 5,
      categories: [
        { id: "cat-1", name: "Core", itemIds: ["111"] },
        { id: "cat-2", name: "Situational", itemIds: ["222", "333"] },
      ],
      phases: ["early", null, "late"],
      active: [true, false, true],
      sell: [false, true, false],
      optional: [false, false, false],
    };
    try {
      const encoded = serializeBuild(testState);
      const decoded = deserializeBuild(encoded);
      const match =
        decoded.heroId === testState.heroId &&
        decoded.itemIds.join(",") === testState.itemIds.join(",") &&
        JSON.stringify(decoded.abilityLevels) === JSON.stringify(testState.abilityLevels) &&
        decoded.boonLevel === testState.boonLevel &&
        JSON.stringify(decoded.categories) === JSON.stringify(testState.categories) &&
        JSON.stringify(decoded.phases) === JSON.stringify(testState.phases) &&
        JSON.stringify(decoded.active) === JSON.stringify(testState.active) &&
        JSON.stringify(decoded.sell) === JSON.stringify(testState.sell) &&
        JSON.stringify(decoded.optional) === JSON.stringify(testState.optional);
      if (!match) {
        console.error("[buildSerializer] Round-trip test FAILED", { testState, decoded });
      }
    } catch (err) {
      console.error("[buildSerializer] Round-trip test threw", err);
    }
  })();
}
