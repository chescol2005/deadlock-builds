const BASE_URL = "https://assets.deadlock-api.com";

export type UpgradeV2Raw = {
  id: number;
  class_name: string;
  name: string;
  type: string;
  item_slot_type: "weapon" | "vitality" | "spirit";
  item_tier: 1 | 2 | 3 | 4;
  cost: number;
  shopable?: boolean;
  disabled?: boolean;
  is_active_item?: boolean;
  activation?: string;
  component_items?: string[];
  image?: string;
  image_webp?: string;
  properties?: Record<
    string,
    {
      value: string | number | null;
      label?: string;
      postfix?: string;
      css_class?: string;
      disable_value?: string;
    }
  >;
  [k: string]: unknown;
};

export async function fetchAllItems(): Promise<UpgradeV2Raw[]> {
  try {
    const res = await fetch(`${BASE_URL}/v2/items`, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[deadlockApi] fetchAllItems failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const all = (await res.json()) as UpgradeV2Raw[];
    return all.filter(
      (it) =>
        it.type === "upgrade" && it.shopable === true && it.disabled !== true && it.item_tier <= 4,
    );
  } catch (err) {
    console.error("[deadlockApi] fetchAllItems error:", err);
    return [];
  }
}
