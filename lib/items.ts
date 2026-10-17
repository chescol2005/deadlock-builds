export type ItemCategory = "gun" | "vitality" | "spirit";

export type ItemPhase = "early" | "mid" | "late";

export type ItemAssignment = {
  itemId: string;
  phase: ItemPhase | null;
  active: boolean;
  sellPriority: boolean;
  optional: boolean;
};

export type AssignmentData = Omit<ItemAssignment, "itemId">;

export type ItemDestination =
  | { type: "phase"; phase: ItemPhase }
  | { type: "category"; categoryId: string }
  | { type: "uncategorized" };

export type BuildCategory = {
  id: string;
  name: string;
  itemIds: string[];
};

export type CategoryState = {
  categories: BuildCategory[];
};

export type ItemTier = 1 | 2 | 3 | 4;

export type ItemTag = "burst" | "sustain" | "tankiness" | "mobility" | "utility" | "dps";

export type ItemStats = Record<string, number>;

/**
 * A stat's scaling coefficient, as published by the API's
 * `properties[key].scale_function`.
 *
 * Deadlock item values are NOT flat: Mystic Shot's `ProcBonusMagicDamage` is
 * `40 + 0.9 x spirit power`, not 40. `ItemStats` holds only the base `value`,
 * so a consumer that ignores this understates the item — verified live at a
 * median 1.5x across the 29 `ETechPower`-scaled properties, up to 3.3x.
 *
 * Same additive convention as ability scaling (`value += stat x scale`), see
 * `calculateAbilityDamage` in lib/abilityCoefficients.ts.
 */
export type ItemStatScaling = {
  /** The stat this value scales off, e.g. "ETechPower". */
  scaleType: string;
  /** Coefficient: how much one point of that stat adds to the base value. */
  statScale: number;
};

/** Scaling coefficients keyed by the same stat key used in `ItemStats`. */
export type ItemStatScalings = Record<string, ItemStatScaling>;

export type Item = {
  id: string;
  /** Raw numeric API id (`UpgradeV2Raw.id`) — needed to join against
   * match-analytics datasets that are keyed by numeric `item_id`. */
  numericId: number;
  name: string;
  category: ItemCategory;
  tier: ItemTier;
  cost: number;
  tags: ItemTag[];
  stats: ItemStats;
  /**
   * Scaling coefficients for the entries in `stats`, where the API publishes
   * one. Absent key = that stat is genuinely flat. Resolve with
   * `resolveScaledStats` in lib/engine/itemAdapter.ts rather than reading
   * `stats` directly when a hero/build context is available.
   */
  statScaling: ItemStatScalings;
  description?: string;
  icon?: string;
  componentItems?: string[];
  upgradesInto?: string[];
};
