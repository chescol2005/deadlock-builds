import { formatStatValue, STAT_PROPERTY_LABELS } from "@/lib/statLabels";
import type { Item } from "@/lib/items";

interface ItemStatsSectionProps {
  item: Item;
}

// Keys that show up on nearly every item as engine-internal noise — frequently
// 0 or -1 even on items that don't actually use them (cast range/target limit/
// charge bookkeeping fields that only matter for items that actually have
// charges or channel). Filtered out unconditionally, on top of the general
// "skip zero-value stats" rule below, per the item-detail-page spec.
const NOISE_STAT_KEYS = new Set<string>([
  "AbilityCastRange",
  "AbilityUnitTargetLimit",
  "AbilityCharges",
  "AbilityCooldownBetweenCharge",
  "ChannelMoveSpeed",
]);

export function ItemStatsSection({ item }: ItemStatsSectionProps) {
  // A real stat an item actually grants is virtually never exactly 0 (see the
  // negative-stat-preserving fix referenced in the item-data model) — 0 here
  // reliably means "this key doesn't apply to this item". Genuinely negative
  // values are real debuff-tradeoffs and must still display.
  const stats = Object.entries(item.stats).filter(
    ([key, value]) => !NOISE_STAT_KEYS.has(key) && value !== 0,
  );

  if (stats.length === 0) {
    return <p className="text-sm text-zinc-500">No notable stats.</p>;
  }

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {stats.map(([key, value]) => (
        <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <dt className="text-xs tracking-wide text-zinc-500 uppercase">
            {STAT_PROPERTY_LABELS[key] ?? key}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-amber-400">
            {formatStatValue(key, value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
