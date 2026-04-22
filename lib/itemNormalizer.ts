import type { UpgradeV2Raw } from "./api/deadlockApi";
import type { Item, ItemCategory, ItemTier, ItemTag } from "./items";

function parseStats(raw: UpgradeV2Raw): Record<string, number> {
  const stats: Record<string, number> = {};
  if (!raw.properties) return stats;

  for (const [key, entry] of Object.entries(raw.properties)) {
    const val = parseFloat(String(entry.value));
    if (isNaN(val)) continue;
    if (String(entry.value) === entry.disable_value) continue;
    if (val === 0 && entry.disable_value === "0") continue;
    if (val < 0) continue;
    stats[key] = val;
  }

  return stats;
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
      (k) => k.includes("BulletDamage") || k.includes("Crit") || k.includes("Headshot"),
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

export function normalizeItem(raw: UpgradeV2Raw): Item {
  const parsedStats = parseStats(raw);
  const tags = deriveTags(raw, parsedStats);

  return {
    id: raw.class_name,
    name: raw.name,
    category: mapCategory(raw.item_slot_type),
    tier: raw.item_tier as ItemTier,
    cost: Number(raw.cost),
    tags: tags.length > 0 ? tags : ["utility"],
    stats: parsedStats,
    icon: (raw.image_webp as string | undefined) ?? (raw.image as string | undefined),
    componentItems: raw.component_items ?? [],
    upgradesInto: [],
  };
}
