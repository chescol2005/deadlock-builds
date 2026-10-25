import { ImageResponse } from "next/og";
import { unstable_rethrow } from "next/navigation";
import { fetchHeroById } from "@/lib/heroApi";
import { getItems } from "@/lib/itemStore";
import { buildPreview, decodeBuildParam, siteUrl, SITE_NAME, SITE_TAGLINE } from "@/lib/seo";
import type { BuildPreview } from "@/lib/seo";
import { fetchImageDataUri } from "@/lib/ogAssets";
import { CATEGORY_META } from "@/app/build/components/CategoryManager/constants";

// Share-preview image for /build/[heroId] (?hero=<id>&build=<share param>).
// Data comes from lib/seo.ts buildPreview(); this route only renders it.
// Built-in opengraph-image files can't read a page's query string, which is
// where a shared build lives, hence a route.

const SIZE = { width: 1200, height: 630 };


export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const heroId = Number(params.get("hero"));
  const state = decodeBuildParam(params.get("build"));

  const wantsHero = Number.isInteger(heroId) && heroId > 0;
  let preview: BuildPreview = { heroName: SITE_NAME, items: [], itemCount: 0 };
  let heroLoaded = false;
  if (wantsHero) {
    try {
      const [hero, allItems] = await Promise.all([fetchHeroById(heroId), getItems()]);
      preview = buildPreview(hero, state, allItems);
      heroLoaded = true;
    } catch (err) {
      unstable_rethrow(err);
      // Unknown hero or API down: the generic card below still renders.
    }
  }

  const [heroImage, ...icons] = await Promise.all([
    fetchImageDataUri(preview.heroImage),
    ...preview.items.map((i) => fetchImageDataUri(i.icon)),
  ]);
  const more = preview.itemCount - preview.items.length;
  // Only a complete render may be cached: a card degraded by an API hiccup
  // keeps ImageResponse's no-cache default, so the next unfurl retries.
  const complete =
    (!wantsHero || heroLoaded) &&
    (preview.heroImage === undefined || heroImage !== undefined) &&
    preview.items.every((item, k) => item.icon === undefined || icons[k] !== undefined);
  const generic = preview.heroName === SITE_NAME;
  const title = preview.itemCount > 0 ? `${preview.heroName} build` : preview.heroName;
  // A shared build may be hand-picked, so its card claims nothing about reasons.
  const subtitle =
    preview.itemCount > 0
      ? `${preview.itemCount} items · open it to tweak it and see what to buy next`
      : generic
        ? SITE_TAGLINE
        : `Plan a ${preview.heroName} build with item suggestions that explain themselves`;
  const steps = ["Pick a hero", "See what to buy", "Know why each item is there"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#09090b",
          color: "#fafafa",
          padding: 48,
          gap: 48,
        }}
      >
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            width={300}
            height={534}
            style={{ borderRadius: 16, objectFit: "cover", border: "2px solid #3f3f46" }}
          />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 20 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>{subtitle}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12 }}>
            {preview.items.map((item, k) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: 360,
                  padding: 10,
                  borderRadius: 12,
                  background: "#18181b",
                  borderLeft: `6px solid ${CATEGORY_META[item.category].solid}`,
                }}
              >
                {icons[k] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icons[k]} alt="" width={56} height={56} style={{ borderRadius: 8 }} />
                ) : (
                  <div style={{ display: "flex", width: 56, height: 56, borderRadius: 8, background: "#27272a" }} />
                )}
                <div style={{ display: "flex", fontSize: 26 }}>{item.name}</div>
              </div>
            ))}
            {generic
              ? steps.map((step, k) => (
                  <div
                    key={step}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      width: "100%",
                      fontSize: 34,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        width: 52,
                        height: 52,
                        borderRadius: 26,
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#f59e0b",
                        color: "#09090b",
                        fontWeight: 700,
                      }}
                    >
                      {k + 1}
                    </div>
                    {step}
                  </div>
                ))
              : null}
            {more > 0 ? (
              <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#a1a1aa" }}>
                +{more} more
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: "auto",
              fontSize: 26,
              color: "#f59e0b",
              fontWeight: 700,
            }}
          >
            {generic ? siteUrl().host : `${SITE_NAME} · ${siteUrl().host}`}
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: complete
        ? { "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" }
        : undefined,
    },
  );
}
