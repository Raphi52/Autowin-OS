---
name: judge
description: >-
  Step 5 — FINAL step of the pipeline (frame → terrain → build → clean → judge). ADVERSARIAL, EXTERNAL review of a
  deliverable Claude produced, scored per dimension (surfaced as a verdict BAND, not false-precision digits) and
  LOOPED to the regime threshold. A panel of independent specialist-judges — each an EXTERNAL subagent (separate
  from the producer) but INFORMED of the need, the deliberate decisions, and the defect ledger — scores the work,
  lists defects WITH PROOF, and SENDS them back to the producer to fix, in a loop. The judge NEVER repairs what it
  audits. DIFFERS from code-review/verify/security-review (single-pass PR, one lens): judge is multi-dimension,
  adversarial, LOOPED. Use when a SUBSTANTIAL deliverable (any non-trivial artifact meant to be used/shipped:
  skill, script, code, doc, architecture, plan, spec — NOT a conversational reply) must be validated BEFORE it is
  considered done, OR when you want an IMPARTIAL quality look. Trigger on "review/audit the QUALITY of X", "is
  this work good?", "validate this deliverable", "is it really done?", "is it up to standard?", or right after a substantial deliverable
  is produced. DISAMBIGUATE "audit": QUALITY of a DELIVERABLE → judge; WORKFLOW / behavior / habits /
  skill set → `kaizen`, which carries the behavioral lenses (judge's ex-"Mode B", moved there on 2026-09-01
  because judge may not write to the kit and improving a behavior means editing it). Do NOT use to: frame a need (→ `frame`), prepare the autonomous
  loop/observability (→ `terrain`), run a single-pass code PR (→ code-review), nor to FIX — this skill JUDGES,
  never repairs: fixing goes back to the producer = `build` (executor following ENGINE Ch.4 — BUILD).
---

# judge — ORCHESTRATOR, external adversarial review, looped to threshold (step 5)

You are the **ORCHESTRATOR** (main session). Bring the deliverable to its regime threshold under adversarial angles, then **send defects back to the producer — never fix them yourself**. Sole excellence gate of the pipeline. Changing hats is allowed same-session: fix as producer (ENGINE Ch.4 — BUILD) between audits, then relaunch external judges — but a judge NEVER audits work it just produced. Judge audits the QUALITY of a deliverable; a behavioral/habit target goes to `kaizen`.

## Purpose
**Be the EXTERNAL quality gate the producer cannot be for itself.** A model grading its own work is complacent; judge brings independent, adversarial specialists that hunt the REAL defects WITH PROOF, score by dimension, and send them back to the producer, looping to the regime threshold. It never repairs what it audits (that re-makes it the producer); closure stays out-of-model: producer=judge is never proof.

## Autonomy mandate — ONE pass, verdict or named blocker

**An audit is carried to a VERDICT in THIS pass.** Handing back with "want me to look further?", a partial pass, or a plan of what you would review is a FAILURE. At the moment you are tempted to stop:

- A missing artifact you can PRODUCE yourself read-only (run the test suite, read the diff, take the screenshot, run the query) is produced — you do not ask the user for it. Only a genuinely unobtainable one is a blocker, and then you NAME what you tried.
- Do not answer "cannot verify" after ONE inadequate probe: enumerate and sweep the probes reachable without extra rights, and name which ones you tested (reflex 10).
- Every dimension of the regime is scored in the pass, and every defect found is written with its proof — never "and probably others".
- Loop to the regime threshold as specified below; stopping above the loop budget is reported as a budget stop, not as a verdict.

This relaxes NO independence: autonomy means completing the audit, never softening it. Judge still NEVER repairs what it audits, and a same-model panel is still not independent confirmation.

## Procedure

### Prelude (once per run)

**1. Deliverable.** Obtain its path/content. Missing → ask once.

**2. The RUN.md** — the one file matching glob `*-workspace\RUN.md` under `~\.claude\runs\<session_id>\` (user-global default, OUT of any project tree; session folder injected by the UserPromptSubmit hook; Stop-gate v3.2 scopes enforcement to it). Override via env `AUTOWIN_RUN_ROOT`. Fallback: legacy `<cwd>\Audit\workspaces\<session_id>\` if present.
  - `## Besoin` = **the fidelity reference**: deep-why, scope in/out, success criterion — a **cochable DoD checklist** (`- [ ]` items). **Walk each item against its proof; any unmet item = a MAJOR defect** (a legacy prose criterion with no `- [ ]` → verify holistically as one item). Enforcement split (rule in `RUN-template.md`): the **stop-gate** deterministically blocks green on an unchecked real-content box; the **proof behind a checked box** is judge + human. Faithful judge has the RIGHT to flag a **stale/contradicted need** as a MAJOR defect — never judge blindly against it.
  - **Deliberate decisions** (in `## Besoin`/`## Options`) = voluntary choices → judges must NOT re-flag.
  - `## Défauts` = **the ledger**, re-read cross-session (cycles consumed, global-min trajectory, resolutions). Create if absent (autonomous). Makes cap/stagnation/regression watertight.
  - No RUN.md → ask once (Faithful cannot judge without the need).
  - Require the latest product mutation to be followed by `CLEAN-VERIFIED` or `CLEAN-NOOP` in `## Journal`, with a fingerprint that still matches. Missing/stale evidence → send to `clean`. A returned defect goes `build → clean → re-audit`.
  - **Evaluate the stop criteria BEFORE launching judges** — any already met → degraded mode now (engine).

**3. Bar = regime** (header `regime:`). disposable → 1 pass, zero-major (or skip at discretion). standard → zero-major, residual minors listed non-blocking, ROI-stop once zero-major. critical → full panel + doubled [S] draws + ≥1 out-of-model source; closure via engine stops (stagnation/cap/regression), not a self-awarded numeric ceiling.

> Then run the LOOP below. It draws its panel, proof rules, and injected prompt template from the quality-audit sub-procedure under `## Modes`. For a behavioral target, route to `kaizen`.

### The LOOP

**[1] AUDIT** — launch judges in parallel with `## Défauts` ledger + decisions injected (stable summary + last-cycle delta only, never verbatim history — bounds per-cycle cost). (Panel selection, decorrelation, injected prompt template = the quality-audit sub-procedure.)

**[1b] COUNT & VALIDATE** — N dispatched ⇒ N schema-valid `je-1` replies before aggregating; missing/invalid → 1 retry → else that dimension is **INVALID** (caps the global, blocks the verdict — never silent 100).

**[2] AGGREGATE** — each [S] = median-then-MIN of its 2 decorrelated draws (gap >20 → 3rd draw MIN; spread of 3 still >15 → INDETERMINATE + stop-ask); each [F] = its single judge; global = **MIN of all dimensions** (engine) — EXCEPT a dimension whose blocking defect is `nature:intrinsic`, EXCLUDED from the MIN and carried as a visible RISK NOTE (never disguised green). Compile defects to `## Défauts`.
**Early-out**: one consolidated, unambiguous MAJOR → send it back at once, don't wait for full aggregation.

**[2b] BLIND-SPOT SWEEP** (*what no reviewer covered*) — disjoint exclusion zones guarantee each lane is examined but risk an in-scope aspect that NO lane owns slipping through **unjudged**. **Runs before any verdict ships green (or ROI-stop / degraded-closes) — NOT on an early-out send-back** (there a major already returns; the sweep guards the final clean cycle). Cross-check the UNION of dispatched dimensions against `## Besoin` scope + success-criteria: any in-scope facet or need-criterion NO judge examined = a **blind spot** (coverage GAP, not a scored defect). Record in `## Défauts` under `### Angles morts`; a blind spot over a high-risk area → **add the owning dimension (panel table) and re-run from [1]** rather than ship over an unexamined gap. Empty after a real look → state "no blind spots detected" (silence ≠ full coverage).

**[3] VERDICT** by threshold. Met → in *critical* only, run global cross-dimension verification first; then confirm the clean fingerprint and keep/set RUN `status: green`. Not met → set/keep `status: open` and **send back** prioritized defects to `build`, followed by `clean` before re-audit: same session = switch hats, fix, update ledger, clean, re-run from [1] · other session/user = emit prioritized final report and END.

**[4] RE-AUDIT** — evaluate stops FIRST, then degraded mode if any fires (engine, 1 line each): ROI-stop (zero-major reached → STOP, no cosmetic re-panels) · **intrinsic-early** (≥1 `nature:intrinsic` major at cycle 1 → degraded mode NOW, don't wait for cap — sending an unfixable major back = whack-a-mole) · **cost-cap** (cumulative audits ≥ ~15 AND global-min delta <5 over 2 transitions → forced ROI-stop even without zero-major) · cap (≈3 standard / 5 critical — a major alive at cap = under-classification, re-raise) · stagnation (global-min flat over 2 transitions) · rotating regression · design conflict. Degraded mode = **human hard-stop**: deliverable fate + 2-4 COSTED options + ship NOTHING without OK. Re-audit is **bounded to the diff**: re-judge a 100 dimension only if the diff touches its scope.
(No subagents → judge sequentially yourself, one lens per pass, keep ledger+decisions; single-pass [S] = "degraded vote"; never producer self-assessment.) The orchestrator is the **single writer** of `## Défauts`.

## Output

Final message to the user (the Report) — **in PLAIN words, NO internal jargon**. Never show raw labels (`[S]/[F]`, `artifact_based`, `je-1`, "out-of-model", "MIN", "ROI-stop", "verdict OBJECT") — translate them:
- **Global result** + one line per dimension: a **coarse band** (keep / maybe / drop) + the defect (with proof) + **what to fix to pass** (not "to_reach_100"). **Never a bare 2-digit /100** as the surfaced verdict — same-model draws on one artifact spread >20 pts; surface the band (and the spread if you show numbers), not false-precise digits.
- **Blind spots (what no reviewer examined)**, in plain words: the in-scope facets no lane covered (the `### Angles morts` sweep), or "no blind spots detected". Never silently drop an uncovered gap.
- **Confidence caveats, said plainly** when they apply:
  - same-AI panel (ALWAYS) → "all reviewers run on the same AI, and NOTHING empirically tests that this panel would catch a known defect (sensitivity check removed) — so correlated blind spots AND undetected rubber-stamping are both possible, not independently confirmed" (state on any same-model panel — silence ≠ safety; planned replacement = Roadmap's *Held-out anti-Goodhart*, ENGINE — NOT wired).
  - one reviewer instead of two (judgment dimension) → "single pass — lower confidence".
  - no execution proof → "code read only, behavior not observed" (was `artifact_based:false`).
  - trigger test not run → "could not confirm the skill actually fires".
- **Verdict + next step, plainly**: shipped / sent back to the producer with prioritized fixes / blocked — awaiting your decision before delivering. + cycles consumed.

## Modes

Target is a deliverable's quality? → the quality-audit sub-procedure below. Target is a behavior/habit/skill-set? → `kaizen`.

### Quality audit — the LOOP's sub-procedure

The LOOP runs this machinery: select the panel, confront the real, then launch judges with the injected prompt template.

**Panel (selection by nature, size ∝ regime — engine)**

| Judge | Dimension | Type |
|---|---|---|
| 🎯 Faithful **(ALWAYS)** | truly answers the need? | [S] |
| 🌍 Real-effect **(executable — MANDATORY)** | observed effect matches expected? | [F] |
| 🐛 Corrector | correctness, edge cases | [F] |
| 🔒 Guardian | security, sensitive data, abuse | [F] |
| ⚡ Optimizer | performance, efficiency, cost | [F] |
| 📐 Conformer | conventions, coherence with existing | [F] |
| 📖 Readable | readability, 6-month maintainability | [S] |
| 🧹 Lean | over-engineering, needless complexity | [S] |

**Exclusion zones (disjoint scopes — kill correlated triple-votes under MIN)**: each judge owns ONE lane and is told what it is NOT responsible for — Readable = clarity/naming ONLY (not complexity → Lean, not conventions → Conformer) · Lean = over-engineering/duplication ONLY (not style → Readable) · Conformer = conventions/coherence-with-existing ONLY (not subjective readability) · Corrector = correctness/edge-cases ONLY (not perf → Optimizer). Inject the "you are NOT responsible for X (→ Y)" line into each judge.

**By nature**: code/script → +Corrector, Guardian, Optimizer, Conformer, Readable · doc/plan/arch/spec → +Readable, Lean, Conformer (+Corrector if logic is described) · executable/UI/runtime/skill → +Real-effect MANDATORY. In doubt at CRITICAL, include; at standard, **start lean and ESCALATE**. **Size ∝ regime** (engine): disposable = Faithful (+Real-effect if it executes), no [S] vote · **standard = ESCALATING — launch a CORE of 2 (Faithful + Real-effect) first; add a risk dim ONLY on a signal (a major surfaced, a pivot flags concern, or the diff touches that dim's scope); double only the SINGLE most decision-load-bearing [S] pivot, not every [S]** · critical = full panel upfront + systematic [S] doubling + ≥1 out-of-model source (no escalation — pay for full coverage where irreversible).

**Confront the real**

**100 on TEXT alone is FORBIDDEN for any executable.** Two proof classes (engine ch.2): **REPLAYABLE** (a CLI run/build/query with no side effects) → the proof is REPLAYED not believed — the closure gate replays `signal-cmd:` when whitelisted-idempotent, a cold Verifier agent for the expensive ones · **ATTESTABLE** (UI screenshot, human-read artifact) → must self-prove: fresh, non-vacuous (N>0, exit==0, clean stderr), run-stamp-targeted, negative control. The **observation artifact is provided by the producer**; absent → **send back immediately** (not a sterile low note).

Recipes: **skill** → trigger test (router in blank context on should/should-not phrases) + 1 real run + **re-test after ANY edit** + cross-refs resolve · **script/code** → run on ≥1 input vs expected · **UI** → post-action screenshot READ · **doc/process** → walk it on 1 concrete case. Tooling unavailable → mark "triggering NON-VERIFIED" in the report; do not block 100 on an unavailable tool.

**External-contract fields (integration/portage with an EXTERNAL consumer)**: fields whose meaning lives at the external consumer — schemaLocation / schema version, emitter/sender IDs, file naming, envelope/zip format — are exercised by NO local oracle (build compiles, XSD/schema validation checks structure/types not these values, real-effect replays only the INTERNAL observable). Each such field must be either **DIFFED against the reference/legacy emitted artifact** (the real proof), or explicitly marked **"verifiable only externally — NOT confirmed"** in the report and **EXCLUDED from a clean green**. Faithful/Real-effect must NOT fold to green a field no local validator exercises. (Proven false-green: an invented `noNamespaceSchemaLocation` passed build + XSD validation + a full judge panel; only the user, knowing the partner contract, caught it.)

**Review the DIFF, not only the result** (engine): change surface ∝ the need, no out-of-scope files, no dead code/leftover debug, no secrets/credentials, no parasitic reformatting. Autonomous producers drift into opportunistic refactors — gate them here.

**Launching judges**

Launch selected judges **IN PARALLEL** (one message, multiple subagent calls — never serial). **Model & temperature DIVERSITY (decorrelation, not just economy)**: [F] grunt dims (Corrector, Guardian, Optimizer, Conformer, Real-effect) → cheap model, but SPLIT across ≥2 models when ≥4 fire (two DISTINCT models/tiers on whatever provider drives the sub-agents — never a hardcoded model name, so this survives new model releases) so a single-model blind spot can't sink the whole [F] tier; [S] pivots (Faithful, Lean, Readable) → strong model, the 2 draws at DIFFERENT temperatures (e.g. 0.0 / 0.7) or checkpoints. Same-model+same-temperature judges are maximally correlated — vary deliberately. **[S] doubling**: 2 decorrelated draws via a NAMED ORTHOGONAL LENS each (draw A and B get DIFFERENT lenses — e.g. Faithful: A="trace every claim back to a need-criterion" / B="find a need-case the deliverable doesn't cover"; Lean: A="what's over-built" / B="what's duplicated"; Readable: A="newcomer at 6 months" / B="maintainer debugging at 2am" — NOT merely "different framing") for ALL [S] in critical, but only the SINGLE top pivot in standard. **Shared digest**: read the deliverable ONCE and inline it (or the relevant slice) into every judge's prompt — don't make N agents re-Read the same small files. Stable prefix (need + criteria + decisions) then the volatile last-cycle delta only.

**Prompt template (injected per judge — full operating copy):**

> *You are an **EXPERT SPECIALIST** of the dimension **\<DIMENSION\>**, and of NOTHING else. Focused posture — a generalist who dilutes attention misses the real defects; you look ONLY at \<DIMENSION\>. You are **EXTERNAL** (you did not produce this and defend none of its choices — that is what makes you incorruptible) and **INFORMED**, not amnesiac: your role is to make the note **CONVERGE**, not restart the debate.*
>
> *[**Posture** (assigned per draw — rotate the stance; a shared posture flattens the council into ONE blind spot): default = **adversarial expert** (hunt the defect); draw B = a **contrarian** (assume it is CORRECT, find the ONE scenario where it silently fails) OR a **naive reader** (no domain expertise — does it hold for someone who doesn't already know the answer?).]*
>
> *[**Exclusion zone** (injected per judge — keep scopes disjoint under MIN): you are NOT responsible for `<X>` (→ `<other judge>`); score ONLY your own lane, stay silent on the rest.]*
>
> *Read the deliverable: `<path/content>`.
> [Faithful only: read the need (`## Besoin` of `<RUN.md path>`). You have the RIGHT to flag a stale/suspect/contradicted need as a MAJOR defect. **Walk the DoD checklist: each `- [ ]` item must hold against its proof — any unmet/unverifiable item = a MAJOR defect (need not met); a legacy prose criterion (no items) → verify holistically.**]
> [Real-effect only: do NOT score on reading — confront ≥1 concrete case with the observation artifact PROVIDED BY THE PRODUCER; artifact ABSENT → SEND BACK (do not loop a low note).]
> [Lean only: tag each over-build defect with ONE of — `delete` (dead/speculative → cut, no replacement) · `dup` (reimplements code/a dep ALREADY in this repo or an installed dependency → name the existing thing to reuse) · `stdlib` (hand-rolled → name the stdlib fn) · `native` (reimplements a platform/framework feature → name it) · `yagni` (single-impl abstraction / unused config / single-caller layer) · `shrink` (same logic, fewer lines → show the short form) — each as `<what to cut> → <replacement>`; end the note with an estimated `net: -N lines`. Judge-side echo of the producer Laziness ladder (ENGINE Ch.4) — `dup` covers its reuse-existing / installed-dep rungs.]*
>
> *You receive: (a) **need/intent**: `<Besoin>`; (b) **deliberate decisions + scope**: `<decisions + out-of-scope>` — voluntary, do NOT re-flag; (c) **ledger**: `<Défauts: defects raised + resolution>`.*
>
> ***Investigate context** — repo conventions, neighboring files, the existing code/doc this deliverable must respect. Do NOT judge in a vacuum; open useful files. (Crucial for Conformer and Faithful.)*
>
> ***Convergence discipline.** Do NOT re-litigate settled or deliberate points. FIRST verify that prior ledger fixes HOLD (falsifiable re-check). THEN report ONLY: a real **NEW** defect, an **incomplete/wrong** prior fix, or a **REGRESSION**. "Already accepted" NEVER excuses a regression. PROVE every defect.*
>
> *[F]: hunt a counter-example; found → note <100 with the case as proof; none after a serious search → 100. [S]: write the hardest hostile-expert attack FIRST, THEN score.*
>
> ***Calibration**: MAJOR (breaks/contradicts the need, blocking hole, regression) → **low note**; MINOR (friction) → **near 100**; 100 = no new/unresolved/regressed defect after a serious search. No note <100 without a named defect.*
>
> ***Few-shot** `defects[].description` — ✅ «ligne 42 : pas de null-guard sur `user.id` → TypeError sur appel anonyme» (lieu + déclencheur) · ❌ «le code est fragile» (rejeté : ni lieu ni déclencheur = non falsifiable).*
>
> *Reply ONLY in JSON:
> `{"schema_version":"je-1","dimension":"...","note":0-100,"interval":"...","unstable":bool,"unstable_reason":"...","artifact_based":bool,"defects":[{"severity":"major|minor","nature":"fixable|intrinsic|wont_fix","type":"new|incomplete_fix|regression","description":"...","to_reach_100":"..."}]}`
> (`je-1` canonical in `_engine/ENGINE.md`. `artifact_based:false` = self-declared, unverified out-of-model. **`unstable_reason`**: non-empty when `unstable:true` — WHY (missing proof vs ill-defined criterion), so the consumer fixes the right thing. **If a fact you'd need is MISSING and would move your note >20 pts → say so and flag it, don't guess a digit.** **`nature`**: `fixable` (producer can correct) · `intrinsic` (design ceiling, NOT a bug — excluded from the global MIN, carried as a risk note) · `wont_fix` (deliberate). `to_reach_100` may be `""` for a minor in a ≤standard regime — do NOT manufacture a cosmetic path to 100.)*

### Behavioral target? → `kaizen`, not judge

"Find my blind spots", "what do I systematically miss", "audit my workflow/habits" is NOT a judge
job. Judge grades a DELIVERABLE and is forbidden to write; improving a BEHAVIOR means editing the
kit. This skill carried that audit as "Mode B" until 2026-09-01 — a doublon of `kaizen` with the
opposite closing rule (judge proposed and never wrote, kaizen applies its edits). The lens list,
the "already covered" preload, the 2-dry-rounds convergence and the same-model caveat now live in
`kaizen` step 2. **Route there and stop** — do not re-derive them here.

**DISAMBIGUATE "audit"**: QUALITY of a DELIVERABLE → judge (this skill). WORKFLOW / behavior /
habits / skill set → `kaizen`.

## Don't

- **FIX what you audit** — judge JUDGES, never repairs: defects go back to the producer = `build` (or you switching hats same-session; a judge NEVER audits work it just produced).
- **Ship 100 on TEXT alone for an executable** — absent observation artifact → send back, not a sterile low note.
- **Show raw internal jargon** in the report (`[S]/[F]`, `artifact_based`, `je-1`, "MIN", "ROI-stop") — translate to plain words.
- **Emit a bare 2-digit /100** as the surfaced verdict — report a band (keep/maybe/drop) + the spread; a self-awarded precision is a judgment, not a measurement (producer=judge).
- **Disguise a degraded/INVALID state as green** — surface every false-green caveat; same-model panel is not independent confirmation.
- **Audit a BEHAVIOR here** — judge may not write to the kit, and a behavioral finding is worthless unwritten: route to `kaizen`.
- Frame a need (→ `frame`) · prepare the autonomous loop / observability (→ `terrain`) · run a single-pass code PR (→ code-review).

## Engine & reflexes

- Every scoring mechanic — proof classes (REPLAYABLE vs ATTESTABLE), `[F]`/`[S]` scoring with decorrelated draws, MIN aggregation, fail-closed `[1b]`, the `je-1` verdict OBJECT, the loop stops (ROI-stop / cap / stagnation / regression / conflict), degraded mode, fallback without subagents — is **CANONICAL in `~/.claude/skills/_engine/ENGINE.md` (Ch.2 JUDGE, Ch.3 RUN)**. Read it at the Prelude. On divergence the engine wins. (Judge's delta = the panel table + exclusion zones + the injected prompt template + the [2b] blind-spot sweep.)
- **Exception — kept INLINE here as operating copy** (NOT in the engine): the full injected judge prompt template, the panel selection table, the exclusion zones, the [S]/[F] doubling rules, and the plain-words Report translation rules. The engine carries only the `je-1` schema.

## Les LOGS de conversation — la source de première main

L'app écrit sous `.autowin-data/<profil>/` quatre journaux par conversation. **Les lire est la
première main ; une sonde agrégée est la seconde.** Ils remplacent l'Observatory : ce que
l'Observatory affichait, ces fichiers le PORTENT, et eux se lisent sans ouvrir une vue.

| journal | un fichier par | ce qu'il porte |
|---|---|---|
| `activity/conv-N.jsonl` | conversation | `chat-usage` : `costUsd`, `durationMs`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `provider`, `model`, `reasoningEffort`, `label` (= le message utilisateur du tour) ; `conversation-route` : la phase choisie |
| `causal-trace/conv-N.jsonl` | conversation | `message`, `model-response`, `decision`, `injection`, `boundary`, `error`, `response-displayed` — l'enchaînement causal réel |
| `turn-journals/conv-N/` | tour | le journal fin du tour : appels, commandes, verdicts |
| `prompt-observability/conv-N.jsonl` | conversation | ce qui est réellement parti au modèle |

**Réflexe.** Au moment où la cible est une conversation NOMMÉE — et TOUJOURS avant d'écrire
« non mesurable », « pas de données » ou « corpus vide » —, ouvrir son `activity/conv-N.jsonl` et
son `causal-trace/conv-N.jsonl` avant de conclure. Une sonde agrégée a un corpus FIGÉ : les
conversations récentes ou en cours n'y sont pas encore, alors que leur journal, lui, est déjà écrit.

**Mesuré le 2026-09-01 (conv-27).** `scout:rendement` couvrait 25 conversations et ignorait
conv-27, conv-26 et conv-28 — les trois plus récentes. La procédure telle qu'écrite menait à
« hors corpus ». `activity/conv-27.jsonl` portait pourtant les 19 appels, $9,885 et 63,3 min qui
ont permis toute l'analyse. Coût de l'omission : l'analyse entière, ou un chiffre inventé.

**Garde-fous.** Lecture seule, jamais d'écriture sur ces journaux. Un tour à `costUsd = 0` est un
tour NON INSTRUMENTÉ, pas un tour gratuit : l'exclure des moyennes. Et un journal DIT ce qui a été
consommé, jamais si le livrable était bon — l'acceptation se lit dans le fil, pas dans le coût.
