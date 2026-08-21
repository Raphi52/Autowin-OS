---
name: frame
description: >-
  Step 1 of the pipeline (frame → terrain → build → clean → judge). FRAMES a need in depth AND, if the framed need
  leaves an open choice of approach, EXPLORES the options — two passes inside ONE skill. Trigger on TWO trigger
  families. (a) FRAMING — whenever a request is phrased as a SOLUTION ("create X", "add Y", "make the script Z", "set up..." — but setting up the autonomous LOOP/harness for an already-framed need → `terrain`), when a need is
  vague (vague about a CHOSEN task → frame; vague about WHICH task to pick → `scout` first), or on "define/frame the need". EXPLICITLY includes creating a
  doc/README/CLAUDE.md/config: trigger to CHECK it doesn't already exist and to frame its content — creating a
  file that already exists (or that misses its real content) is a classic expensive trap. This is THE default
  entry point on any substantial work — trigger YOURSELF on a solution-shaped request, without waiting for the
  word "frame". EXCEPT (CLAUDE.md hard-gates): a pure ADVISORY question ("which is best / is it better to / what is / why", expecting a direct answer) → answer directly, NO frame; a still-OPEN form/premise ("not sure if X or just Y?", a question mark on the FORM itself) → stay conversational and converge the form FIRST, never route or fire a QCM presupposing a chosen form. (b) APPROACH CHOICE — the HOW for an ALREADY-chosen task (choosing WHICH task to pick → `scout`) — "which approach / architecture / library to choose for X", "explore the options" (of the already-chosen approach), "compare the
  approaches", "generate lots of solutions and have them vote", "help me decide between several designs". DO NOT use to: prepare the HOW of autonomous execution (→ `terrain`); judge the quality of a
  finished deliverable (→ `judge`); find WHAT to do on a target when no task is chosen yet (→ `scout`); run the
  heavy protocol on an obviously trivial, disposable AND already-precise one-shot (say it's oversized, offer
  direct implementation); nor throw 2-3 ideas around with no scoring process.
---

# frame — two passes, one skill: frame the need, then (if open) explore the options

## Purpose
**Understand the need at 100% — including what the user did NOT write.** Frame the real PROBLEM (not the
requested solution) and actively surface the **unstated**: implicit constraints, hidden presuppositions, and
the **blind spots the user never articulated** — so nothing un-asked sinks the work downstream. Everything
below is HOW that happens: the archetype questions pull the implicit out, the blind-spot sweep hunts what no
question touched, the board-gate auto-answers the evident and surfaces to the human only what genuinely needs them.

**Frame under anticipated audit (a lever)**: the Faithful `judge` WILL trace every need-claim back to a criterion (a stale/contradicted need = a defect it can flag) — producing for that falsifiable scrutiny tightens the need; it sharpens the framer, never the judge.

## Procedure

### 0. RUN file
Open or complete the **one** living `RUN.md`: `~\.claude\runs\<session_id>\<subject>-workspace\RUN.md` (kebab-case slug; `session:` header; session-scoping + legacy fallback → **ENGINE Ch.3 (RUN details) + foundation §1**). Set `regime:` (disposable | standard | critical) on entry. A `disposable` one-shot may need no RUN file (proportionality). Write `## Besoin`, `## Contraintes`, and (if reached) `## Options` here — never in separate files.

### Pass A — the need (always)

**0. Mirror the ask — ANCHOR, never REPLACE** (opening move; A/B-validated 2026-06-30). The user's message stays the SOURCE OF TRUTH — never rewrite it into a generated prompt the rest of the work then runs on (that silently buries YOUR interpretation as if it were theirs). Open by restating the understood intent in your words **+ what you'd assume — but every assumption stays a QUESTION** ("⚠️ I read this as X — correct me"), NEVER a deduced cause / direction / scope ASSERTED as fact.
- **The trap (A/B cas C3, the counter-intuitive one)**: a "reformulation" that says *"probably it's a missing margin:auto"* on a bug you haven't reproduced is WORSE than staying agnostic — it commits the work to a false lead with an authoritative tone. So a CAUSE (bug) = a hypothesis to **MEASURE** (reproduce/read first), never injected as established context; a SCOPE (permissions/security/rights) = **surfaced for validation**, never baked in silently.
- **OPEN goal** (design / "magnifique" / "améliore" / "nouvelle vision" / any aesthetic or direction-shaped ask) → do NOT frame a spec. Force **DIVERGENCE first** — 2-3 distinct options the user picks from (visual → `front-converge`; otherwise Pass B), because imposing a full invented spec on an open goal is the worst drift (A/B cas C1). This composes with the CLAUDE.md still-OPEN-form hard-gate (converge the form before routing).

**1. Pre-checks — before any question:**
- **Solution in disguise** — "create/add/make X" is an answer, not a problem. Trace back to the underlying problem; impact of skipping ≥80 → surface it. Never frame the artifact before the problem is named.
- **Check EXISTING first** — single recon fan-out (ENGINE ch.1 generate, parallel) before framing anything, especially for a doc/README/config: does it exist, what does it cover. Cite facts.
- **Impact surface (blast-radius)** — MAP what the need will AFFECT: files/modules/configs/callers/docs/tests it touches, breaks, or must stay coherent with, plus what CONSTRAINS it (upstream deps, platform limits, policies). Single recon fan-out, parallel; cite `file:line`. Feeds scope-out (what stays INTACT) + success criterion; an empty map is a finding (isolated change). **Re-run (overwriting) if anything before `## Besoin` shifts the need** — new actor/output, overturned constraint, or changed delivery medium.
- **Trivial off-ramp** — obviously trivial + disposable + already-precise → say framing is oversized, offer direct implementation. Do not run the heavy protocol.

**2. EXTRACTION vs ANALYSIS** — two question kinds, never confused. EXTRACTION pulls what the user already holds (intent, constraints, taste) → ask them. ANALYSIS settles what only investigation can (what exists, what's feasible, what costs) → you go find out, never outsource it. Never dress an analysis question as a faux-QCM the user can't actually answer.

**3. Question phase** — pool of archetype generators via ENGINE ch.1 (Naive · Breaker · Contradictor · Perfectionist · Diplomat · Explorer · Pragmatist · Emotional), generated in parallel (one message). **Naive opens** (decompose every term, surface every presupposition); questions scored on merit (impact × autonomy-confidence). **Board-gate** auto-answers the self-evident as stated assumptions ("I'm assuming X, based on <fact> — correct me", never silently), surfaces to the human ONLY strictly-private / high-impact / genuinely uncertain. **High-impact override**: impact ≥80 → surface regardless of confidence (sole carve-out: a "why" they already stated). Stop when best raw impact <30, gate exhaustion, or round cap.

**Discipline (non-negotiable):**
- QCM-first — concrete choices before open prose; **one question at a time**, never a wall. QCM only when intent space is BOUNDED (by an artifact: log / diff / repro / stated constraint). Space still OPEN → open question, never a QCM — a QCM there locks the user into YOUR categories. **The moment the user rejects or redirects a QCM = your categories are wrong**: drop the options, go back to the open question; do NOT re-offer the same choices reworded. **Categories must SPAN the space BEFORE you emit (kaizen)**: when an existing artifact is in scope, the option set MUST include a "replace / refonte / start-fresh" branch (not only additive ones), and any load-bearing PREMISE of an option (a system state, a file's existence/value) must be verified with a cited check BEFORE emitting — board-gate the QCM's own premise (reflex 1).
- Refuse the vague — "three-nothings" (no nothing / no idea / whatever in a row) → reframe, never accept fog.
- **No solution during framing** — proposing a HOW is forbidden. The instant a solution is on the table you've flipped from PRODUCTION (you drive) to REACTION (you defend an artifact) — pull back to the problem.
- Anti-drift on opening: decompose each term and its presuppositions rather than widening scope.

**4. Blind-spot sweep** (Fusion-inspired — *what no question touched*) — before writing the need: which facet did NO archetype/question probe **and no board-gate stated-assumption already cover**? These are the **UNASKED** (unknown-unknowns), DISTINCT from open questions (known-unknowns deferred to `terrain`). **Loop, don't one-shot** — re-sweep, each round using a DIFFERENT archetype as a coverage lens (Breaker = unprobed failure mode; Naive = unexamined presupposition — its analysis use, not question-generation). Stop when a round finds nothing new (no facet with impact ≥30 not already listed). **Regime cap**: disposable = 1 pass · standard = max 2 rounds · critical = until 2 dry rounds, max 3. Name blind spots so they surface; high-impact one → ask it now rather than defer.

**5. Risk pass** — before writing the need, list **threats to the success criterion**: what could make this FAIL (dependency not ready, perf/scale ceiling, data loss / irreversibility, a stated assumption turning false, external blocker, scope creep). Each = **severity** (likelihood × impact) + one-line **mitigation/watch**. DISTINCT from blind spots (unprobed facets) and impact surface (existing affected): a risk is a KNOWN threat you can already name. High-severity risk with no mitigation → surface it (a need isn't fully framed while a fatal risk is unowned).

**6. Write `## Besoin` + `## Contraintes`** (plain words the user reads — no internal labels): `## Besoin` holds the real problem (not the requested solution) · scope in/out · a **verifiable success criterion as a cochable DoD checklist** (`- [ ]` exit conditions, each naming a PROOF — **format + rules: see `RUN-template.md`, the single source**; `disposable` may keep a one-line criterion — proportionality) · deliberate decisions · stated assumptions · **impact surface** (existing affected, cited) · **risks** (threats to success: severity + mitigation) · **blind spots** (Pass-A sweep's unknown-unknowns) · open questions left for `terrain`. `## Contraintes` holds only solution bounds, each classified `HARD` or `SOFT` with source and consequence of violation; do not duplicate `Scope OUT`. **Short retro**: what signals showed up this run → patch thresholds so next time bites earlier.

**7. Confidence ledger — nothing load-bearing leaves this skill unverified** (anti-hallucination gate; the LAST move of Pass A, after `## Besoin` is written). List every claim the framed need **RESTS ON**: what exists, what a file / API / flag / table is called, how something currently behaves, what a constraint actually says. Mark each exactly one of:
- **VERIFIED** — NAME the out-of-model artifact that establishes it, opened or run **this session**: `file:line` you actually read, a command + its exit code, a query result. A path you cite without having opened it is not verified.
- **FROM THE USER** — they stated it. It carries their authority, not yours; if it turns out false, that's a surfaced correction, not a silent one.
- **UNVERIFIED** — inferred, recalled, or assumed. Includes anything a memory note or a past run told you (dated evidence proves what was true AT ITS DATE).

Then **resolve, don't annotate**: every UNVERIFIED claim the downstream work would DEPEND on gets settled BEFORE handoff — read the file, run the probe, grep the caller. Not "think harder about it": an actual check. Only if it cannot be settled without the user (their intent, private context) does it become ONE surfaced question; only if it cannot be settled at all does it become a **stated assumption in `## Besoin` + a risk with its mitigation** — never a silent given. Write the result in RUN.md as `## Confiance`.

**Why this is NOT "rate your confidence"**: self-reported certainty is the one signal a hallucination leaves undisturbed — an invented API name feels exactly as solid as a real one, so introspection cannot separate them. What separates them is not the feeling, it's the **receipt**. So the question is never "am I sure?" but "**which artifact says so, and did I open it?**" A claim with no receipt is unverified by definition, however obvious it feels — and "it feels obvious" is a reason to check it, not to skip it.

**The claims most likely to be invented are the most mundane ones**: a flag or option name, a file path, a function signature, a column name, a default value, a version, "the tests already cover that". Grand architectural claims get scrutiny; small factual ones ride through — and one wrong path name is enough to send a whole build down a road that does not exist.

**Repetition is not verification.** Once an invented fact is written into the RUN, every later step reads it back as established, and the frame becomes its own source. The ledger is built against ARTIFACTS, never against your own earlier prose.

**Regime cap**: `disposable` = the load-bearing claims only · `standard` = every claim in `## Besoin` · `critical` = all of them, plus one adversarial re-read asking "which of these could I NOT prove to someone who doubts me?".

---

### Between passes — forced path or open choice?

After `## Besoin` is written, decide: does the framed need leave a real, unsettled choice of HOW (which architecture / library / pattern), or does a single obvious path fall out of the constraints?

- **Forced path**, OR trigger family (a) only with no design question → **skip Pass B**, hand straight to `terrain`.
- **Genuine fork** (open choice remains), OR trigger family (b) ("which approach", "compare", "explore options") → **run Pass B**.

---

### Pass B — options (ONLY if an open choice of approach remains; else skip)

**1. Generate** by approach-lenses (ENGINE ch.1: MVP · robust · perf · lean · reuse-existing · creative · cost-first · UX-first · convention · contrarian), loop-until-dry, **dedup by core idea**.

**2. Score** in RANKING mode (ENGINE ch.2): typed criteria, fidelity as the eliminatory veto (~0 disqualifies), weighted sum post-veto; 2 decorrelated draws on subjective dims, median-then-MIN. (This weighted sum is the INTERNAL compute of the order — NOT what's shown: the DISPLAY to the human surfaces Impact ⊥ Effort as separate axes, never a single collapsed score — ENGINE Ch.1 display rule, see step 5.)

**2b. Adaptive deepen-vs-widen** *(AB-MCTS-inspired pilot — a score-driven DECISION over the EXISTING actions of steps 1 & 3; reuses step 2's `gg-1` scores, NO new scorer; **`disposable` → skip this step**)*: AFTER step 2 is complete, read the score distribution and make ONE routing decision before finalizing — **clear dominant top → STOP** (the net-new bit: early-exit straight to step 3, no extra round) · **top promising but rough → DEEPEN**: route through step 3's grafts (don't shortcut to finalize) · **scores low / clustered, no winner → WIDEN**: re-enter step 1's loop-until-dry with MORE divergent lenses (its ~12-candidate / 2-dry-round caps still bind). DEEPEN/WIDEN add NO new action — they route into steps 3/1; only the STOP early-exit is new. **Cap ≤1 extra round** — step 1 (WIDEN) OR step 3 (DEEPEN), not chained. *(worked example: scores 88/52/49 → dominant top → STOP · 70/66/61 → clustered, no winner → WIDEN · 84/80/55 → top rough vs strong runner-up → DEEPEN.)* Thresholds (dominant / clustered) = judgment — the score guides, it doesn't gate. *Caveat: superiority over plain one-shot is a HYPOTHESIS, unproven (a loop-policy's value is hard to measure out-of-model).*

**3. Top-K (3–5)** with trade-offs + grafts of discarded options' best parts.

**4. Blind-spot check across options** — a need-case that NONE of the top-K covers = a coverage gap, not a ranking detail. Note it in `## Options` (label `Uncovered case`); if it implies a genuinely distinct option, add it before finalizing the ranking — don't let the leaderboard hide it.

**5. Human decides.** Present the ranked top **with Impact ⊥ Effort surfaced as two separate axes** (ENGINE Ch.1 display rule — never a single collapsed score; a high-impact option stays visible even when costly) and let them pick. Only on an explicit "decide for me" do you pick the top-ranked and state why.

**6. Write `## Options`** — ≥3 scored, genuinely distinct options (the stop-gate's ⚓ ANTI-FIXATION will verify this before any engaged decision; straw options are a defect) + a `Décision:` line.

---

### Done
Hand off to `terrain` (regime propagated through the RUN header). **Never report "done"** until `## Besoin` + `## Contraintes` + `## Confiance` (and, when Pass B ran, `## Options` + `Décision:`) are actually written in RUN.md. **A frame with an unresolved load-bearing UNVERIFIED claim is not done** — handing it off launches the whole pipeline on a maybe.

## Output

`## Besoin` + `## Contraintes` + `## Confiance` sections in RUN.md — always. `## Options` + `Décision:` line in RUN.md — only when Pass B ran. All written in the one living RUN file; never separate need/options/ledger files.

## Don't
- **Propose a HOW** during Pass A framing — that flips you from production to reaction.
- **Outsource analysis questions** as faux-QCMs — go find out yourself.
- **Run the heavy protocol** on an obviously trivial + disposable + already-precise one-shot — say so, offer direct implementation.
- **Claim "done"** before `## Besoin` (and `## Options` + `Décision:` if Pass B ran) are written in RUN.md.
- **Accept vague fog** — three-nothings in a row → reframe.
- **Hand off a frame carrying an unresolved load-bearing UNVERIFIED claim** — the pipeline then builds on a maybe. Verify it, surface it, or write it as a stated assumption + risk. Never leave it looking like a fact.
- **Report a confidence FEELING** ("I'm fairly sure X exists") in place of a receipt — name the artifact you opened, or mark it unverified.
- **Use to**: prepare HOW of autonomous execution (→ `terrain`) · judge a deliverable (→ `judge`) · find WHAT to do when no task is chosen (→ `scout`).

## Engine & reflexes
- Shared pool mechanics — **parallel fan-out, loop-until-dry, dedup-by-core-idea, the two /100 scales (impact ⟂ autonomy-confidence), the auto-resolve-vs-surface gate, schema `gg-1`** — are CANONICAL in `_engine/ENGINE.md` **Ch.1 GENERATE & GATE** (question generation) and **Ch.2 JUDGE** (its scoring & ranking mechanics, reused for Pass B). On divergence, the engine wins.
- Reflex anchor: **solution in disguise = trap #1** — trace "create/add/make X" back to the real problem before framing anything. And **check what EXISTS before framing** (especially docs/configs): creating a duplicate is the classic expensive trap.
