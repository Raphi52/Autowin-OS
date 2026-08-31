---
name: kaizen
description: >-
  Continuous-improvement loop on Claude's OWN behavior: turn a session (BY DEFAULT the CURRENT one it is
  invoked in) into VERIFIED, SELF-APPLIED EDITS to the kit files — `skills/` · `hooks/*.ps1` ·
  `settings.json` · `CLAUDE.md` (+ `CONSTITUTION.md` mirror) · memory — that improve Claude's FUTURE behavior.
  ORCHESTRATES, never re-implements the audit: (1) LOCATE the target — BY DEFAULT the CURRENT session it is
  invoked in (reconstruct it from its OWN transcript `~/.claude/projects/<project>/<SESSION_ID>.jsonl`, the
  `SESSION_ID` injected each turn by the UserPromptSubmit hook); OR a named PAST session ("kaizen session X /
  the last one I tried to kaizen" → find by first-prompt / topic / a prior `kaizen`-fork); OR a named
  behavior; OR an AUTOWIN conversation (`conversation_read` / `conversation_search` / `retrospective`, never the
  transcripts alone); OR an INJECTED instruction (the app system prompt, phase consignes, output-styles); OR a recurrent telemetry pattern surfaced by the `kaizen-nudge` Stop hook; (2) AUDIT behaviorally by REUSING
  `judge` Mode B (parallel behavioral lenses — anchoring/honesty, communication, scope-drift, cross-session
  state, model-shared blind spot… — each finding 1-2 blind spots with a FALSIFIABLE anchor quoted from the
  transcript + a severity; loop with new lenses until 2 dry rounds); (3) DEFINE, for each blind spot, the TARGET BEHAVIOR — what should have happened for a good USER experience — and derive the rule from THAT, not from the symptom; (4) CONSOLIDATE to ONE root cause + a
  ranked table (blind spot · anchor · target behavior · proposed rule · integration point); (5) STATE the edits it is about to make, in plain words, so they are readable BEFORE and revertable after; then (6) INTEGRATE them itself — no approval wait — preferring
  a WIRED trigger (hook + CLAUDE.md hard rule) over a passive memory fiche (loading ≠ applying — a fiche alone
  was violated twice the same session), VERIFY each edited hook with an out-of-model signal (parse + behavior +
  negative control), then prove NON-RECURRENCE — replay the exact failing situation against the installed
  fix and show it now BLOCKED (« ça ne doit pas se reproduire » : an edit that cannot be shown to stop the
  ORIGINAL failure is not a fix), then run your local Autowin clone's `sync-kit.ps1` (live→package) and log the treated signature to
  `kaizen-treated.jsonl`. Mechanics are CANONICAL in `_engine/ENGINE.md` + `judge` Mode B; kaizen carries only
  the delta: target-location, the self-applied integrate step, sync-kit, and the one-commit-per-edit constraint.
  Trigger on "kaizen this session", "improve the kit from my recurring failures", "audit
  my habits / workflow / blind spots", "what do I systematically miss", "analyse les defauts dans les
  workflows / les conversations / les comportements / les injections", "audite tout Autowin", OR right after the `kaizen-nudge` hook
  surfaces a recurrent failure pattern. Do NOT use to: audit the QUALITY of a one-off deliverable → `judge`
  (Mode A); fix a single code defect → `build`; frame a new need → `frame`. Kaizen targets the BEHAVIOR/kit,
  not a specific artifact.
---

# kaizen — improve the system from its own failures (behavioral audit → state → integrate → verify)

## Purpose
**Make the SYSTEM learn from its own failures — so the same mistake doesn't recur next session.**
The acceptance criterion is NON-RECURRENCE, not insight: « ça ne doit pas se reproduire ». A finding is only
treated when the ORIGINAL failing situation, replayed against the installed fix, is now BLOCKED or corrected —
naming the defect, understanding it, or writing a rule about it changes nothing until that replay is shown. Turn a
session's blind spots (defects Claude hit, corrections the user gave) into VERIFIED, SELF-APPLIED edits to
the kit (CLAUDE.md reflexes / hooks / skills / memory) that change FUTURE behavior. It APPLIES its own edits, each in a DEDICATED commit and each backed by an out-of-model verification — the garde-fou is revertability, not a wait.

## Procedure
1. **LOCATE the target** (the step judge Mode B doesn't carry). **DEFAULT = the CURRENT session** — the conversation `/kaizen` is invoked in. Read its OWN transcript on disk: `~/.claude/projects/<project>/<SESSION_ID>.jsonl` (+ `subagents/`, `tool-results/`), where `<SESSION_ID>` is the id injected each turn by the UserPromptSubmit hook (also visible in any `SESSION_ID=…` system reminder). The transcript is written as the session runs, so it's available mid-session — point the audit lenses at THAT file. No need to ask which session; "kaizen" alone = kaizen THIS one. Other targets, only if the user names them (confirm, don't assume):
   - **a named PAST session** — "kaizen session X / the last one I tried to kaizen". Find it by first user prompt, dominant topic, or a prior `kaizen`/`kaizen-past-session` fork. **Cite the evidence** (first prompt + a topic line) and CONFIRM before auditing — a wrong target wastes the whole fan-out. Given a disambiguator (a remembered first prompt, a topic), grep all `projects/*/*.jsonl` for it.
   - **a named behavior / habit / skill-set** — pass straight to Mode B's behavioral lenses.
   - **an AUTOWIN conversation, or the app's whole history** — the cockpit's conversations are NOT in `~/.claude/projects/*.jsonl`: a transcript holds one agent session, a conversation holds what the USER actually asked, corrected and refused. Read them with the app's own capabilities — `conversation_read` for a named id, `conversation_search` to find the fil from a phrase, `retrospective` for a turn's causal events (tools called, refusals, verdicts, cost) and its RUN.md. "Kaizen tout Autowin" = a NAMED or SEARCHED sample, never all of them implicitly (981 conversations = ruinous). A defect the user CORRECTED lives here and nowhere else.
   - **a recurrent telemetry pattern** — the `kaizen-nudge` Stop hook fired on `gate-counters.jsonl` (anti-flaky / fix-gate / revert recurring ≥ threshold). The pattern IS the target; audit whether it's a real habit or inflated noise (the detector itself can be the defect).
2. **AUDIT — reuse `judge` Mode B (do NOT reimplement).** Run judge Mode B on the target: preload "already covered" (global `CLAUDE.md` + memory index + installed skills) so lenses don't re-flag the known; fan out 6-9 behavioral lenses IN PARALLEL (one message), model-diverse to decorrelate; each returns 1-2 NEW blind spots, each with a **falsifiable anchor** (exact quote + line) + severity + a proposed rule + an integration point. Loop with NEW lenses until 2 dry rounds (cap 3).

   **Two families of lenses, not one.** Mode B's default lenses are BEHAVIORAL (anchoring/honesty, communication, scope-drift…) and they read a transcript. A defect of the SYSTEM does not always show there, so fan out a second family when the target carries RUNs or conversations — **WORKFLOW/TOPOLOGY lenses**, which read `RUN.md` and the causal trace rather than prose:
   - **routing** — the phase actually played versus the one the demand called for (a `build` on an unframed need, a `judge` while work remained).
   - **fan-out sizing** — agents spent versus the regime bracket; a parallel round that returned nothing new.
   - **gate arming** — a RUN closed `green` with an unticked DoD, a `signal-cmd` never replayed, `gate: off` or `disposable` on work that needed a net.
   - **loop economics** — judge→build iterations, cost per turn, a re-run of something already tried (the retrospective shows it).
   Each keeps Mode B's contract: a falsifiable anchor (the RUN path + the line), a severity, a proposed rule, an integration point.

3. **DEFINE THE RIGHT BEHAVIOR (UX target) — before proposing any rule.** A defect names what happened; it does NOT say what SHOULD have happened. For each consolidated blind spot, write the **target behavior in one sentence, from the USER's experience**: at that exact moment, what would have been the good response/action for the person in front of the screen (what they get, when, in what form, what they are spared) — and what makes it good (less friction, no wasted turn, nothing to re-type, no false claim, the decision left where it belongs). Derive the rule FROM that target, never straight from the defect: a rule written against a symptom produces a prohibition (« ne fais plus X ») that leaves the agent with no behavior to run; a rule written from the target produces a REFLEX (« au moment où X → fais Y »). If two plausible target behaviors compete (answer directly vs. offer a choice, act vs. ask), name both, pick one with its reason, and record the discarded one — a rule installed on an unarbitrated target is a guess. When the target touches something the user alone can settle (a taste, a trade-off between speed and control), surface it as a question instead of freezing it into the kit. The non-recurrence replay (step 6) then tests the TARGET behavior, not merely the absence of the defect.

4. **CONSOLIDATE.** Dedup across lenses; surface the ONE root cause (what a single specialist would miss) + a ranked table: `blind spot · anchor · severity · proposed rule · integration point (hook / CLAUDE.md hard-rule / memory / just-known) · scope (global+mirror / local-only / project)`. **Adjudicate** the lenses — reject a finding that re-flags a deliberate decision or overstates (you verify the real artifact, never a lens's word). State honest caveats (same-AI correlation — correlated blind spots not independently ruled out).
5. **STATE the edits — readable before, revertable after** (CARDINAL). Present the table in PLAIN words: what changes, in which file, why there. This is a DECLARATION, not a request for permission. It exists so the user can read the delta and revert it, not so kaizen can wait. A producer=judge "100" is not proof — which is why every edit carries an out-of-model verification and its OWN commit (lived: "intrinsic" concluded wrongly 3×; a dedicated commit makes that revertable in one command).
6. **INTEGRATE — edit the kit to change FUTURE behavior, immediately.** The deliverable IS the edit. Before picking a file, run an explicit **placement analysis** per finding — REASON it, don’t look it up, and surface the "why here" in the STATE table. Three axes: **SCOPE** (below), **ENFORCEMENT** (wired hook+rule > recall fiche — see bullets), **FOLD vs NEW** (extend/retire before adding — see bullets).
   - **SCOPE decides the file AND whether to mirror** — the most-missed axis:
     - **global** (every machine/project) → `~/.claude/CLAUDE.md` **+ mirror `CONSTITUTION.md`**.
     - **local** (THIS machine only — RIG hooks, paths, project gates) → the **« Local »** section of `~/.claude/CLAUDE.md`, **NOT mirrored** (a machine-specific fact in the shared `CONSTITUTION.md` pollutes the company kit).
     - **project** (one RIG sub-project) → that project's `CLAUDE.md` (e.g. `<project-root>\CLAUDE.md`), never the global constitution.

   Then map the kind of fix to the file (the **target-map**), at the scope decided above:
   - **a triggered reflex / hard rule** → `CLAUDE.md` (+ `CONSTITUTION.md` **only if global**) — the reflexes loaded every session.
   - **an automatic, deterministic guardrail** → a **hook** (`hooks/*.ps1`) + its **wiring in `settings.json`** (and the package `hooks/settings-snippet.json`). This is the STRONGEST fix — code that fires on its own.
   - **a workflow/skill behavior** → the relevant `skills/<x>/SKILL.md` (or a new skill).
   - **an INJECTED instruction — the app's own prompting, not the kit's** → the text Autowin injects at runtime: the cockpit's system prompt, the per-phase consignes, `output-styles/*.md`, the replayed reminders and retrieved-knowledge blocks. This is a REAL and frequently-missed target: a behavior can be wrong because the injection says so, and no amount of editing `CLAUDE.md` will fix it — the injection is read LAST and wins. Anchor the finding on the injected TEXT quoted verbatim, locate its emitter in the app source (`find_in_files` on the quoted phrase), and treat a fix there as a code change, subject to the project's own signal — not a kit edit.
   - **a recall-only nuance** → a `memory/` fiche + the `MEMORY.md` index.

   Then:
   - **Prefer a WIRED trigger** (a hook + a CLAUDE.md/CONSTITUTION hard rule) over a passive memory fiche — loading ≠ applying (a fresh fiche was violated twice the same session). Memory fiche = reinforcement, not the primary enforcement.
   - **Edit on the REAL file** (read it first — never edit on a sub-agent's report), surgically, on what is NAMED. Don't redesign deliberate, hardened mechanisms in passing (that's a blind-fix — flag it as a design question to the human instead).
   - **Trim-or-replace, don't just append (kaizen 2026-06-19)** — the constitution/memory has a FINITE attention budget (loading ≠ applying). Every reflex/fiche ADDED must FOLD into an existing one (extend a clause) or RETIRE/merge a stale one — never proliferate a new number for what an existing reflex already frames. A growing rule-count dilutes attention to ALL rules; prefer one tight clause over a new reflex.
   - **VERIFY each edited hook out-of-model** via `~/.claude/hooks/test-hooks.ps1` (per hook: parses, fires on the right input, SILENT on the negative control — it catches a closure hook gone fail-open). Extend its fixtures when you add/edit a hook, and add a `check: powershell -NoProfile -File <…>\hooks\test-hooks.ps1` line to the RUN so closure re-runs it. Never break the closure-authority hooks.
   - **Propagate**: run `sync-kit.ps1` from your local Autowin clone (live→package) after editing any live skill/ENGINE/hook/output-style; a NEW file (skill/hook) must also be ADDED to the sync-kit manifest + the README install steps (the manifest is a fixed list — new items are silently missed otherwise).
   - **PROVE NON-RECURRENCE (CARDINAL — the closing test)**: for EACH installed edit, rebuild the exact situation that produced the defect (the quoted anchor turned into an input: same hook payload, same prompt shape, same RUN/gate configuration) and replay it. The fix holds only if the replay is now REFUSED / corrected / flagged, AND a negative control that must stay silent still passes. A fix that only reads well, or whose original scenario cannot be replayed, is declared as such (« non rejoué ») — never as treated. If the replay still reproduces the defect, the edit is INSUFFICIENT: escalate the enforcement (fiche → hard rule → wired hook) instead of restating the rule.
   - **Close the loop**: append the mandatory JSONL line to `~/.claude/kaizen-treated.jsonl` (schema in **Output**).

## Output
The deliverable is the STATE table (presented in PLAIN words) + the integrated edits themselves, one commit each, + the close-the-loop log line.

**STATE table** — ranked, one row per consolidated blind spot:

| blind spot | anchor | severity | target behavior (UX) | proposed rule | integration point | why here (scope) |
|---|---|---|---|---|---|---|
| what a single specialist would miss | exact quote + line from the transcript | sev | what SHOULD have happened, seen from the user | the rule to install, derived from that target | hook / CLAUDE.md hard-rule / memory / just-known | global+mirror / local-only / project — + the one-line reason |

**Mandatory `kaizen-treated.jsonl` schema** — append ONE line to `~/.claude/kaizen-treated.jsonl` per treated signal:
`{"gate":"<fix-gate|anti-flaky|stop>","treatedCount":<count at treatment>,"ts":"<iso>","note":"<what changed>"}`
`gate` + `treatedCount` are REQUIRED: `kaizen-nudge.ps1` filters by `gate` and reads `treatedCount` to gate the re-nudge (≥ +5) — a line missing either silently breaks the anti-spam. The nudge then goes silent on the resolved (re-nudge only if the count climbs ≥ +5 again).

**Done** — recap in plain words: root cause, what was integrated + where, what was VERIFIED (the out-of-model signal), **the non-recurrence replay per edit** (situation rejouée → résultat: bloqué / corrigé / non rejoué), caveats. **Never report "integrated/done"** without the verification artifact. The net is the commit log: each edit revertable alone.

## Don't
- **Install a rule without having named the target behavior** — a prohibition derived from the symptom (« ne fais plus X ») leaves nothing to DO in its place, and gets violated the next session. Name the good user experience first, then write the reflex that produces it.
- **The silent edit** — kaizen APPLIES, but never invisibly: an edit that does not appear in the STATE table, or that lands mixed into another commit, is a defect (the user must be able to see it and revert it alone).
- **Reimplement the audit** — reuse `judge` Mode B; kaizen orchestrates, it doesn't re-derive the lens machinery.
- **Trust a lens's word** — adjudicate; reject a finding that re-flags a deliberate decision or overstates; edit on the REAL file, never a sub-agent's report.
- **Prefer a passive fiche to a WIRED trigger** — loading ≠ applying; a hook + hard rule beats a memory fiche alone.
- **Declare a finding treated without the non-recurrence replay** — « ça ne doit pas se reproduire » is the bar: an edit whose original failing scenario was never replayed against it is "installé, non prouvé", not treated. Restating a rule that already failed once is not an escalation.
- **Report "integrated/done"** without the out-of-model verification (`test-hooks.ps1`) AND `sync-kit.ps1` propagation AND the `kaizen-treated.jsonl` line.

## Engine & reflexes
- Mechanics are CANONICAL in `~/.claude/skills/_engine/ENGINE.md` and in `judge` **Mode B** (behavioral audit). Kaizen ORCHESTRATES them and carries only its delta: target-location, the self-applied integrate step, sync-kit, and the one-commit-per-edit constraint. **On divergence, the engine + judge Mode B win.**
- Cardinal constraint (constitution §19): kaizen APPLIES its own edits — diagnostic → precise edits applied directly, each verified out-of-model and committed on its own. The garde-fou is REVERTABILITY, not an approval wait.
