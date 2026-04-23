import type { AbilityLevels, SignatureSlot, AbilityLevel } from "@/lib/deadlock";
import type { BuildCategory } from "@/lib/items";

export type BuildState = {
  heroId: string;
  itemIds: string[];
  abilityLevels: AbilityLevels;
  categories: BuildCategory[];
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

  return {
    heroId: raw.heroId,
    itemIds: (raw.itemIds as unknown[]).filter((id): id is string => typeof id === "string"),
    abilityLevels: parseAbilityLevels(raw.abilityLevels),
    categories: parseCategories(raw.categories),
  };
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
      categories: [
        { id: "cat-1", name: "Early Game", itemIds: ["111"] },
        { id: "cat-2", name: "Late Game", itemIds: ["222", "333"] },
      ],
    };
    try {
      const encoded = serializeBuild(testState);
      const decoded = deserializeBuild(encoded);
      const match =
        decoded.heroId === testState.heroId &&
        decoded.itemIds.join(",") === testState.itemIds.join(",") &&
        JSON.stringify(decoded.abilityLevels) === JSON.stringify(testState.abilityLevels) &&
        JSON.stringify(decoded.categories) === JSON.stringify(testState.categories);
      if (!match) {
        console.error("[buildSerializer] Round-trip test FAILED", {
          testState,
          decoded,
        });
      }
    } catch (err) {
      console.error("[buildSerializer] Round-trip test threw", err);
    }
  })();
}
