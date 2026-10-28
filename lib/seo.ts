// lib/seo.ts — page metadata, share-preview data and sitemap entries (Work 3a,
// competitive-analysis rec. 2). Pure helpers: pages fetch, these shape. A build
// share link unfurls in Discord with the hero and its core items.

import type { Metadata, MetadataRoute } from "next";
import type { Item } from "./items";
import type { BuildState } from "./buildSerializer";
import { deserializeBuild, getItemAssignments } from "./buildSerializer";
import { GUIDES } from "./navigation";

export const SITE_NAME = "Deadlock Foundry";
export const SITE_TAGLINE = "The Deadlock build planner that explains itself";

/** Used when no deployment URL is set (local dev, scripts). */
export const FALLBACK_SITE_URL = "https://deadlock-builds-kappa.vercel.app";

/** Items shown on a build's share preview. */
export const PREVIEW_ITEM_LIMIT = 6;

/**
 * The site's absolute origin for metadata and the sitemap: an explicit
 * NEXT_PUBLIC_SITE_URL, else Vercel's production domain, else the fallback.
 */
export function siteUrl(env: Readonly<Record<string, string | undefined>> = process.env): URL {
  for (const raw of [env.NEXT_PUBLIC_SITE_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    // A bare host ("example.com") gets https://; a value that still does not
    // parse falls through, so a bad env var can't break every page's metadata.
    const url = URL.canParse(value)
      ? new URL(value)
      : URL.canParse(`https://${value}`)
        ? new URL(`https://${value}`)
        : null;
    if (url && (url.protocol === "https:" || url.protocol === "http:")) return url;
  }
  return new URL(FALLBACK_SITE_URL);
}

/** OpenGraph fields every page carries. Next replaces `openGraph` per page, not merges. */
export const BASE_OPEN_GRAPH = { siteName: SITE_NAME, type: "website" } as const;

/** The generic card, for pages without their own image. */
export const DEFAULT_OG_IMAGE = {
  url: "/api/og/build",
  width: 1200,
  height: 630,
  alt: SITE_NAME,
} as const;

/** The first non-empty string: the API sends "" next to a valid fallback. */
function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * The PNG twin of an asset URL. Share-preview images are rendered by Satori,
 * which does not decode WebP; the asset bucket serves both at the same path.
 */
export function pngVariant(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/\.webp$/i, ".png");
}

export interface HeroMetaInput {
  id: number;
  name: string;
  hero_type?: string;
  tags?: string[];
  images?: { icon_hero_card?: string; icon_hero_card_webp?: string };
}

/** The hero's card art as served (crawlers read WebP; only Satori needs PNG). */
function heroArt(hero: HeroMetaInput): string | undefined {
  return firstNonEmpty(hero.images?.icon_hero_card, hero.images?.icon_hero_card_webp);
}

function heroBlurb(hero: HeroMetaInput): string {
  const kind = hero.hero_type ? ` ${hero.hero_type}` : "";
  const tags = hero.tags && hero.tags.length > 0 ? ` (${hero.tags.slice(0, 3).join(", ")})` : "";
  return `${hero.name}, a Deadlock${kind} hero${tags}`;
}

export function heroPageMetadata(hero: HeroMetaInput): Metadata {
  const title = `${hero.name}: abilities, stats and items`;
  const description = `${heroBlurb(hero)}: abilities, base stats, win rate and every shop item, explained for new players.`;
  const image = heroArt(hero);
  return {
    title,
    description,
    alternates: { canonical: `/heroes/${hero.id}` },
    openGraph: {
      ...BASE_OPEN_GRAPH,
      title,
      description,
      images: image ? [{ url: image, alt: hero.name }] : [DEFAULT_OG_IMAGE],
    },
    twitter: { card: "summary", title, description },
  };
}

export function itemPageMetadata(item: Item): Metadata {
  const title = `${item.name}: Deadlock item`;
  const description = `${item.name} is a tier ${item.tier} ${item.category} item costing ${item.cost.toLocaleString("en-US")} souls. Stats, components, upgrades and win rate.`;
  const image = firstNonEmpty(item.icon);
  return {
    title,
    description,
    alternates: { canonical: `/items/${item.id}` },
    openGraph: {
      ...BASE_OPEN_GRAPH,
      title,
      description,
      images: image ? [{ url: image, alt: item.name }] : [DEFAULT_OG_IMAGE],
    },
    twitter: { card: "summary", title, description },
  };
}

export interface BuildPreviewItem {
  id: string;
  name: string;
  category: Item["category"];
  icon?: string;
}

export interface BuildPreview {
  heroName: string;
  heroImage?: string;
  /** Up to PREVIEW_ITEM_LIMIT items: active ones first, then build order. */
  items: ReadonlyArray<BuildPreviewItem>;
  /** Every item in the shared build, including those not previewed. */
  itemCount: number;
}

/** Decodes a share link's `build` param; null when absent or malformed. */
export function decodeBuildParam(param: string | undefined | null): BuildState | null {
  if (!param) return null;
  try {
    return deserializeBuild(param);
  } catch {
    return null;
  }
}

/** What a build's share preview shows. Unknown item ids are skipped. */
export function buildPreview(
  hero: HeroMetaInput,
  state: BuildState | null,
  allItems: ReadonlyArray<Item>,
): BuildPreview {
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const assignments = state ? getItemAssignments(state) : [];
  const known = assignments.flatMap((a) => {
    const item = byId.get(a.itemId);
    return item ? [{ item, active: a.active }] : [];
  });
  // Stable: active items keep build order among themselves, then the rest.
  const ordered = [...known.filter((k) => k.active), ...known.filter((k) => !k.active)];
  return {
    heroName: hero.name,
    heroImage: pngVariant(heroArt(hero)),
    items: ordered.slice(0, PREVIEW_ITEM_LIMIT).map(({ item }) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      icon: pngVariant(item.icon),
    })),
    itemCount: known.length,
  };
}

/** The share-preview image URL for a build page (relative; metadataBase resolves it). */
export function buildPreviewImagePath(heroId: number, buildParam?: string | null): string {
  const query = new URLSearchParams({ hero: String(heroId) });
  if (buildParam) query.set("build", buildParam);
  return `/api/og/build?${query.toString()}`;
}

export function buildPageMetadata(
  hero: HeroMetaInput,
  preview: BuildPreview,
  buildParam?: string | null,
): Metadata {
  const shared = preview.itemCount > 0;
  const title = shared ? `${hero.name} build` : `${hero.name} build planner`;
  const names = preview.items.map((i) => i.name);
  const more = preview.itemCount - names.length;
  const description = shared
    ? `A ${hero.name} build: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Open it in ${SITE_NAME} to tweak it and see what to buy next.`
    : `Plan a ${hero.name} build: item suggestions tailored to ${hero.name}'s kit, each with a plain-English reason, plus a full early, mid and late starter build.`;
  const image = buildPreviewImagePath(hero.id, shared ? buildParam : null);
  return {
    title,
    description,
    alternates: { canonical: `/build/${hero.id}` },
    openGraph: {
      ...BASE_OPEN_GRAPH,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** A guide page's title plus its GUIDES description (the one source of guide copy). */
export function guideMetadata(href: string, title: string): Metadata {
  const description = GUIDES.find((g) => g.href === href)?.description;
  return { title, description, alternates: { canonical: href } };
}

/** Routes that always exist, independent of live data. */
export const STATIC_ROUTES: ReadonlyArray<string> = [
  "/",
  "/heroes",
  "/items",
  "/build",
  "/match",
  "/guide",
  ...GUIDES.map((g) => g.href),
];

/**
 * Sitemap entries: static routes, then each hero's page and build planner,
 * then each item. Share links (`?build=`) are never listed: they are user content.
 */
export function sitemapEntries(
  base: URL,
  heroIds: ReadonlyArray<number>,
  itemIds: ReadonlyArray<string>,
): MetadataRoute.Sitemap {
  const at = (path: string) => new URL(path, base).toString();
  return [
    ...STATIC_ROUTES.map((path) => ({ url: at(path) })),
    ...heroIds.flatMap((id) => [{ url: at(`/heroes/${id}`) }, { url: at(`/build/${id}`) }]),
    ...itemIds.map((id) => ({ url: at(`/items/${encodeURIComponent(id)}`) })),
  ];
}
