"use client";

// First-time-visitor onboarding for /build — shown instead of disabled
// panels + no explanatory copy, which is what a first-time visitor saw
// before (Milestone C, New Player UX Foundations).
export function BuildEmptyState() {
  return (
    <div
      style={{
        marginTop: 32,
        maxWidth: 640,
        padding: "24px 28px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
        Plan a build for any hero
      </div>
      <p style={{ opacity: 0.75, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
        Pick a hero above to get started. From there you can add weapon, vitality, and spirit
        items, level up abilities, and preview your stats at any point in a match — no wiki
        required.
      </p>
      <ol
        style={{
          marginTop: 16,
          paddingLeft: 20,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13,
          opacity: 0.85,
        }}
      >
        <li>Select a hero from the dropdown above</li>
        <li>Add items from the shop — suggestions are ranked for you automatically</li>
        <li>Mark up to 12 items as active — that&apos;s what you&apos;ll actually carry into a match</li>
        <li>Share your build with a link once you&apos;re happy with it</li>
      </ol>
    </div>
  );
}
