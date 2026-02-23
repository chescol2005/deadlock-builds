# DeadlockFoundry Engine Architecture

This engine is deterministic, explainable, and pure.

Rules:
- No side effects
- No async logic inside scoring
- No UI imports
- Fully typed
- No implicit any
- No magic constants
- All scoring must return explanation metadata
- Engine must be testable in isolation

The engine converts:
Hero Profile + Player Intent + Current Build → Ranked Item Recommendations

The output must include structured breakdowns for UI rendering.