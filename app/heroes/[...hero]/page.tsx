import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchHeroById, fetchHeroByName } from "../../../lib/deadlock";
import { AddToBuildButton } from "../components/AddToBuildButton";

export default async function HeroPage({
  params,
}: {
  params: Promise<{ hero: string[] }>;
}) {
  const { hero } = await params;

  const segments = hero ?? [];
  const routeKey = segments[0];

  if (!routeKey) {
    redirect("/heroes");
  }

  const hasSubroute = segments.length > 1;
  const isId = /^[0-9]+$/.test(routeKey);

  const heroData = isId
    ? await fetchHeroById(routeKey)
    : await fetchHeroByName(routeKey.replace(/-/g, " "));

  // Canonicalize slug -> id ONLY when path is exactly /heroes/<slug>
  if (!isId && !hasSubroute) {
    redirect(`/heroes/${heroData.id}`);
  }

  const itemEntries = Object.entries(heroData.items ?? {}).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0
  );

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
          <div style={{ opacity: 0.75, marginTop: 6 }}>
            {heroData.class_name}
          </div>
        </div>

        {/* Hero-specific build link */}
        <Link href={`/build/${heroData.id}`} style={{ opacity: 0.9 }}>
          Build →
        </Link>
      </div>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ marginBottom: 12 }}>Items</h2>

        {itemEntries.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No items found for this hero.
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 10,
            }}
          >
            {itemEntries.map(([slot, value]) => {
              const itemId = String(value);
              const itemName = String(value); // placeholder until real item metadata

              return (
                <li
                  key={`${slot}:${itemId}`}
                  style={{
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{itemName}</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      {slot}
                    </div>
                  </div>

                  <AddToBuildButton
                    heroId={heroData.id}
                    item={{ id: itemId, name: itemName }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
