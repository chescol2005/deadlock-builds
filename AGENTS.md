# DeadlockFoundry.gg – Agent Boundaries & Responsibilities

This document defines architectural role boundaries within the system.
Its purpose is to prevent logic leakage, unclear ownership, and non-deterministic behavior.

The system follows a deterministic-first philosophy.

---

# Core Architectural Principle

Deterministic systems produce canonical outputs.
AI systems may interpret results, but must not replace deterministic logic.

The scoring engine is the source of truth.
AI layers explain, summarize, or critique — never compute core rankings.

---

# Agent Roles

## 1. Engine Agent (Deterministic Layer)

Location:
`lib/engine/`

Responsibilities:
- Item scoring
- Intent normalization
- Stage-based score aggregation
- Deterministic sorting
- Producing `EngineOutput`

Rules:
- No network calls
- No browser APIs
- Pure functions only
- Fully typed inputs/outputs
- Deterministic under identical input

The engine must be explainable and testable in isolation.

---

## 2. Data Agent (Ingestion & Normalization Layer)

Location:
`lib/`

Responsibilities:
- Fetch external API data
- Normalize raw API responses
- Enforce data contracts
- Provide stable typed structures to engine

Rules:
- No UI logic
- No scoring logic
- No AI behavior
- Fail loudly on schema mismatch

The data layer protects the engine from unstable external sources.

---

## 3. Review Agent (AI Analysis Layer)

Future Location:
`lib/review/` or `lib/analysis/`

Responsibilities:
- Analyze match data
- Interpret engine output
- Provide strengths/mistakes feedback
- Generate natural language explanations

Rules:
- Must not alter deterministic scoring
- Must consume engine output, not re-compute it
- Must treat engine output as canonical

AI may interpret — never override.

---

## 4. UI Agent (Presentation Layer)

Location:
`app/`

Responsibilities:
- Render engine results
- Display breakdowns
- Collect user input
- Trigger engine execution

Rules:
- No scoring logic
- No normalization logic
- No data mutation
- Derive state from source of truth

UI reflects system state — it does not compute it.

---

## 5. Orchestration Layer (Future)

If multi-step workflows are introduced:

Responsibilities:
- Sequence data ingestion
- Call engine
- Trigger review analysis
- Coordinate outputs

Rules:
- Must not embed scoring logic
- Must not mutate engine output

---

# Layer Interaction Rules

Data Agent → Engine Agent → Review Agent → UI Agent

Never:
- UI → Engine internals
- Review → Engine mutation
- Engine → Network
- Engine → UI

All flows are one-directional.

---

# Determinism Guarantees

The engine must guarantee:

- Same input = same output
- Stable sort ordering
- Explicit versioning
- Explicit scoring breakdown
- No randomness

If a feature requires non-determinism, it belongs in Review Agent, not Engine Agent.

---

# Versioning Rule

Engine output must include a version field.

If scoring behavior changes:
- Increment version
- Document change
- Update tests

---

# Testing Expectations

Engine Agent:
- Unit tested
- Snapshot safe
- Deterministic

Data Agent:
- Schema validated
- Defensive parsing

Review Agent:
- Evaluated qualitatively
- Never relied on for numeric truth

---

# Long-Term Vision Alignment

DeadlockFoundry.gg aims to become:

- A deterministic build optimizer
- An AI-assisted performance coach
- A scalable competitive analytics platform

To support this:
- Deterministic core remains stable
- AI layers remain interpreters, not authorities
- Architecture prevents logic drift

---

# Final Rule

If unsure where logic belongs:

1. If it computes rankings → Engine Agent
2. If it fetches/parses external data → Data Agent
3. If it explains or critiques → Review Agent
4. If it renders → UI Agent

When in doubt, keep the engine pure.