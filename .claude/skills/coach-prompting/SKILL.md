---
name: coach-prompting
description: >
  Design, validate, and iterate on AI coach prompts for Deadlock Foundry's
  M6 coach layer. Use this skill whenever working on the AI coach module
  (src/lib/coach/), designing system prompts for the coach, deciding what
  coaching triggers should fire, writing coach response templates, or
  prototyping coach behavior in Claude.ai Artifacts before implementation.
  Also use when evaluating whether a coach message is too verbose, too
  vague, or not helpful for new players. Always use this skill before
  writing any coach-related code — prompt design must be validated first.
---

# Coach Prompting Skill

## Core Constraint — Read First

The AI coach in Deadlock Foundry is **completely isolated from scoring**.

```
src/lib/coach/          ← coach lives here only
src/lib/scoring/        ← coach NEVER imports from here
```

Coach responses are **narrative strings only**. The coach:

- Never modifies BuildState
- Never calls scoreItems()
- Never reads goalWeights or antiSynergy directly
- Receives a pre-computed `CoachContext` object as input (see below)

---

## Audience Split — Design for Both

**New player mode** (simplified language):

- Plain English, no jargon — "this item heals you over time" not
  "this item provides OutOfCombatHealthRegen"
- Short sentences. One insight per message.
- Encouraging tone — guide, don't criticize
- Trigger threshold: lower — warn early and often
  **Veteran mode** (detailed language):
- Stat names, scaling coefficients, soul costs acceptable
- Concise — they know the game, don't over-explain
- Trigger threshold: higher — only fire when genuinely useful
  Mode is passed via `CoachContext.playerMode: "new" | "veteran"`.

---

## CoachContext Shape

This is the object the coach receives. Design prompts around these
fields — never assume access to raw BuildState.

```typescript
interface CoachContext {
  playerMode: "new" | "veteran";
  heroId: string;
  heroName: string;
  heroDifficultyRating: "easy" | "medium" | "hard";
  heroArchetype: string; // e.g. "Brawler", "Sniper", "Support"
  activeItems: CoachItem[];
  gamePlanItems: CoachItem[];
  abilityLevels: Record<string, number>;
  currentBoonLevel: number;
  totalSpiritPower: number;
  totalBonusHealth: number;
  selectedGoal: BuildGoal;
  triggerEvent: CoachTrigger; // what fired this coach call
}

interface CoachItem {
  id: string;
  name: string;
  category: "gun" | "spirit" | "vitality";
  tier: 1 | 2 | 3 | 4;
  cost: number;
  description: string; // plain text, from API
}

type CoachTrigger =
  | { type: "item_added"; item: CoachItem }
  | { type: "item_removed"; item: CoachItem }
  | { type: "build_reviewed" }
  | { type: "goal_changed"; newGoal: BuildGoal }
  | { type: "hero_selected" }
  | { type: "user_asked"; question: string };
```

---

## Trigger Design — When the Coach Should Fire

The coach is **proactive**. It fires automatically on these events:

| Trigger                 | New Player                                  | Veteran                          |
| ----------------------- | ------------------------------------------- | -------------------------------- |
| `hero_selected`         | Always — introduce archetype + starter tips | Never                            |
| `item_added` (tier 1-2) | If no items in same category yet            | Never                            |
| `item_added` (tier 3-4) | Always — explain synergy or warn            | If anti-synergy detected         |
| `item_removed`          | If build now has a dangerous gap            | If build now has a dangerous gap |
| `goal_changed`          | Always — explain what the goal means        | Never                            |
| `build_reviewed`        | Always                                      | Always                           |
| `user_asked`            | Always                                      | Always                           |

**Anti-patterns to avoid:**

- Never fire on every single item add for veterans — noise kills trust
- Never fire the same insight twice in one session
- Never fire a warning without a suggestion for what to do instead

---

## System Prompt Template

Use this as the base for all coach API calls. Customize the
`[AUDIENCE BLOCK]` section per playerMode.

```
You are a build coach for the game Deadlock. Your role is to give
concise, helpful advice about the player's current build.

[AUDIENCE BLOCK — NEW PLAYER]
Speak in plain English. Avoid game jargon unless you define it.
Keep responses to 1-2 sentences maximum. Be encouraging.
Focus on one thing the player should know right now.

[AUDIENCE BLOCK — VETERAN]
Be concise and specific. Use stat names and numbers freely.
Only speak when you have a genuine insight — don't narrate the obvious.

Rules you must always follow:
- Never invent stat values — only reference numbers in the context
- Never recommend specific items by name unless they appear in context
- Never reference scoring weights or internal calculations
- If you don't have enough context to give useful advice, say nothing
  (return an empty string)
- Responses must be under 60 words for new players, 40 for veterans

Current build context:
{COACH_CONTEXT_JSON}

Trigger event: {TRIGGER_DESCRIPTION}

Respond with ONLY your coaching message. No preamble, no labels.
If you have nothing useful to say, respond with an empty string.
```

---

## Response Validation Rules

Before shipping any coach response to the UI, validate:

```typescript
function validateCoachResponse(response: string): boolean {
  if (response.length === 0) return true; // empty = valid (silence)
  if (response.length > 300) return false; // too long
  if (response.includes("scoreItems")) return false; // leaked internals
  if (response.includes("goalWeights")) return false;
  if (response.includes("SCORE_CATEGORIES")) return false;
  return true;
}
```

---

## Prototype-First Workflow

**Always prototype in Claude.ai Artifacts before writing code.**

Step 1 — Build a coach sandbox Artifact:

- Input fields: heroName, archetype, item list, trigger event, playerMode
- Calls Anthropic API with the system prompt template above
- Displays raw response + word count
- Lets you toggle new/veteran mode and re-run
  Step 2 — Validate against these scenarios before implementing:
- [ ] New player adds first Spirit item — does coach explain what Spirit does?
- [ ] Veteran adds an anti-synergy item — does coach warn concisely?
- [ ] New player selects Abrams (easy brawler) — does hero intro make sense?
- [ ] Build has no healing after 8 items — does coach flag the gap?
- [ ] User asks "what should I buy next?" — is the response useful?
- [ ] Empty build — does coach stay silent or give useful starter tip?
      Step 3 — Only after all 6 scenarios pass, hand the finalized system
      prompt to Claude Code for implementation in `src/lib/coach/`.

---

## Coach Module File Structure

```
src/lib/coach/
  index.ts              — public API: getCoachMessage(context)
  coachTypes.ts         — CoachContext, CoachTrigger, CoachItem types
  systemPrompt.ts       — buildSystemPrompt(context) function
  triggerRules.ts       — shouldFireCoach(trigger, context, mode) function
  responseValidator.ts  — validateCoachResponse(response) function
  sessionMemory.ts      — track fired triggers to avoid repetition
```

---

## Common Mistakes to Avoid

1. **Leaking internals** — coach prompt must never mention scoring
   categories, goalWeights, or antiSynergy by name
2. **Over-firing** — every item add for veterans destroys trust fast
3. **Under-context** — coach needs item descriptions in CoachContext,
   not just IDs — make sure the context builder fetches them
4. **Prompt brittleness** — test with messy builds (0 items, 12 items,
   all one category) before shipping
5. **Mode drift** — new player language must stay plain even when the
   coach has high-value insight — resist the urge to go technical
