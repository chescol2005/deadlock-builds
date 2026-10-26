// lib/coach/responseValidator.ts — a message may only say what its fact says
// (docs/milestone-m6.md C6). The coach stays silent rather than show a message
// that fails. Templates are checked against it in Fixture 18; the same check
// will guard model-written text later.

import type { CoachFact, PlayerMode } from "./coachTypes";
import { fmtSouls } from "./templates";

export const MAX_WORDS: Readonly<Record<PlayerMode, number>> = { new: 60, veteran: 40 };

/** Engine and code vocabulary a player must never see. */
const INTERNAL_TERMS: ReadonlyArray<string> = [
  "scoreItems",
  "goalWeights",
  "SCORE_CATEGORIES",
  "gunDamage",
  "spiritDamage",
  "gunShred",
  "spiritShred",
  "antiHeal",
  "bonusHealth",
  "marginal",
  "coverage",
  "pairLift",
  "pairTerm",
  "categorySplit",
  "needVector",
  "basket",
  "undefined",
  "NaN",
];

// Digits with thousands separators and decimals; a trailing comma is punctuation.
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Every number the fact allows, as it may appear in text. */
function allowedNumbers(fact: CoachFact): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(fact)) {
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === "number") {
        out.add(String(v));
        out.add(fmtSouls(v));
      } else if (typeof v === "string") {
        for (const m of v.match(NUMBER) ?? []) out.add(m);
      }
    }
  }
  return out;
}

/** All text the fact carries (names, reasons), for the item-name check. */
function factText(fact: CoachFact): string {
  return Object.values(fact)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === "string")
    .join(" | ");
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

export function validateCoachResponse(
  text: string,
  fact: CoachFact,
  mode: PlayerMode,
  knownItemNames: ReadonlyArray<string>,
): ValidationResult {
  const problems: string[] = [];
  if (text.trim().length === 0) return { ok: true, problems }; // silence is valid
  const words = text.trim().split(/\s+/).length;
  if (words > MAX_WORDS[mode]) problems.push(`${words} words > ${MAX_WORDS[mode]}`);
  const allowed = allowedNumbers(fact);
  for (const n of text.match(NUMBER) ?? []) {
    if (!allowed.has(n)) problems.push(`number "${n}" is not in the fact`);
  }
  // Whole words only ("resonance" is not "NaN"); code identifiers keep their case.
  for (const term of INTERNAL_TERMS) {
    const flags = /[A-Z]/.test(term.slice(1)) ? "" : "i";
    if (new RegExp(`\\b${term}\\b`, flags).test(text)) problems.push(`internal term "${term}"`);
  }
  const carried = factText(fact);
  for (const name of knownItemNames) {
    if (name.length > 0 && text.includes(name) && !carried.includes(name)) {
      problems.push(`item "${name}" is not in the fact`);
    }
  }
  return { ok: problems.length === 0, problems };
}
