export type ItemCategory = "gun" | "vitality" | "spirit";

export type ItemPhase = "early" | "mid" | "late";

export type ItemAssignment = {
  itemId: string;
  phase: ItemPhase | null;
  active: boolean;
  sellPriority: boolean;
  optional: boolean;
};

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

export type Item = {
  id: string;
  name: string;
  category: ItemCategory;
  tier: ItemTier;
  cost: number;
  tags: ItemTag[];
  stats: ItemStats;
  description?: string;
  icon?: string;
  componentItems?: string[];
  upgradesInto?: string[];
};
