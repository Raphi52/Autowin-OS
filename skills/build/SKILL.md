---
name: build
description: >-
  The PRODUCER's named loop (frame → terrain → build → clean → judge): resolve a DEFECT into a functionally VERIFIED state.
  Invoked by `judge` (which sends prioritized defects back) AND by the user directly with a raw bug.
  Trigger on "fix the bug / make it green / the test fails repair it / apply the judge's findings / it's still broken".
  Do NOT use to: AUDIT a deliverable → `judge`; decide WHAT to build → `frame`; prepare the harness → `terrain`.
---

# build — seven reflexes, defect → verified green

1. **THE MOMENT a defect arrives → REPRODUCE IT RED FIRST.** Run the stated criterion (test, command,
   exit code) before touching anything and paste its red output. A fix on an unreproduced bug repairs a
   maybe-bug. No red → the defect is not localized yet, keep hunting; do not edit.
2. **THE MOMENT the red is in hand → LOOK FOR THE PRECEDENT BEFORE WRITING ANYTHING.** Grep the repo
   for a defect of the SAME FAMILY already solved, and COPY ITS SHAPE — its guards, its naming, its
   test. Concrete example: a scope that must be derived for a new file family already exists for
   stylesheets in `src/main/verify-command.ts` (`EXTENSIONS_DE_STYLE`, `porteeDUneEdition`, and the
   blind-spot guard `VERIFY_STYLE_ANGLE_MORT`); re-inventing it produces a second, weaker mechanism.
   No precedent found after two greps → say so in one line and continue.
3. **THE MOMENT the precedent is in hand → LOCALIZE THE LINE THAT ACTUALLY RUNS.** Grep the visible symptom
   (the string, the assertion message), open the ONE file it names, and stop reading there. Reading the
   tree "for context" is the measured waste, not diligence.
4. **THE MOMENT the cause is named → FIX THAT CAUSE, MINIMALLY.** Only the named cause. No opportunistic
   refactor, no rename, no "while I'm here". A guard that routes AROUND the defect, a swallowed error, a
   loosened assertion, a widened timeout = FALSE GREEN → refuse it, or label it "rustine — real cause: X".
5. **THE MOMENT you would say "done" → RE-RUN THE SAME CRITERION and read its exit code.** Out-of-model
   artifact or it did not happen: test red→green, exit code, screenshot READ, query. Never self-declared text.
6. **THE MOMENT the re-run is still red → CHANGE APPROACH, do not repeat.** Two identical attempts are one
   attempt. Exhaust 2-3 DISTINCT approaches per sub-goal before interrupting the human. A missing file,
   fixture or tool is BUILT by you when it is safe, bounded and reversible — it is not requested.
7. **THE MOMENT you are tempted to hand back early → DON'T.** A status report, "should I continue?", a plan
   without execution costs the user a full turn and produces nothing (measured: 23.54 $ of 156.51 $ spent on
   "reprend" turns, 2026-09-02). Carry it to verified green in THIS pass, or name the precise blocker. Then
   loop back to `judge`: build fixes, build NEVER signs its own quality verdict.
