"use client";

import Link from "next/link";

export function AddToBuildButton({ heroId }: { heroId: string | number }) {
  return (
    <Link
      href={`/build/${heroId}`}
      style={{ padding: "6px 10px", borderRadius: 8, textDecoration: "none" }}
    >
      Build →
    </Link>
  );
}
