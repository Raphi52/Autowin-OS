---
name: heal
description: Drive the FULL pipeline (scout → frame → terrain → build → clean → judge) against the SICKNESS of a codebase — slowness, bugs, under-optimised and unstructured code — until a vibe-coded project becomes a structured, measured, working one. Unlike `remake`, which spends design hindsight on a FINISHED deliverable, `heal` starts from SYMPTOMS: a measured latency, a reproduced bug, a hot path nobody profiled. Every candidate it retains must carry a FALSIFIABLE symptom (a number, a red test, a trace) before any phase runs — no symptom, no heal. Trigger on `/heal`, "c'est lent", "ça rame", "optimise le projet", "répare le projet", "make it fast", "clean up this vibe-coded mess". Do NOT use to: pick a feature to build (→ `scout`), redesign a screen's look (→ `front-converge`), audit a finished deliverable (→ `judge`), or improve the kit's own rules (→ `kaizen`). heal SEQUENCES phases, it never re-implements one.
---

# heal — from vibe-coded to structured, measured, fast

## Purpose

A vibe-coded project is not broken everywhere; it is **slow and fragile in a few places nobody
measured**. `heal` refuses the two usual failures: optimising what is already fast, and "fixing"
a bug whose cause was never localised. It takes a target, produces a ranked list of **symptoms with
numbers**, and drives each one through the whole pipeline to a verified end.

**Anti-pansement is the spine of this skill.** Widening a timeout, swallowing a catch, adding a blind
retry, loosening an assertion until it passes — all are REFUSED here by construction. A fix on an
unlocalised cause is a maybe-fix on a maybe-bug.

## Procedure

### 0. BASELINE — measure before touching anything

No optimisation starts without a number that exists BEFORE the change.

- Perf: the app's own measurements (view / traces / timings) if available; otherwise a reproducible
  timing harness added under `terrain`.
- Bugs: a RED test that reproduces, or an execution trace. A bug report is not a symptom.
- Structure: a countable signal (duplicated implementations, file size, cyclomatic hot spots).

Record every baseline value with its source. **A dated measurement is not the current state** — re-probe
before using it as a target.

### 1. SCOUT — surface the symptoms

Run `scout` on the target with the heal bar: each candidate MUST carry
`file:line` + a measured symptom + a measurable done-signal (e.g. `340 ms → < 80 ms`, `test rouge → vert`).
Candidates with no number are dropped, not guessed.

Present ONE ranked table: Type (🐌 perf · 🐛 bug · 🧱 structure) · Symptom (number) · Where · Cause hypothesis · Done-signal.

### 2. Per retained candidate — the full chain

For each candidate the human retains, in order, one at a time:

1. `frame` — WHAT and the approach, with the done-signal as acceptance criterion.
2. `terrain` — the harness that makes the symptom OBSERVABLE and replayable (profiling probe,
   reproduction test). Skipped only if step 0 already produced it.
3. `build` — the fix, on the NAMED cause. Red → green is mandatory for a bug.
4. `clean` — remove the probes and scaffolding that no longer serve.
5. `judge` — verdict on the deliverable, plus **the after-measurement against the baseline**.

Never batch several candidates into one build: a mixed change makes the measurement unattributable.

### 3. REPORT — before / after, per candidate

Close with a table: candidate · baseline · after · delta · proof (exit code, test name, capture).
Anything not re-measured is reported as **non vérifié**, never as an improvement.

## Don't

- **Don't optimise without a baseline.** The most common heal failure is speeding up cold code.
- **Don't widen a timeout, swallow an error, or loosen an assertion** to make a symptom disappear.
  If a stopgap is genuinely the right call, LABEL it ("rustine temporaire — cause réelle : X") and
  dispatch the real cause.
- **Don't touch what was not named.** Structural cleanup is a candidate like any other, ranked and
  retained explicitly — never a "tant qu'on y est".
- **Don't trust a self-declared green.** The closing authority is an artefact: exit code, red→green
  test, a re-run measurement.
