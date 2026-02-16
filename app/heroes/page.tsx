import Link from "next/link";
import { fetchHeroes, slugifyHeroName } from "../../lib/deadlock";


export default async function HeroesPage() {
  const heroes = await fetchHeroes();
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main style={{ padding: 32 }}>
      <h1>Heroes</h1>

      <p style={{ opacity: 0.8 }}>
        Loaded {heroes.length} heroes from the Deadlock Assets API.
      </p>

      <ul
        style={{
          marginTop: 16,
          display: "grid",
          gap: 12,
          padding: 0,
          listStyle: "none",
        }}
      >
        {heroes.map((h) => (
          <li
            key={h.id}
            style={{
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 12,
              padding: 12,
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            {h.images?.icon_image_small_webp || h.images?.icon_image_small ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={h.images.icon_image_small_webp ?? h.images.icon_image_small}
                alt={h.name}
                width={48}
                height={48}
                style={{ borderRadius: 10 }}
              />
            ) : null}

            <div>
              <div style={{ fontWeight: 700 }}>
                <Link href={`/heroes/${h.id}`}>{h.name}</Link>
              </div>  
              <div style={{ opacity: 0.7, fontSize: 12 }}>{h.class_name}</div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
