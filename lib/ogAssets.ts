import { unstable_rethrow } from "next/navigation";

// Fetches an image for a share-preview render and inlines it as a data URI.
// Satori fails the WHOLE image when one <img> src can't be loaded, so each
// asset is fetched up front and a missing one is simply left out. Fail-open:
// the catch calls unstable_rethrow(err) first (see deadlockApi.ts, Fixture 14).
const SATORI_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif"]);

export async function fetchImageDataUri(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return undefined;
    // Satori decodes PNG, JPEG and GIF only; anything else would fail the card.
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!SATORI_IMAGE_TYPES.has(type)) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch (err) {
    unstable_rethrow(err);
    console.error("[ogAssets] fetchImageDataUri error:", url, err);
    return undefined;
  }
}
