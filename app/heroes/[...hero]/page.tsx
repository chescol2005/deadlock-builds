import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchHeroById,
  fetchHeroByName,
  fetchUpgradeItems,
  normalizeUpgradeItems,
  fetchAbilityItems,
  getHeroSignatureSlotsFromHeroItems,
} from "../../../lib/deadlock";
import { ShopGrid } from "../components/ShopGrid";

function formatLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatValue(v: unknown) {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default async function HeroPage({
  params,
}: {
  params: Promise<{ hero: string[] }>;
}) {
  const { hero } = await params;

  const segments = hero ?? [];
  const routeKey = segments[0];
  if (!routeKey) redirect("/heroes");

  const hasSubroute = segments.length > 1;
  const isId = /^[0-9]+$/.test(routeKey);

  const heroData = isId
    ? await fetchHeroById(routeKey)
    : await fetchHeroByName(routeKey.replace(/-/g, " "));

  if (!isId && !hasSubroute) redirect(`/heroes/${heroData.id}`);

  // Signature abilities: from /items/by-type/ability, linked by hero id (+ ability_type = signature)
  const allAbilities = await fetchAbilityItems();
  const signatureAbilities = getHeroSignatureSlotsFromHeroItems(
    heroData.items,
    allAbilities,
    heroData.id
  );

  // Purchasable shop items: upgrades
  const upgrades = normalizeUpgradeItems(await fetchUpgradeItems());

  return (
    <main style={{ padding: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{heroData.name}</h1>
          <div style={{ opacity: 0.75, marginTop: 6 }}>{heroData.class_name}</div>
        </div>

        <Link href={`/build/${heroData.id}`} style={{ opacity: 0.9 }}>
          Build →
        </Link>
      </div>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 12 }}>Signature Abilities</h2>

        {signatureAbilities.length === 0 ? (
          <div style={{ opacity: 0.8 }}>No signature abilities found.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {signatureAbilities.map((a) => (
              <li
                key={a.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {a.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.icon}
                      alt={a.name}
                      width={40}
                      height={40}
                      style={{ borderRadius: 10 }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontWeight: 700 }}>{a.name}</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>{a.className}</div>
                  </div>
                </div>

                <div style={{ opacity: 0.65, fontSize: 12 }}>Hero ability</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ShopGrid heroId={heroData.id} items={upgrades} />
    </main>
  );
}
