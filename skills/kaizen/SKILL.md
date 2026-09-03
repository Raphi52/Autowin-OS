---
name: kaizen
description: >-
  Continuous-improvement loop on Claude's OWN behavior: turn a session (BY DEFAULT the CURRENT one it is
  invoked in) into VERIFIED, SELF-APPLIED EDITS to ANY of its levers — the kit (`skills/**/SKILL.md` ·
  `skills/_engine/ENGINE.md` · `hooks/*.ps1` · `settings.json` · `CLAUDE.md` + `CONSTITUTION.md` mirror · memory)
  AND the Autowin code that injects behavior at runtime (`src/main/chat-pilotage-prompt.ts`,
  `src/main/phase-briefs.ts`, `src/main/constitution.ts`, `src/main/intent-phase-routing.ts`), the TOOLS the agent
  is given and their descriptions (`src/main/commands.ts`), the deterministic guardrails in code
  (`src/main/gates/*.ts`, `src/main/hooks/*.ts`), the repo `.md` docs, and the Brain — full list in § « Tes leviers ».
  ORCHESTRATES, never re-implements the audit: (0) FINISH THE TASK FIRST — when kaizen is invoked while a
  user task is still in flight (« kaizen, et au fait ça marche toujours pas »), the TASK is delivered and
  verified BEFORE the behavioral improvement, then the improvement is done in the SAME pass; kaizen never
  replaces the work it was asked about; (1) LOCATE the target — BY DEFAULT the CURRENT session it is
  invoked in (reconstruct it from its OWN transcript `~/.claude/projects/<project>/<SESSION_ID>.jsonl`, the
  `SESSION_ID` injected each turn by the UserPromptSubmit hook); OR a named PAST session ("kaizen session X /
  the last one I tried to kaizen" → find by first-prompt / topic / a prior `kaizen`-fork); OR a named
  behavior; OR an AUTOWIN conversation (`conversation_read` / `conversation_search` / `retrospective`, never the
  transcripts alone); OR an INJECTED instruction (the app system prompt, phase consignes, output-styles); OR a recurrent telemetry pattern surfaced by the `kaizen-nudge` Stop hook; (2) AUDIT behaviorally with its OWN
  parallel lenses — anchoring/honesty, communication, cost, cross-session state, scope, reversibility, silent
  failure, safety, tool-use, premature stop, model-shared blind spot — each finding 1-2 blind spots with a
  FALSIFIABLE anchor quoted from the transcript + a severity; loop with new lenses until 2 dry rounds; (3) DEFINE, for each blind spot, the TARGET BEHAVIOR — what should have happened for a good USER experience — and derive the rule from THAT, not from the symptom; (4) CONSOLIDATE to ONE root cause + a
  ranked table (blind spot · anchor · target behavior · proposed rule · integration point); (5) STATE the edits it is about to make, in plain words, so they are readable BEFORE and revertable after; then (6) INTEGRATE them itself — no approval wait — preferring
  a WIRED trigger (hook + CLAUDE.md hard rule) over a passive memory fiche (loading ≠ applying — a fiche alone
  was violated twice the same session), VERIFY each edited hook with an out-of-model signal (parse + behavior +
  negative control), then prove NON-RECURRENCE — replay the exact failing situation against the installed
  fix and show it now BLOCKED (« ça ne doit pas se reproduire » : an edit that cannot be shown to stop the
  ORIGINAL failure is not a fix), then run your local Autowin clone's `sync-kit.ps1` (live→package) and log the treated signature to
  `kaizen-treated.jsonl`. Scoring mechanics are CANONICAL in `_engine/ENGINE.md`; kaizen carries the behavioral audit itself plus
  its delta: target-location, the self-applied integrate step, sync-kit, and the one-commit-per-edit constraint.
  Trigger on "kaizen this session", "improve the kit from my recurring failures", "audit
  my habits / workflow / blind spots", "what do I systematically miss", "analyse les defauts dans les
  workflows / les conversations / les comportements / les injections", "audite tout Autowin", OR right after the `kaizen-nudge` hook
  surfaces a recurrent failure pattern. Do NOT use to: audit the QUALITY of a one-off deliverable → `judge`;
  fix a single code defect → `build`; frame a new need → `frame`. Kaizen targets the BEHAVIOR/kit,
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
**ZÉRO QUESTION DE CONFORT (cardinal, mesuré le 2026-09-02 : « kaizen me pose plus de questions pour rien »).** Au moment où une question te vient — quelle session, quelle cible, quelle option de règle, « je peux éditer ? » — tu ne la poses PAS : tu prends l'hypothèse la plus probable, tu l'ÉCRIS en une ligne dans ta réponse, et tu continues. Une édition de kaizen est réversible d'un `git revert` : c'est ÇA le garde-fou, pas l'accord préalable. `ask` n'est légitime que si deux options mènent à des produits VRAIMENT opposés, qu'aucun élément du fil ne tranche, et qu'un choix par défaut serait coûteux à défaire. Sinon : décide, annonce, avance.

**L'audit ne remplace jamais le travail** : si une tâche utilisateur est encore en cours au moment de l'invocation, elle est TERMINÉE d'abord (livrée + vérifiée), l'amélioration comportementale vient ENSUITE, dans la même passe.

## Tes leviers — ce que kaizen a le DROIT d'éditer
Un défaut de comportement n'a pas toujours sa cause dans `skills/`. Avant de choisir un fichier, balaye
cette liste : la cause vit dans UN de ces sept leviers, et éditer le mauvais levier ne corrige rien.
Chemins relatifs au dépôt Autowin (vérifiés le 2026-09-02).

| # | levier | où | quand c'est LUI |
|---|---|---|---|
| 1 | **Skills** | `skills/<nom>/SKILL.md` (19 skills au 2026-09-03, compte relu : `find skills -name SKILL.md`), mécanique canonique dans `skills/_engine/ENGINE.md`, gabarit `skills/_engine/RUN-template.md` | la procédure elle-même est fausse/incomplète. Nouvelle skill → `graft` |
| 2 | **Prompts injectés au runtime (code Autowin)** | `src/main/chat-pilotage-prompt.ts` (prompt du cockpit), `src/main/phase-briefs.ts` (consignes de phase), `src/main/constitution.ts`, `src/main/intent-phase-routing.ts` (routage), `src/main/behaviour-composition.ts` et les six sources qu'il compose (`response-style.ts`, `pipeline-discipline.ts`, `context-files.ts`, `roles.ts`, `task-regime.ts`, `topology.ts`), `src/main/autowin-kaizen-context.ts` (ce que kaizen reçoit lui-même) | le comportement est FAUX parce que l'injection le demande. L'injection est lue en DERNIER et gagne : aucune édition de `CLAUDE.md` ne la corrigera |
| 3 | **Outils de l'agent** | `src/main/commands.ts` (déclaration ET texte de description de chaque outil) + les modules dédiés (`edit-file-command.ts`, `brain-query-command.ts`, …) | l'agent n'a pas le levier, ou la description de l'outil l'induit en erreur — un texte d'outil EST une injection de comportement |
| 4 | **Garde-fous déterministes** | `src/main/gates/*.ts` (`stopgate.ts`, `hooks.ts`), `src/main/hooks/*.ts` (`cablage-garde.ts`, `verify-replay-hook.ts`) + les hooks PowerShell du kit et leur câblage `settings.json` | il faut du CODE qui refuse tout seul — l'enforcement le plus fort, à préférer à une règle en prose |
| 5 | **Fichiers de comportement hors dépôt** | `%USERPROFILE%\.claude\settings.json`, `CLAUDE.md` global / projet, `CONSTITUTION.md`, fiches `memory/` | réflexe global ou local-machine. Inventorie-les avec le scanner de comportements (`src/main/behaviour-files.ts` / vue Comportements) au lieu de deviner un chemin |
| 6 | **Documentation `.md` du dépôt** | `README.md`, `ONBOARDING.md`, `RUN.md`, `docs/*.md` | le savoir humain est faux/périmé, ou une install/étape manquante a causé le défaut. N'installe JAMAIS un réflexe ici : un `.md` de doc n'est pas chargé par l'agent |
| 7 | **Brain (savoir partagé)** | dépôt d'un candidat via `remember`, relecture via `brain_query`, côté code `src/main/brain-*.ts` (`brain-remember.ts`, `brain-retrieval.ts`, `brain-inbox.ts`, `brain-corpus-scope.ts`) | c'est un FAIT durable qui manquait, pas un comportement. Un fait au Brain part en candidat et n'agit pas tout seul : il ne remplace pas une règle câblée |

**Règles de levier.**
- **Levier ≠ liste de courses** : un défaut = le levier de sa CAUSE, pas les sept. Un correctif posé dans une skill alors que l'injection le contredit est un pansement.
- **Édition de CODE (leviers 2, 3, 4, 7-code)** : c'est un changement de projet, pas une édition de kit → `edit_file` sur le fichier réel, puis `verify` sur le test colocalisé (`src/main/<module>.test.ts`), et un commit dédié. Pas de propagation `sync-kit.ps1` (elle ne concerne que le kit vivant, leviers 1 et 5).
- **Édition de KIT (leviers 1, 5)** : `sync-kit.ps1` (live→package) après coup, `test-hooks.ps1` pour tout hook touché, et un nouveau fichier doit être AJOUTÉ au manifeste sync-kit.
- **Ordre d'enforcement, du plus faible au plus fort** : doc `.md` < fait Brain < fiche mémoire < règle dure (`CLAUDE.md`/skill) < prompt injecté (code) < garde-fou déterministe (hook/gate). **Le niveau se choisit sur la CAUSE, dès la PREMIÈRE passe — jamais par défaut sur le plus faible.** Si la cause est une injection qui dit le contraire → levier 2 (le prompt injecté), pas une phrase de plus dans une skill que l'injection écrasera. Si la cause est un défaut REJOUABLE par du code (un ordre d'appels, une preuve manquante, un fichier interdit) → levier 4, le garde-fou : une règle en prose sur un défaut mécanisable est une rustine, même bien écrite. La prose n'est le bon niveau que quand le défaut relève du JUGEMENT (quoi dire, quand demander, comment formuler) — dis-le alors explicitement. **Attendre une récidive pour monter d'un niveau est INTERDIT** : c'est faire payer la rechute à l'utilisateur pour un diagnostic qu'on pouvait faire du premier coup. Un rejeu qui montre le défaut persistant n'est donc pas le déclencheur de la montée, c'est la PREUVE qu'on avait mal choisi — et on ne réécrit jamais la même règle plus fort.

## Procedure
0. **FINISH THE TASK FIRST (CARDINAL — ordre non négociable).** Kaizen arrive presque toujours PENDANT un travail : l'utilisateur signale un défaut de comportement sur la tâche qu'il est en train de faire faire. Cette tâche reste due. **Ordre imposé : (a) terminer la tâche demandée jusqu'à son résultat vérifié hors-modèle, (b) PUIS mener l'audit comportemental et installer les éditions, dans la MÊME passe.** Partir directement à l'audit — et rendre la main avec un kit amélioré mais la demande initiale non livrée — est un ÉCHEC, pas une priorisation : l'utilisateur perd son livrable ET doit redemander.
   - **Cas où il n'y a rien à finir** : l'invocation porte sur une session PASSÉE déjà close, ou sur un comportement/telemetry sans tâche en cours → passer directement à l'étape 1, en le disant en une ligne (« aucune tâche en cours — audit direct »).
   - **Si la tâche en cours est elle-même bloquée** : nommer le blocage, puis auditer — un blocage ne se contourne pas en changeant de sujet pour l'audit.
   - **Ne pas fusionner les deux** : la correction de la tâche et l'édition du kit sont des commits SÉPARÉS (l'un corrige un artefact, l'autre change un comportement futur ; les mélanger rend le revert impossible).
   - **Clôture** : le compte-rendu porte les DEUX résultats — ce qui a été livré pour la tâche, puis ce qui a été installé pour le comportement. Un seul des deux = travail incomplet.
1. **LOCATE the target.** **DEFAULT = the CURRENT session** — the conversation `/kaizen` is invoked in. Read its OWN transcript on disk: `~/.claude/projects/<project>/<SESSION_ID>.jsonl` (+ `subagents/`, `tool-results/`), where `<SESSION_ID>` is the id injected each turn by the UserPromptSubmit hook (also visible in any `SESSION_ID=…` system reminder). The transcript is written as the session runs, so it's available mid-session — point the audit lenses at THAT file. No need to ask which session; "kaizen" alone = kaizen THIS one. **NEVER ask which target** — deduce it from the invocation, state the deduction in ONE line (« j'audite cette conversation — dis-moi si tu visais autre chose ») and proceed. Other targets, only when the user NAMES them:
   - **a named PAST session** — "kaizen session X / the last one I tried to kaizen". Find it by first user prompt, dominant topic, or a prior `kaizen`/`kaizen-past-session` fork. **Cite the evidence** (first prompt + a topic line) in one line and audit immediately — do not wait for a confirmation. Only when two candidate sessions match the description equally well, and only then, ask which one. Given a disambiguator (a remembered first prompt, a topic), grep all `projects/*/*.jsonl` for it.
   - **a named behavior / habit / skill-set** — pass straight to the behavioral lenses of step 2.
   - **an AUTOWIN conversation, or the app's whole history** — the cockpit's conversations are NOT in `~/.claude/projects/*.jsonl`: a transcript holds one agent session, a conversation holds what the USER actually asked, corrected and refused. Read them with the app's own capabilities — `conversation_read` for a named id, `conversation_search` to find the fil from a phrase, `retrospective` for a turn's causal events (tools called, refusals, verdicts, cost) and its RUN.md. "Kaizen tout Autowin" = a NAMED or SEARCHED sample, never all of them implicitly (981 conversations = ruinous). A defect the user CORRECTED lives here and nowhere else.
   - **a recurrent telemetry pattern** — the `kaizen-nudge` Stop hook fired on `gate-counters.jsonl` (anti-flaky / fix-gate / revert recurring ≥ threshold). The pattern IS the target; audit whether it's a real habit or inflated noise (the detector itself can be the defect).
2. **AUDIT — behavioral lenses, fanned out in parallel.** This machinery used to live in `judge`
   as "Mode B" and was invoked from here. It was a DOUBLON: judge exists to grade a DELIVERABLE,
   kaizen to improve a BEHAVIOR, and both carried the same lens list under OPPOSITE closing rules —
   judge forbade writing anything, kaizen applies its edits. Removed from judge on 2026-09-01, its
   substance moved HERE. Judge keeps quality audits; a behavioral target routes to kaizen.

   **Parameterize the target first** — pick, WITHOUT asking, between (i) Claude's behavior/workflow
   (the DEFAULT: `/kaizen` is a behavioral loop), (ii) a codebase, (iii) a skill set. Deduce it from
   what the user just complained about; announce the pick in one line so it can be corrected. Do NOT
   assume "the repo" — a wrong target wastes the whole fan-out, but a question asked for nothing
   wastes a turn EVERY time.

   **Preload "already covered"** (this replaces ledger round 1): the machine's global
   `%USERPROFILE%\.claude\CLAUDE.md`, any project `CLAUDE.md`, the auto-memory index if present,
   the installed skills. Inject that into EVERY lens so none re-flags the known.

   **Fan out 6-9 lenses IN PARALLEL** (one message), model-diverse to decorrelate. Each returns 1-2
   NEW blind spots — high-impact, each with a **falsifiable anchor** quoted from the transcript,
   the repo or the scripts (never armchair reasoning), plus a severity, a proposed rule and an
   integration point. The lens list:

   - **Anchoring & honesty** — a claim made without the artifact that would settle it.
   - **Communication & user attention** — what the user had to re-read, re-type or chase.
   - **Cost & efficiency** — turns and tokens spent against what the livrable actually needed.
   - **State / resume / capitalization** — what was re-derived because nothing carried it forward.
   - **Scope & over-engineering** — work done that nobody asked for.
   - **Reversibility & checkpoint** — a change that could not be undone in one command.
   - **Error & silent failure** — a failure swallowed instead of surfaced.
   - **Safety / secrets / PII** — anything sensitive that travelled where it should not.
   - **Tool-use & idempotence** — a tool re-run blindly, or one whose replay is not safe.
   - **Premature stop & iteration** — the hand given back before the verified result.
   - **Model-shared blind spot** — assumptions the WHOLE panel takes for granted (same-model
     ceiling). This lens is the one a single specialist cannot supply: keep it in every round.

   **Convergence**: re-loop with NEW lenses until a round comes back dry; **2 dry rounds = stop,
   cap 3 rounds**.

   **Same-model honesty caveat (MANDATORY)**: this is a SELF-audit — producer = judge is not proof.
   Mark the findings **non-conclusive** (« correlated same-model angle — blind spot not excluded »)
   and surface that caveat in the report. It does not block the integrate step: the garde-fou there
   is revertability (one commit per edit), not an illusion of independence.

   **Two families of lenses, not one.** The lenses above are BEHAVIORAL and they read a transcript. A defect of the SYSTEM does not always show there, so fan out a second family when the target carries RUNs or conversations — **WORKFLOW/TOPOLOGY lenses**, which read `RUN.md` and the causal trace rather than prose:
   - **routing** — the phase actually played versus the one the demand called for (a `build` on an unframed need, a `judge` while work remained).
   - **fan-out sizing** — agents spent versus the regime bracket; a parallel round that returned nothing new.
   - **gate arming** — a RUN closed `green` with an unticked DoD, a `signal-cmd` never replayed, `gate: off` or `disposable` on work that needed a net.
   - **loop economics** — judge→build iterations, cost per turn, a re-run of something already tried (the retrospective shows it).
   Each keeps the same contract: a falsifiable anchor (the RUN path + the line), a severity, a proposed rule, an integration point.

3. **DEFINE THE RIGHT BEHAVIOR (UX target) — before proposing any rule.** A defect names what happened; it does NOT say what SHOULD have happened. For each consolidated blind spot, write the **target behavior in one sentence, from the USER's experience**: at that exact moment, what would have been the good response/action for the person in front of the screen (what they get, when, in what form, what they are spared) — and what makes it good (less friction, no wasted turn, nothing to re-type, no false claim, the decision left where it belongs). Derive the rule FROM that target, never straight from the defect: a rule written against a symptom produces a prohibition (« ne fais plus X ») that leaves the agent with no behavior to run; a rule written from the target produces a REFLEX (« au moment où X → fais Y »). If two plausible target behaviors compete (answer directly vs. offer a choice, act vs. ask), name both, pick one with its reason, and record the discarded one — a rule installed on an unarbitrated target is a guess. When the target touches something the user alone can settle (a taste, a trade-off between speed and control), pick the option that costs the user the LEAST friction, install it, and say in one line what was picked and what the alternative was — the edit is revertable, so a question is only worth its turn when the two options lead to genuinely opposite products and nothing in the fil arbitrates them. The non-recurrence replay (step 6) then tests the TARGET behavior, not merely the absence of the defect.

4. **CONSOLIDATE.** Dedup across lenses; surface the ONE root cause (what a single specialist would miss). **A root cause MUST be LOCALISED to name it a cause : `fichier:ligne` (or the exact quoted sentence) of the artifact that PRODUCES the behavior — the injected prompt that says the opposite, the tool that is missing or misdescribed, the rule that fires only after a recurrence, the gate that does not exist. A cause phrased about the agent's mind — « l'agent n'a pas pensé à X », « il a manqué de rigueur », « le contexte était trop long » — is the SYMPTOM restated, not a cause : it points at no artifact, so no edit can falsify it. If the audit cannot localise the cause, say so and STOP before proposing a rule** — an unlocalised rule is a band-aid whatever its wording, and the constitution's transverse anti-pansement clause forbids it. Then the ranked table: `blind spot · anchor · severity · proposed rule · integration point (hook / CLAUDE.md hard-rule / memory / just-known) · scope (global+mirror / local-only / project)`. **Adjudicate** the lenses — reject a finding that re-flags a deliberate decision or overstates (you verify the real artifact, never a lens's word). State honest caveats (same-AI correlation — correlated blind spots not independently ruled out).
5. **STATE the edits — readable before, revertable after** (CARDINAL). Present the table in PLAIN words: what changes, in which file, why there. This is a DECLARATION, not a request for permission. It exists so the user can read the delta and revert it, not so kaizen can wait. A producer=judge "100" is not proof — which is why every edit carries an out-of-model verification and its OWN commit (lived: "intrinsic" concluded wrongly 3×; a dedicated commit makes that revertable in one command).
6. **INTEGRATE — edit the kit to change FUTURE behavior, immediately.** The deliverable IS the edit. Before picking a file, run an explicit **placement analysis** per finding — REASON it, don’t look it up, and surface the "why here" in the STATE table. Three axes: **SCOPE** (below), **ENFORCEMENT** (wired hook+rule > recall fiche — see bullets), **FOLD vs NEW** (extend/retire before adding — see bullets).
   - **SCOPE decides the file AND whether to mirror** — the most-missed axis:
     - **global** (every machine/project) → `~/.claude/CLAUDE.md` **+ mirror `CONSTITUTION.md`**.
     - **local** (THIS machine only — RIG hooks, paths, project gates) → the **« Local »** section of `~/.claude/CLAUDE.md`, **NOT mirrored** (a machine-specific fact in the shared `CONSTITUTION.md` pollutes the company kit).
     - **project** (one RIG sub-project) → that project's `CLAUDE.md` (e.g. `<project-root>\CLAUDE.md`), never the global constitution.

   Then map the kind of fix to the file (the **target-map**), at the scope decided above — la liste COMPLÈTE des cibles possibles est le tableau § « Tes leviers » ; balaye-le avant de te rabattre sur `skills/` ou `CLAUDE.md` :
   - **a triggered reflex / hard rule** → `CLAUDE.md` (+ `CONSTITUTION.md` **only if global**) — the reflexes loaded every session.
   - **an automatic, deterministic guardrail** → a **hook** (`hooks/*.ps1`) + its **wiring in `settings.json`** (and the package `hooks/settings-snippet.json`). This is the STRONGEST fix — code that fires on its own.
   - **a workflow/skill behavior** → the relevant `skills/<x>/SKILL.md` (or a new skill).
   - **an INJECTED instruction — the app's own prompting, not the kit's** → the text Autowin injects at runtime: the cockpit's system prompt, the per-phase consignes, `output-styles/*.md`, the replayed reminders and retrieved-knowledge blocks. This is a REAL and frequently-missed target: a behavior can be wrong because the injection says so, and no amount of editing `CLAUDE.md` will fix it — the injection is read LAST and wins. Anchor the finding on the injected TEXT quoted verbatim, locate its emitter in the app source (`find_in_files` on the quoted phrase), and treat a fix there as a code change, subject to the project's own signal — not a kit edit.
   - **a recall-only nuance** → a `memory/` fiche + the `MEMORY.md` index.
   - **a missing or misleading TOOL** → `src/main/commands.ts` (levier 3) : la déclaration de l'outil ou son TEXTE de description. Un outil que l'agent croit absent, ou décrit de travers, produit un défaut que nulle règle ne rattrape.
   - **a durable FACT that was missing** → le Brain via `remember` (levier 7), jamais un réflexe : un fait n'agit pas tout seul, il part en candidat.
   - **a wrong or stale HUMAN doc** → `README.md` / `ONBOARDING.md` / `docs/*.md` (levier 6) — documentation seulement : n'y installe aucun réflexe, l'agent ne les charge pas.

   Then:
   - **Prefer a WIRED trigger** (a hook + a CLAUDE.md/CONSTITUTION hard rule) over a passive memory fiche — loading ≠ applying (a fresh fiche was violated twice the same session). Memory fiche = reinforcement, not the primary enforcement.
   - **Edit on the REAL file** (read it first — never edit on a sub-agent's report), surgically, on what is NAMED. Don't redesign deliberate, hardened mechanisms in passing (that's a blind-fix — report it in the closing table as a design point, without asking anything).
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

**Done** — recap in plain words: **d'abord le résultat de la TÂCHE terminée (étape 0) avec sa preuve**, puis root cause, what was integrated + where, what was VERIFIED (the out-of-model signal), **the non-recurrence replay per edit** (situation rejouée → résultat: bloqué / corrigé / non rejoué), caveats. **Never report "integrated/done"** without the verification artifact. The net is the commit log: each edit revertable alone.

**Closing condition — EXERCISE THE CHANGED PATH IN AUTOWIN OS ITSELF.** A kaizen is not done when the files are edited: it is done when the modified behavior has been RUN in the app (invoke the touched skill/command in a real conversation, or trigger the modified injection/hook through the app), and the observed result is reported here in one line (`exercised: <what was run in the app> → <what was observed>`). If it truly cannot be exercised — the app cannot be driven from this run, the path needs a human action you don't have — NAME the impediment and mark the result `non exercé`, never `done`. Motive, measured on conv-105: the task's own edits were committed and the closing control still refused the run — « aucun /kaizen réel n'a été lancé » — because nothing had been tried inside Autowin OS.

## Don't
- **Abandonner la tâche pour faire l'audit** — kaizen invoqué au milieu d'un travail ne remplace pas ce travail : la tâche est finie et vérifiée d'abord, l'amélioration comportementale ensuite, dans la même passe. Rendre un kit amélioré et un livrable manquant est un échec.
- **Install a rule without having named the target behavior** — a prohibition derived from the symptom (« ne fais plus X ») leaves nothing to DO in its place, and gets violated the next session. Name the good user experience first, then write the reflex that produces it.
- **The silent edit** — kaizen APPLIES, but never invisibly: an edit that does not appear in the STATE table, or that lands mixed into another commit, is a defect (the user must be able to see it and revert it alone).
- **Improvise a parallel lens list per session** — the list in step 2 IS the machinery; extend it explicitly, and say so, rather than re-deriving one each time.
- **Trust a lens's word** — adjudicate; reject a finding that re-flags a deliberate decision or overstates; edit on the REAL file, never a sub-agent's report.
- **Prefer a passive fiche to a WIRED trigger** — loading ≠ applying; a hook + hard rule beats a memory fiche alone.
- **Declare a finding treated without the non-recurrence replay** — « ça ne doit pas se reproduire » is the bar: an edit whose original failing scenario was never replayed against it is "installé, non prouvé", not treated. Restating a rule that already failed once is not an escalation.
- **Report "integrated/done"** without the out-of-model verification (`test-hooks.ps1`) AND `sync-kit.ps1` propagation AND the `kaizen-treated.jsonl` line AND the real exercise of the changed path INSIDE Autowin OS (conv-105: edits committed, closing control refused — « aucun /kaizen réel n'a été lancé »). Files edited ≠ behavior exercised.

## Engine & reflexes
- Scoring and loop mechanics are CANONICAL in `~/.claude/skills/_engine/ENGINE.md`. Kaizen now carries the BEHAVIORAL audit itself (step 2 — absorbed from judge on 2026-09-01) plus its own delta: target-location, the self-applied integrate step, sync-kit, and the one-commit-per-edit constraint. **On divergence with the engine, the engine wins.**
- Cardinal constraint (constitution §19): kaizen APPLIES its own edits — diagnostic → precise edits applied directly, each verified out-of-model and committed on its own. The garde-fou is REVERTABILITY, not an approval wait.

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
