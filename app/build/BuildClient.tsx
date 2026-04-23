"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DeadlockHeroListItem,
  ShopItem,
  ShopCategory,
  HeroAbilitySlot,
  SignatureSlot,
  AbilityLevel,
  AbilityLevels,
} from "@/lib/deadlock";
import { serializeBuild } from "@/lib/buildSerializer";
import type { BuildState } from "@/lib/buildSerializer";
import { ItemBrowser } from "@/app/build/components/ItemBrowser";
import { AbilityLevelingPanel } from "@/app/build/components/AbilityLevelingPanel";
import { BuildSummaryPanel } from "@/app/build/components/BuildSummaryPanel";
import { SuggestedItemsPanel } from "@/app/build/components/SuggestedItemsPanel";
import { CategoryManager } from "@/app/build/components/CategoryManager";
import type { Item, BuildCategory } from "@/lib/items";
import type { BuildGoal } from "@/lib/scoring/goalWeights";
import { getConsumedComponents, resolveAddItem } from "@/lib/buildUtils";

const GOALS: { value: BuildGoal; label: string }[] = [
  { value: "burst", label: "Burst" },
  { value: "dps", label: "DPS" },
  { value: "tank", label: "Tank" },
  { value: "sustain", label: "Sustain" },
  { value: "mobility", label: "Mobility" },
];

function cleanCategories(
  categories: BuildCategory[],
  buildItems: Item[],
): BuildCategory[] {
  const buildClassnames = new Set(buildItems.map((i) => i.id));
  return categories.map((cat) => ({
    ...cat,
    itemIds: cat.itemIds.filter((id) => buildClassnames.has(id)),
  }));
}

export default function BuildClient({
  heroes,
  selectedHeroId,
  upgrades,
  heroAbilities = [],
  initialState = null,
  allItems = [],
}: {
  heroes: DeadlockHeroListItem[];
  selectedHeroId: string | null;
  upgrades: ShopItem[];
  heroAbilities?: HeroAbilitySlot[];
  initialState?: BuildState | null;
  allItems?: Item[];
}) {
  const router = useRouter();
  const [heroId, setHeroId] = useState<string>(selectedHeroId ?? "");
  const [activeTab, setActiveTab] = useState<ShopCategory>("weapon");
  const [selectedGoal, setSelectedGoal] = useState<BuildGoal>("burst");

  const [buildItems, setBuildItems] = useState<Item[]>(() => {
    if (!initialState) return [];
    const byId = new Map(allItems.map((i) => [i.id, i]));
    return initialState.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  });

  const [abilityLevels, setAbilityLevels] = useState<AbilityLevels>(
    initialState?.abilityLevels ?? {},
  );

  const [categories, setCategories] = useState<BuildCategory[]>(
    initialState?.categories ?? [],
  );

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const cleanedCategories = useMemo(
    () => cleanCategories(categories, buildItems),
    [categories, buildItems],
  );

  const selectedIds = useMemo(() => new Set(buildItems.map((it) => it.id)), [buildItems]);

  const selectedHero = useMemo(
    () => heroes.find((h) => String(h.id) === String(heroId)),
    [heroes, heroId],
  );

  function handleLevelChange(slot: SignatureSlot, level: AbilityLevel) {
    setAbilityLevels((prev) => ({ ...prev, [slot]: level }));
  }

  function handleToggleItem(shopItem: ShopItem) {
    const item = allItems.find((i) => i.id === shopItem.id);
    if (!item) return;
    setBuildItems((prev) =>
      prev.some((it) => it.id === item.id)
        ? prev.filter((it) => it.id !== item.id)
        : resolveAddItem(prev, item),
    );
  }

  const consumedComponents = useMemo(() => getConsumedComponents(buildItems), [buildItems]);

  function handleAddSuggestedItem(item: Item) {
    setBuildItems((prev) =>
      prev.some((it) => it.id === item.id) ? prev : resolveAddItem(prev, item),
    );
  }

  function handleRemoveItem(itemId: string) {
    setBuildItems((prev) => prev.filter((it) => it.id !== itemId));
  }

  async function handleCopyShareLink() {
    const state: BuildState = {
      heroId,
      itemIds: buildItems.map((it) => it.id),
      abilityLevels,
      categories: cleanedCategories,
    };
    const encoded = serializeBuild(state);
    const url = `${window.location.origin}${window.location.pathname}?build=${encoded}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      setFailedUrl(null);
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
      setFailedUrl(url);
    }
  }

  return (
    <main style={{ padding: 32 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Build</h1>

        <select
          value={heroId}
          onChange={(e) => {
            const next = e.target.value;
            setHeroId(next);
            setBuildItems([]);
            setAbilityLevels({});
            setCategories([]);
            if (!next) router.push("/build");
            else router.push(`/build/${next}`);
          }}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <option value="">Select a hero…</option>
          {heroes.map((h) => (
            <option key={h.id} value={String(h.id)}>
              {h.name}
            </option>
          ))}
        </select>

        {selectedHero ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {selectedHero.images?.icon_image_small_webp ||
            selectedHero.images?.icon_image_small ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  selectedHero.images.icon_image_small_webp ??
                  selectedHero.images.icon_image_small
                }
                alt={selectedHero.name}
                width={40}
                height={40}
                style={{ borderRadius: 10 }}
              />
            ) : null}

            <div>
              <div style={{ fontWeight: 700, lineHeight: 1.1 }}>{selectedHero.name}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{selectedHero.class_name}</div>
            </div>
          </div>
        ) : null}

        {/* Build goal selector */}
        {heroId ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 600 }}>Goal:</span>
            {GOALS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setSelectedGoal(value)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: `1px solid ${selectedGoal === value ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)"}`,
                  background: selectedGoal === value ? "rgba(255,255,255,0.15)" : "transparent",
                  color: "inherit",
                  fontWeight: selectedGoal === value ? 700 : 400,
                  cursor: "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {heroId ? (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{buildItems.length} / 12 slots</span>
            <button
              onClick={() => {
                setBuildItems([]);
                setCategories([]);
              }}
              disabled={buildItems.length === 0}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "inherit",
                cursor: buildItems.length === 0 ? "not-allowed" : "pointer",
                opacity: buildItems.length === 0 ? 0.4 : 1,
                fontSize: 12,
              }}
            >
              Clear
            </button>
            <button
              onClick={handleCopyShareLink}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background:
                  copyState === "copied" ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.12)",
                color: copyState === "copied" ? "#4ade80" : "inherit",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: "nowrap",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {copyState === "copied" ? "Copied!" : "Copy Share Link"}
            </button>
            {copyState === "failed" && failedUrl ? (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "#1e1e2e",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  zIndex: 50,
                  minWidth: 320,
                  maxWidth: 400,
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  Clipboard unavailable — copy manually:
                </div>
                <input
                  readOnly
                  value={failedUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "inherit",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {!heroId ? (
        <div style={{ marginTop: 24, opacity: 0.8 }}>Select a hero to start a build.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr 280px",
            gap: 24,
            marginTop: 24,
            alignItems: "start",
          }}
        >
          {/* Left panel */}
          <div>
            <AbilityLevelingPanel
              abilities={heroAbilities}
              abilityLevels={abilityLevels}
              onLevelChange={handleLevelChange}
            />
          </div>

          {/* Center panel */}
          <div>
            <CategoryManager
              categories={cleanedCategories}
              buildItems={buildItems}
              onCategoriesChange={setCategories}
              onRemoveBuildItem={handleRemoveItem}
              consumedComponents={consumedComponents}
            />

            <ItemBrowser
              items={upgrades}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              selectedIds={selectedIds}
              onToggle={handleToggleItem}
              slotsFull={buildItems.length >= 12}
            />
          </div>

          {/* Right panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <SuggestedItemsPanel
              allItems={allItems}
              currentBuild={buildItems}
              selectedGoal={selectedGoal}
              onAdd={handleAddSuggestedItem}
              consumedComponents={consumedComponents}
              slotsFull={buildItems.length >= 12}
            />
            <BuildSummaryPanel selectedItems={buildItems} />
          </div>
        </div>
      )}
    </main>
  );
}
