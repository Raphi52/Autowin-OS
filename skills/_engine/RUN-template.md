<!-- RUN-template.md — copy this file to ~\.claude\runs\<session_id>\<sujet>-workspace\RUN.md
     (<session_id> = injected each turn by the UserPromptSubmit hook; ONE folder per session; Stop-gate
     v3.2 enforces ONLY the runs of its own session). Fallback: flat path if no session_id.
     Full convention: _engine/ENGINE.md ch.3.
     The Stop hook reads the header: open/red block end-of-turn; green is REPLAYED, not trusted at face value. -->
status: open
session: <session_id>       <!-- scopes the run to this session (otherwise the <session_id>\ location is authoritative) -->
regime: standard            <!-- disposable | standard | critical — the effort dial -->
signal: <the OUT-OF-MODEL artifact that will prove green — e.g. "test-x.ps1 exit 0", "capture read", "SQL query n>0">
signal-cmd: <optional but powerful — IDEMPOTENT command the gate will REPLAY via cmd /c; whitelisted prefixes:
  dotnet test | dotnet build | cmd /c | powershell [-NoProfile] -File | pwsh [-NoProfile] -File —
  QUOTE any path containing spaces, and run it yourself once before declaring it>
signal-attestable: <optional — non-replayable out-of-model proof (e.g. "capture read + run-stamp", "SQL query
  n>0 read"); in CRITICAL regime, satisfies the proof requirement when there is neither signal-cmd nor check:>
gate: on                    <!-- on (default) | off — opt-out for a throwaway run: the Stop hook skips the ENTIRE gate on a `gate: off` line (a trailing `<!-- comment -->` is OK) in the first 14 lines (cf. stop-gate.ps1) -->

## Besoin
**Deep-why** : <the real problem, not the solution requested>
**Scope IN** : <what is covered> / **Scope OUT** : <what is not, and why>
**Critere de succes (DoD cochable)** : les conditions de SORTIE, chacune verifiable + sa PREUVE — le judge la coche item par item ; une case a contenu reel NON cochee = item non tenu -> le **stop-gate BLOQUE le green** (deterministe, hors-modele) ; la PREUVE derriere une case cochee -> verifiee par **judge + humain** (le gate ne lit pas la substance). NE PAS recopier un signal/check : y POINTER. (disposable : une phrase suffit ; standard/critical : items, chacun avec une VRAIE preuve — pas de prose generique.) **Les `- [ ]` sous `## Besoin` sont RESERVEES a la DoD** ; risques / angles-morts / hypotheses en PROSE ou puces `-`, JAMAIS `- [ ]` (une case non-DoD bloquerait a raison comme condition non tenue ; le gate ne ferme le scope DoD que sur un heading `##` de niveau 2, pas sur `###`).
  - [ ] <condition de sortie 1> (preuve: <artefact / "cf. signal-cmd" / "cf. check:" / prose falsifiable>)
  - [ ] <condition de sortie 2> (preuve: ...)
**Decisions deliberees** : <deliberate choices the review should not re-flag>
**Hypotheses annoncees** : <"I am assuming X (fact: ...) — correct me">

## Contraintes
<!-- frame writes solution bounds: platform/policy/dependencies/budget/forbidden actions.
     Each constraint is HARD or SOFT, names its source, and states the consequence if violated. Do not duplicate Scope OUT. -->
- [HARD|SOFT] <constraint> (source: <fact / user / policy>; consequence: <what breaks or must stop>)

## Options
<!-- if an approach choice is ENGAGED: >=3 GENUINELY distinct scored options + Décision: line
     (the gate checks at closure; strawman options = a defect the judge will flag) -->
- Option A — <desc> score: NN
- Option B — <desc> score: NN
- Option C — <desc> score: NN
Décision: <which one and why>

## SOP
<!-- terrain writes ONLY the task-specific operating procedure: action -> command/tool -> expected signal ->
     fallback/stop condition. Reference ENGINE Ch.4 for the generic build loop; do not copy it here. -->
1. <action> -> <command/tool> -> <expected out-of-model signal> -> <fallback or stop condition>

## Journal
<!-- append-only : [ts] unit=<id> run=<stamp> VERIFIED|FAILED|FLAKY|CLAIM|PROOF|USER-OK -->

## Défauts
<!-- judge ledger: [severity, status] description — never erased, resolved or accepted-with-reason -->

## Reprise
Goal:
Hypothesis:
Tried:
Next:
Blockers:

## Cicatrices
<!-- lessons from the run (volatile -> treat as HYPOTHESIS); promote to check: or memory when durable (ENGINE ch.3) -->

## Checks
<!-- lessons promoted to code, EXECUTED by the gate at every closure: check: <command exit!=0 = blocks> -->
