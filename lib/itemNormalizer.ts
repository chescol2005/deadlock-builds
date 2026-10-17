import type { UpgradeV2Raw } from "./api/deadlockApi";
import type { Item, ItemCategory, ItemTier, ItemTag, ItemStats, ItemStatScalings } from "./items";

function parseStats(raw: UpgradeV2Raw): Record<string, number> {
  const stats: Record<string, number> = {};
  if (!raw.properties) return stats;

  for (const [key, entry] of Object.entries(raw.properties)) {
    const val = parseFloat(String(entry.value));
    if (isNaN(val)) continue;
    if (String(entry.value) === entry.disable_value) continue;
    if (val === 0 && entry.disable_value === "0") continue;
    // Negative values are kept: they are legitimate debuff-style tradeoffs
    // (an item that boosts one stat at the cost of another), not bad data.
    stats[key] = val;
  }

  return stats;
}

/**
 * Captures the published scaling coefficient for each stat that has one.
 *
 * `parseStats` keeps only `value`, which is the BASE of a scaling expression,
 * not the whole thing — ignoring the coefficient understates the 29
 * `ETechPower`-scaled properties by a median 1.5x (up to 3.3x on Mystic Shot).
 *
 * Keyed to match `parseStats` exactly, so a stat is never given a coefficient
 * without a base value to apply it to. Only the single-stat form is captured:
 * `scale_function_multi_stats` publishes `scaling_stats` with NO `stat_scale`,
 * so there is no coefficient to read and guessing one would be inventing data.
 */
function parseStatScaling(raw: UpgradeV2Raw, parsedStats: ItemStats): ItemStatScalings {
  const scalings: ItemStatScalings = {};
  if (!raw.properties) return scalings;

  for (const [key, entry] of Object.entries(raw.properties)) {
    if (!(key in parsedStats)) continue; // no base value kept => nothing to scale

    const fn = entry.scale_function;
    const scaleType = fn?.specific_stat_scale_type;
    const statScale = fn?.stat_scale;
    if (typeof scaleType !== "string" || scaleType.length === 0) continue;
    if (typeof statScale !== "number" || !Number.isFinite(statScale) || statScale === 0) continue;

    scalings[key] = { scaleType, statScale };
  }

  return scalings;
}

function deriveTags(raw: UpgradeV2Raw, parsedStats: Record<string, number>): ItemTag[] {
  const tags = new Set<ItemTag>();
  const slot = raw.item_slot_type;
  const props = raw.properties ?? {};

  // weapon slot: tag all as dps (WeaponPower key present in all weapon items)
  if (slot === "weapon" && "WeaponPower" in props) tags.add("dps");

  // weapon slot: burst if any bullet damage or crit-style property
  if (
    slot === "weapon" &&
    Object.keys(parsedStats).some(
      (k) => k.includes("BaseAttackDamagePercent") || k.includes("Crit") || k.includes("Headshot"),
    )
  ) {
    tags.add("burst");
  }

  // vitality: always tankiness
  if (slot === "vitality") tags.add("tankiness");

  // vitality: sustain if regen or lifesteal property present
  if (
    slot === "vitality" &&
    Object.keys(parsedStats).some((k) => k.includes("Regen") || k.includes("Lifesteal"))
  ) {
    tags.add("sustain");
  }

  // mobility: BonusMoveSpeed or MoveSpeed > 0
  if (
    Object.entries(props).some(
      (e) => e[1].css_class === "move_speed" && parseFloat(String(e[1].value)) > 0,
    ) ||
    Object.keys(parsedStats).some((k) => k.includes("MoveSpeed") || k.includes("move_speed"))
  ) {
    tags.add("mobility");
  }

  // spirit: utility (TechPower key present in all spirit items)
  if (slot === "spirit" && "TechPower" in props) tags.add("utility");

  // burst from active ability charges (only a handful of items)
  if ((parsedStats["BonusAbilityCharges"] ?? 0) > 0 || (parsedStats["AbilityCharges"] ?? 0) > 0) {
    tags.add("burst");
  }

  // utility: active items with cooldown reduction
  if (
    raw.is_active_item ||
    String(raw.activation).toLowerCase() === "active" ||
    Object.keys(parsedStats).some((k) => k.includes("Cooldown"))
  ) {
    tags.add("utility");
  }

  return Array.from(tags);
}

function mapCategory(slot: "weapon" | "vitality" | "spirit"): ItemCategory {
  return slot === "weapon" ? "gun" : slot;
}

// `??` only falls through on null/undefined, not "" — the API can return an
// empty-string icon field alongside a valid fallback, so an explicit
// non-empty-string check is required or the empty string silently wins.
function firstNonEmpty(...vals: Array<string | null | undefined>): string | undefined {
  return vals.find((v): v is string => typeof v === "string" && v.length > 0);
}

export function normalizeItem(raw: UpgradeV2Raw): Item {
  const parsedStats = parseStats(raw);
  const tags = deriveTags(raw, parsedStats);

  return {
    id: raw.class_name,
    numericId: raw.id,
    name: raw.name,
    category: mapCategory(raw.item_slot_type),
    tier: raw.item_tier as ItemTier,
    cost: Number(raw.cost),
    tags: tags.length > 0 ? tags : ["utility"],
    stats: parsedStats,
    statScaling: parseStatScaling(raw, parsedStats),
    icon: firstNonEmpty(
      raw.shop_image_webp,
      raw.shop_image,
      raw.shop_image_small_webp,
      raw.shop_image_small,
    ),
    componentItems: raw.component_items ?? [],
    upgradesInto: [],
  };
}
