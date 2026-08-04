---
name: remake
description: Harvest the hindsight that only a FINISHED product reveals, then spend it by DRIVING THE WHOLE PIPELINE. Reads the completed deliverable as its own specification, then runs `scout` (with the regret bar) to surface the candidates, `frame` on every candidate that emerged, and the full chain per framed need — `build` → `clean` → `judge` — before replaying the target's own signal. One gesture instead of a pipeline steered by hand. Unifies "si tu devais le refaire en analysant le produit fini, que ferais-tu différemment ?" followed by "fais-le". Trigger on `/remake`, "si tu devais le refaire", "que ferais-tu différemment", "refais-le mieux", "avec le recul, comment tu l'aurais construit", "remake this", "rebuild it knowing what you know now", or right after a deliverable is verified and you want the accumulated compromises paid down. The proof obligation is INVERTED versus build: there is no bug to reproduce, so every change must prove it breaks NOTHING — the target's existing signal is the net, and remake REFUSES to run without one. It sequences the phases and never re-implements one. Do NOT use to: audit whether a deliverable is correct or done (→ `judge`, whose bar is the DEFECT, not the design regret); pick what to work on when no finished deliverable is in question (→ `scout` alone); remove residue from failed attempts (→ `clean`); improve Claude's own behaviour or the kit's rules (→ `kaizen`).
---

# Remake — the second system, built for real

## Purpose

A finished product reveals the shape it should have had. Decisions taken under uncertainty are now
obviously wrong; an abstraction added out of caution turned out unnecessary; the structure grew by
accretion rather than design. That lucidity exists **only once the thing is done**, and it evaporates.

`remake` harvests it and spends it. It reads the finished deliverable as its own specification, asks
what would be built differently starting today, and **drives the whole pipeline on the answer** —
`scout` to surface the candidates, `frame` on each one that emerged, then `build` → `clean` → `judge`.
One gesture instead of a pipeline steered by hand, prompt after prompt.

**The bar is the design REGRET, not the defect.** `judge` finds what is *wrong* — a defect, provable
against the need. `remake` finds what is *not wrong but would be written otherwise*. Confusing the two
turns taste into obligation.

## The inverted proof obligation — read this before anything else

`build` proves a change **fixes** something: there is a bug, so there is a red→green. `remake` has no
bug to reproduce. Its changes must prove they break **nothing** — a harder guarantee, and the one a
bare "fais-le" never provides.

Three consequences, all non-negotiable:

1. **No signal, no remake.** If the target has no verifiable out-of-model signal (test suite, exit
   code, readable capture, query), STOP and say so. Autonomous execution whose only net is a signal
   that does not exist is the single configuration where this skill becomes harmful.
2. **Green before, green after.** Capture the signal green FIRST — a target already red is `build`'s
   job, not a retrospective's. Replay it after. A signal that was never green beforehand proves nothing
   afterwards.
3. **One rollback point, before touching anything.** A commit or checkpoint of the original state, so
   the entire remake undoes in one gesture. Full autonomy without an atomic undo is what makes this
   dangerous; the undo is what makes it safe.

## Procedure

### 0. Preconditions and RUN

Target = the deliverable of the current RUN, else an explicitly named file/module/folder. **Never the
whole repository implicitly** — that yields a shallow sweep at ruinous cost. Too large to hold? Say so
and ask which slice; do not skim.

Open or reuse the one living `RUN.md` (ENGINE Ch.3). Then apply the three consequences above, in order:
signal exists → signal green → rollback point created. Record each in the Journal.

### 1. SCOUT — surface the candidates, with the regret bar

Delegate the derivation to `scout`, whose job is exactly this: sweep a target and return a ranked
candidate table. `remake` supplies what `scout` cannot invent — **the bar is the design regret, not the
defect**, and the target is a deliverable that already WORKS. Pass the lenses below as the scouting
lenses; a candidate here is "would be written otherwise", never "is broken".

One opinion on "what I'd do differently" is taste. Several independent lenses make it a finding. Fan
out in parallel (ENGINE Ch.1), dedup by core idea:

- **Structure** — what would live elsewhere, be split, or be merged.
- **Naming** — what a reader must decode instead of read; names that lie about what they hold.
- **Unnecessary abstraction** — indirection added for a case that never came. An interface with one
  implementation, an alias for one caller, a hook nobody uses.
- **Coupling** — what knows too much about what; the change that forces three unrelated edits.
- **What would not be built at all** — the sharpest lens, and the one nobody runs. Which piece exists
  only because it seemed necessary at the time?
- **Today's skeleton** — sketch what you would write NOW from the need alone, then diff against the
  real thing. The literal "if you had to redo it". The gaps are the findings. Keep it a sketch: a
  full reconstruction invents a fantasy skeleton disconnected from the constraints that shaped the code.

Each finding names **the observation that would catch its regression** — without that line, a later
audit cannot tell the safe from the lucky.

### 2. Rank, then SHOW THE COST before going further

Two separate axes, never one collapsed score (ENGINE Ch.1 display rule): a high-impact finding stays
visible even when costly.

Everything that emerged then goes through `frame` (step 3) — so the list length IS the price. Before
committing to it, surface one line: how many candidates emerged, how many agents that implies, roughly
what it costs. "What would you do differently" invites rewriting everything; the answer to that is a
VISIBLE cost and the user's call, not a silent truncation. If you drop anything, say what and why — a
quiet cut reads as "covered everything" when it did not.

### 3. FRAME every candidate that emerged

A `scout` candidate is a lead, not a task: it names a WHAT with no settled approach. Feed each one to
`frame`, which is the step that scopes the need, checks what already EXISTS (the duplicate trap), picks
the approach among scored options, and states its assumptions. Framing is what turns a regret into
something executable — skipping it hands `build` a vague wish and gets a vague change back.

Independent candidates frame in PARALLEL (ENGINE Ch.1). Two candidates touching the same code are NOT
independent: frame them together, or sequence them, so the second is framed against the first's result
instead of a stale reading.

### 4. Run the pipeline to the end — build → clean → judge

Each framed need runs the real chain, in order: `build` (executes, red→green, anti-regression proof) →
`clean` (post-build hygiene) → `judge` (adversarial audit). Add `terrain` before `build` only when the
work needs an autonomous loop or a harness that does not exist yet.

`remake` decides WHAT and drives the sequence; each phase owns its HOW. Do not grow a second execution
engine, a second audit, or a second cleanup — a divergent copy of a phase is worse than no phase.

`judge` returns defects to `build`, not to `remake`: that loop belongs to the phases and runs to the
regime threshold before control comes back here.

**FROZEN PERIMETER — propose, never write.** If the target is the kit (`~/.claude/skills`), the hooks,
`CLAUDE.md`, or memory: produce the ranked list and STOP — before `frame`, before any phase. A skill
that rewrites its own rules autonomously is precisely what `kaizen` forbids, and the prohibition does
not lift because a different skill is asking, nor because the pipeline is what would do the writing.

### 5. Close

Replay the signal — the target's own, from step 0, not a phase's internal verdict. A green `judge` on
each candidate does not prove the target still works as a whole: the phases each proved their own
change, nobody proved their SUM. Green → report what changed, what was dropped, and the rollback
handle. Not green → revert to the rollback point; a remake that leaves the target worse than it found
it has failed, and says so.

## Output

The ranked candidates (impact ⊥ effort, with what was dropped and the cost shown), what each one was
framed into, the phases actually run per candidate with their verdicts, the target's signal replayed
green before and after, and the single rollback handle. Written in the living RUN.md.

## Don't

- **Run without a signal** — the refusal is the feature, not a limitation.
- **Rewrite the frozen perimeter** — kit, hooks, `CLAUDE.md`, memory: propose only.
- **Present a regret as a defect** — that is `judge`'s bar, and borrowing it makes the skill lie.
- **Skim a target too large to hold** — ask for the slice.
- **Reimplement a phase** — `scout` surfaces, `frame` scopes, `build` executes, `clean` tidies, `judge`
  audits. `remake` sequences them and adds the regret bar; it re-implements none of them.
- **Hand `build` an unframed candidate** — a scout lead is not a task; `frame` is the step that makes it
  one.
- **Hide the cost of "everything that emerged"** — the candidate count is the price. Show it.
- **Close on the phases' verdicts alone** — replay the TARGET's signal at the end; per-candidate green
  never proves their sum.
- **Use to**: audit an existing deliverable (→ `judge`) · pick what to work on when no deliverable is in
  question (→ `scout` alone) · clear failed-attempt residue (→ `clean`) · change Claude's own behaviour
  (→ `kaizen`).

## Engine & reflexes

- Parallel fan-out, loop-until-dry, dedup-by-core-idea, the impact ⊥ effort display rule: canonical in
  `_engine/ENGINE.md` **Ch.1 GENERATE & GATE**. Execution mechanics: **Ch.4 BUILD**. On divergence, the
  engine wins.
- Reflex anchor: **closure authority lives outside the model** (reflex 2). Here it is the target's own
  signal — which is why a target without one is refused rather than guessed at.
