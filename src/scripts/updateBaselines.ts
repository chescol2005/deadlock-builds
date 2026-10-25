// src/scripts/updateBaselines.ts — shows how scoring changes move the recorded
// baseline baskets, and rewrites them on request (item scoring review §2.1).
//
// Run: npm run baseline              print the diff against baselines.json
//      npm run baseline -- --update  rewrite baselines.json (then review the
//                                    git diff and describe it in the PR body)

import { writeFileSync } from "node:fs";
import { loadFrozen } from "@/lib/engine/__fixtures__/frozen/frozenInputs";
import {
  BASELINES_FILE,
  computeBaselines,
  diffBaselines,
  formatBaselines,
  readBaselines,
} from "@/lib/engine/__fixtures__/frozen/baselines";

const next = computeBaselines(loadFrozen());
const current = readBaselines();
const diff = current ? diffBaselines(current, next) : [];

if (!current) console.log("no baselines.json yet");
for (const d of diff) {
  console.log(`\n~ ${d.key}`);
  const before = new Set(d.before ?? []);
  const after = new Set(d.after ?? []);
  for (const line of d.before ?? []) if (!after.has(line)) console.log(`  - ${line}`);
  for (const line of d.after ?? []) if (!before.has(line)) console.log(`  + ${line}`);
}
console.log(
  `\n${Object.keys(next.cases).length} cases, ${current ? diff.length : "all"} changed` +
    ` (inputs ${next.inputs.captured}, patch ${next.inputs.patch})`,
);

if (process.argv.includes("--update")) {
  writeFileSync(BASELINES_FILE, formatBaselines(next));
  console.log(`wrote ${BASELINES_FILE}`);
}
