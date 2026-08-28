---
name: graft
description: GRAFT a new skill onto the kit when the supervisor judges one is missing. Trigger the MOMENT a PROCEDURE is being improvised for the second time — "on refait le même enchaînement à la main", "il faudrait une skill pour ça", a recurring class of work with no owner in the kit, a repeated failure that no existing skill's trigger catches. `graft` turns that repetition into a named, bounded, discoverable SKILL.md, then RUNS it on the case at hand. Do NOT use to: build a missing TOOL or command (→ `forge`), fix or sharpen an EXISTING skill's rules (→ `kaizen`), pick what to work on (→ `scout`). graft adds ONE skill, the one the current work keeps improvising.
---

# graft — the supervisor extends its own kit

## Purpose

`forge` answers "I have no TOOL for this". `graft` answers "I have no PROCEDURE for this". A
recurring shape of work improvised each time is a skill that has not been written yet. `graft`
writes it — once, bounded, discoverable — and never as a licence to grow the kit for the pleasure
of growing it. Every skill added is a line the model must read every turn: the kit pays for it.

## Entry gate — four questions, in order

1. **What repeated shape of work?** Name at least TWO real occurrences (conversation ids, runs,
   commits). One occurrence is a task, not a skill. No second occurrence → no graft.
2. **Does an existing skill already own it?** Read the `description` front-matter of every skill
   in the kit — that line IS the trigger. If one covers it, the answer is `kaizen` (sharpen its
   trigger), not a new skill. The duplicate skill is failure mode number one: two triggers that
   overlap make the router pick at random.
3. **Is a skill the right shape?** A missing capability is `forge`. A missing rule is `kaizen`. A
   one-off is just work. Graft only a repeatable PROCEDURE with a recognisable MOMENT.
4. **What does it cost?** State it: one more line in every turn's snapshot. If the skill would
   fire less than roughly once a month, say so and stop.

If 2 answers "yes", stop and say which skill owns it. Report the search, do not graft.

## Procedure

### 1. SPEC — the trigger before the body

Write, in the run, before any file: the `name` (one word, verb-like) · the MOMENT it fires, in the
user's own words · what it must NOT be used for, naming the neighbouring skills · the artefact it
must leave behind. A skill with no stated boundary will be picked for work it cannot do.

### 2. WRITE — front-matter first

`skills/<name>/SKILL.md`, with a YAML front-matter carrying `name` and `description`. The
`description` is not documentation: it is the ONLY thing the router sees, and it is truncated to
roughly 200 characters in the turn snapshot. So the first sentence must carry the MOMENT, not the
philosophy. Match the kit's existing shape: Purpose · Entry gate · Procedure · Report · Don't.

### 3. REGISTER — verify discovery, do not assume it

The kit root is scanned, so no list needs editing — which is exactly why this step is skipped and
exactly why it must not be. Re-read the app state and confirm the new name appears in the
snapshot's skill list, with its trigger phrase attached. Not appearing = not grafted, whatever the
file says on disk.

### 4. PROVE ON A REAL CASE

Run the new skill immediately on the occurrence that motivated it, and report what it produced.
A skill never exercised is a hypothesis. If the first run shows the trigger is wrong, fix the
front-matter before closing — that correction is the cheapest it will ever be.

### 5. JUDGE

Submit the new SKILL.md to `judge` as a deliverable: overlap with neighbours, trigger precision,
falsifiable output. A skill written and judged by the same model is self-declared; say so.

### 6. RETAIN

`remember` ONE fact: the shape of work that had no owner, `type: lesson`, with the two occurrences
as evidence.

## Report

Close with: the two occurrences · the neighbouring skills checked and why they don't own it · the
skill grafted (name + its trigger in one line) · discovery confirmed from the app state · the real
case it was run on and its outcome · the judge verdict.

## Don't

- Don't graft from a single occurrence, an intuition, or "that could be useful one day".
- Don't write a skill whose trigger overlaps a neighbour's — sharpen the neighbour instead.
- Don't declare it available because the file exists: read the app's own catalogue.
- Don't graft a skill and leave the motivating work undone.
- Don't let the kit grow silently: every graft names its cost in the report.
