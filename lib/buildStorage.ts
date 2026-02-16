export type BuildItem = {
  id: string;
  name: string;
};

const KEY_PREFIX = "deadlock_build_v1:";

function key(heroId: string | number) {
  return `${KEY_PREFIX}${heroId}`;
}

export function readBuild(heroId: string | number): BuildItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(key(heroId)) || "[]") as BuildItem[];
  } catch {
    return [];
  }
}

export function writeBuild(heroId: string | number, items: BuildItem[]) {
  localStorage.setItem(key(heroId), JSON.stringify(items));
  // optional: notify listeners
  window.dispatchEvent(new Event("deadlock-build-changed"));
}

export function addToBuild(heroId: string | number, item: BuildItem) {
  const cur = readBuild(heroId);
  if (cur.some((x) => x.id === item.id)) return cur;
  const next = [...cur, item];
  writeBuild(heroId, next);
  return next;
}

export function removeFromBuild(heroId: string | number, id: string) {
  const cur = readBuild(heroId);
  const next = cur.filter((x) => x.id !== id);
  writeBuild(heroId, next);
  return next;
}

export function clearBuild(heroId: string | number) {
  writeBuild(heroId, []);
  return [];
}
