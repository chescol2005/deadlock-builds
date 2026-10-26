# Milestone M6: the build coach

**Status:** APPROVED 2026-10-25 (user sign-off of the whole doc, M6.0). Decisions in §7.

**References:**

- CLAUDE.md "M6 Design Decisions" and the `coach-prompting` skill;
- `docs/competitive-analysis.md` ("the natural base for M6");
- eight high-level-player videos the user supplied on 2026-10-25 (roles, laning, counter
  items, macro, jungle, crates, picking a main), listed in §9.

## 1. Goal

A new player picks a hero, builds, and is told **what matters right now and why**, without
reading a wiki: proactive, short, and never wrong about the numbers. A veteran hears from the
coach only when it has something they would not have noticed.

**What makes it ours.** Competitors bolt AI onto win-rate tables. This coach narrates
reasons the deterministic engine already computed, plus a small set of rules written down
from high-level play. It never invents a fact.

## 2. Architecture: facts first, words last

```
BuildClient state ──► lib/coachContext.ts ──► CoachContext (plain facts) ──► lib/coach/
  (build, basket,       builds the facts;        roles, totals, warnings,      rules: speak or not
   starter build,       may read engine           reasons, trigger              (pure); words:
   anti-synergies)      outputs                                                 template or model
```

- **`lib/coach/`** (not `src/lib/coach/`: the repo has no `src/lib`; the skill is corrected
  in this milestone) is pure. It has zero imports from `lib/engine`, `lib/scoring` or build
  state. It receives a `CoachContext` and returns a message or silence.
- **`lib/coachContext.ts`** sits outside the coach. It turns what BuildClient already
  computed into plain facts: the basket's headline reasons, anti-synergy warnings, stat
  totals, the starter build and the hero's role. That is the only bridge, and it is a pure
  function.
- **`lib/heroRoles.ts`** is a new hand-authored data table (§4), cited like `BOON_THRESHOLDS`.
  It is data, not AI.
- **Deciding whether to speak is deterministic.** `shouldFireCoach` and the insight rules
  (§5) choose _which_ fact to surface. A model, if used, only phrases it (§7).
- **The scoring rules still hold:** no AI in scoring or the data pipeline, and every coach PR
  is separate from scoring PRs.

## 3. `CoachContext` (real fields only)

The skill's draft asked for `heroDifficultyRating: "easy" | "medium" | "hard"` and one
`heroArchetype`. Neither exists:

- the API has `complexity` 1–4 (Sinclair is 4; CLAUDE.md says 1–3, which is corrected here);
- `tags` are flavour words (G5 found no role signal in them).

The role comes from §4 instead.

```ts
interface CoachContext {
  playerMode: "new" | "veteran"; // BuildClient viewMode: simplified | advanced
  hero: {
    id: number;
    name: string;
    complexity: number; // API, 1–4
    roles: HeroRole[]; // heroRoles.ts, primary first
    onlineAtSouls?: number; // heroRoles.ts: when the hero starts to fight
  };
  souls: number; // boon slider's cumulative souls
  boonLevel: number;
  build: CoachItem[]; // active + game plan, with phase and flags
  investedSouls: Record<"gun" | "spirit" | "vitality", number>;
  facts: CoachFact[]; // computed by coachContext.ts (§5), each with an id
  trigger: CoachTrigger; // what happened
}
type CoachTrigger =
  | { type: "hero_selected" }
  | { type: "item_added"; itemId: string }
  | { type: "item_removed"; itemId: string }
  | { type: "starter_applied" }
  | { type: "build_reviewed" }; // user asks for a review
```

`CoachItem` carries name, category, tier, cost and the plain-English description already
shown in the planner.

## 4. Hero roles (M6.0b)

**Draft from the videos.** These are the role lists from Metro's video ("Every hero's role
explained"), mapped to API names. The captions misspell several heroes: Barbara is Baba,
Vexus is Viscous, Moon Krill is Mo & Krill, Nurse Hero is Nurse Harrow, Dorman is The
Doorman, and Viper is Vyper.

| Role      | Heroes                                                                                   | Souls       | Online at                                  | How to play (coach source)                                                               |
| --------- | ---------------------------------------------------------------------------------------- | ----------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Carry     | Infernus, Lady Geist, Mirage, Rat King, Seven, Venator, Victor, Warden, Wraith           | most        | first 6k item, ~20–25k; must fight at 30k+ | side lane, waves then camps; join fights after your spike; split push during a far fight |
| Off-carry | Apollo, Calico, Celeste, Grey Talon, Lash, Mina, Pocket, Vindicta, Violet, Vyper, Yamato | second      | ~12–15k                                    | win lane, then pressure other lanes and fight at your peak; don't farm through it        |
| Support   | Dynamo, Kelvin, Mo & Krill, Nurse Harrow, Paige, Rem, Sinclair, Solomon, The Doorman     | least       | from the start                             | push lanes, save teammates, take fights; never farm your carry's lane                    |
| Initiator | Bebop, Haze, Holliday, Paradox                                                           | per build   | —                                          | roam unseen; catch first, since the team that catches first usually wins                 |
| Tank      | Abrams, Baba, Billy, Shiv, Silver (Yamato also)                                          | some        | —                                          | go in first and soak damage; rotate to big fights, don't split push                      |
| Hybrid    | Drifter, Graves, Ivy, McGinnis, Viscous                                                  | team's need | —                                          | play the role your team is missing, and build for it                                     |

- **Deadman Danny is unassigned.** He was not out when the video was made, so his role is
  inferred from data (below) or left as unknown, never guessed.
- **A hero can hold two roles**, for example Yamato (off-carry + tank) or Haze (initiator +
  carry). The other video's positions 1–6 are kept as a secondary label where they disagree.

**Checked against data, not just opinion.** For every hero, M6.0b measures its share of team
net worth at 20 min and at the end of the game, from `/v1/analytics` at Oracle+. Carries
should rank highest and supports lowest. A hero whose measured share contradicts its listed
role is flagged for the user to decide, not silently changed. The table carries the
measurement next to the source.

## 5. What the coach says (insights)

Each insight is a deterministic fact with an id, a trigger, a rule, and a "do this
instead". Wording below is an example (new player / veteran).

| Id                   | When                       | Rule (computed in coachContext.ts)                                                      | New player                                                                                               | Veteran                                                  |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `role_intro`         | hero_selected              | the hero's primary role                                                                 | "Seven is a carry: farm a side lane and the jungle, then join fights once you have your first big item." | silent                                                   |
| `first_in_category`  | item_added                 | first gun / spirit / vitality item                                                      | one line on what that category does for this hero                                                        | silent                                                   |
| `green_before_spike` | item_added                 | not a tank, vitality ≥ 4,800 souls, no 6,400 damage item yet                            | "You have plenty of defence. Your next big buy should add damage."                                       | "4.8k in vitality and no damage spike: buy damage next." |
| `counter_stack`      | item_added                 | 2+ mid-game counter items (Counterspell, Dispel Magic, Metal Skin…) and no damage spike | "One counter item is usually enough. More will leave you without damage."                                | same, shorter                                            |
| `anti_synergy`       | item_added                 | `detectAntiSynergies` fires                                                             | the warning plus the fix                                                                                 | same                                                     |
| `next_buy_reason`    | item_added, build_reviewed | the basket's top pick and its `headlineReason`                                          | "Next, consider X: it ..." (reason from the engine)                                                      | only if it differs from the last one                     |
| `spike_reached`      | item_added                 | carry or off-carry crosses its online-at souls or buys its spike item                   | "This is your power spike: start joining team fights."                                                   | silent                                                   |
| `support_greed`      | item_added                 | support role, 2+ items ≥ 6,400 and still at mid souls                                   | "Supports win games with abilities, not items. Push lanes and stay with your team."                      | silent                                                   |
| `gap_after_remove`   | item_removed               | the removal drops a category to zero, or breaks an upgrade chain                        | "That was your only healing item."                                                                       | same                                                     |
| `starter_explained`  | starter_applied            | the starter build's per-item reasons                                                    | one line on the phase plan                                                                               | silent                                                   |
| `empty_build`        | hero_selected, build empty | —                                                                                       | points at "Start from a suggested build"                                                                 | silent                                                   |

**Silence rules** (from the skill, made testable):

- Never repeat an insight in a session.
- At most one message per action.
- Veterans hear only the `veteran` column.
- Never warn without the fix.
- Speak only facts present in `CoachContext`: no invented numbers, no item that isn't in the
  context.
- Never name internal scoring terms.

**Out of scope for M6:**

- Lane matchups ("buy Restorative Shot in a poke lane") and counter-buying for the enemy
  team. Both need to know the enemy heroes, which the planner doesn't have. They go into a
  later milestone with an enemy-team input.
- Map advice (farm routes, crates), which belongs in the guides.

## 6. Where it shows up

- **`CoachPanel`** is a new presentational panel in `/build` with `simplified?: boolean`. It
  shows the latest message, a dismiss button and a mute toggle.
- **Default:** on for everyone (user, 2026-10-25). Veterans still hear only the `veteran`
  column of §5, and anyone can mute it.
- **Fixture 9 gains the panel.** "Does the AI coach have a hook?" becomes checkable: the
  basket and starter-build panels pass their reasons through the context.

## 7. Decisions (user, 2026-10-25)

1. **Templates first.** Every insight in §5 has hand-written wording per audience: no cost,
   no API key, fully testable. A Claude model comes later, in its own milestone, for
   `user_asked` and varied phrasing, with the prompt sandbox, server route and cost cap. So
   M6 has no `user_asked` trigger, and M6.1 / M6.4 move to that later milestone.
2. **On for everyone by default**, with a mute toggle (§6).
3. **The role table is checked against match data** before the coach uses it, and
   disagreements come back to the user (§4, C3).

## 8. Acceptance criteria

| #   | Criterion                                                                                                                                                                                | How it's checked                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| C1  | `lib/coach/` imports nothing from `lib/engine`, `lib/scoring` or app state                                                                                                               | fixture: import scan                           |
| C2  | Every one of the 44 heroes has a role (or an explicit "unknown" with a reason), and every role cites its source                                                                          | fixture over the live hero list                |
| C3  | The role table agrees with measured net-worth share, or each disagreement is listed and signed off                                                                                       | M6.0b report in this doc                       |
| C4  | Each insight fires on its scenario and stays silent otherwise, per audience                                                                                                              | fixtures: one scenario per insight, both modes |
| C5  | No insight repeats in a session, and at most one fires per action                                                                                                                        | fixtures on session memory                     |
| C6  | Messages never contain a number or item name missing from the context, or an internal term                                                                                               | validator + fixtures over all insights         |
| C7  | The skill's six scenarios pass (first spirit item, anti-synergy, Abrams intro, no healing after 8 items, "what next?", empty build), plus messy builds (0 items, 12 items, one category) | fixtures over the templates                    |
| C8  | Muting works and persists per visitor; no message shows while muted                                                                                                                      | fixture + manual check                         |
| C9  | CoachPanel passes Fixture 9 (simplified prop, shared Tooltip) and stacks on mobile                                                                                                       | Fixture 9 / 16                                 |

## 9. Tasks

| #     | Task                                                                                  | Agent / model                                                  | PR                 |
| ----- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------ |
| M6.0  | This doc, signed off                                                                  | Opus                                                           | docs               |
| M6.0b | `lib/heroRoles.ts` + net-worth check against analytics                                | Opus; `data-verifier` (Sonnet) cross-checks                    | data (not scoring) |
| M6.1  | Deferred (templates chosen): prompt sandbox for the later model milestone             | —                                                              | —                  |
| M6.2  | `lib/coach/`: types, `shouldFireCoach`, session memory, insight templates, validator  | Opus                                                           | AI layer           |
| M6.3  | `lib/coachContext.ts`: facts from build, basket, starter build, anti-synergies, roles | Opus                                                           | AI layer           |
| M6.4  | Deferred (templates chosen): `app/api/coach/route.ts`                                 | —                                                              | —                  |
| M6.5  | `CoachPanel` + BuildClient triggers                                                   | `panel-builder` (Sonnet)                                       | UI                 |
| —     | Review on every PR                                                                    | `scoring-auditor` (Sonnet; isolation, purity) + `/code-review` | —                  |

Each PR runs the full flow: mini output in the body, CI, merge, branch delete.

**Moved out of M6:**

- M7: Beginner / Aggressive / Safe starter templates (engine work).
- M8: the skill-path planner (from the existing grid plus match data).
- Per-ability damage impact when adding an item (a deterministic display change).
- Enemy-team input for lane and counter advice (§5).

**Video references** (opinions of a few high-level players, meta-dependent):

- roles as positions 1–6: https://www.youtube.com/watch?v=O6SgMNGHs7Q
- roles with hero lists: https://www.youtube.com/watch?v=JouUab99B4Y
- laning: https://www.youtube.com/watch?v=kUPk1pCdAI4
- counter items: https://www.youtube.com/watch?v=NV8G-p3xzmI
- macro: https://www.youtube.com/watch?v=DCO1AQQjZG0
- jungle: https://www.youtube.com/watch?v=cEnAlNpIxlQ
- crates: https://www.youtube.com/watch?v=BxD0LxueKKA
- picking a main: https://www.youtube.com/watch?v=VZFfsuDT0sw
