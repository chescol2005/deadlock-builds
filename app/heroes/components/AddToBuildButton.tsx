"use client";

import { useEffect, useState } from "react";
import { addToBuild, readBuild, BuildItem } from "@/lib/buildStorage";

export function AddToBuildButton({
  heroId,
  item,
}: {
  heroId: string | number;
  item: BuildItem;
}) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setAdded(readBuild(heroId).some((x) => x.id === item.id));
  }, [heroId, item.id]);

  return (
    <button
      onClick={() => {
        addToBuild(heroId, item);
        setAdded(true);
      }}
      disabled={added}
      style={{ padding: "6px 10px", borderRadius: 8 }}
    >
      {added ? "Added" : "Add to Build"}
    </button>
  );
}
