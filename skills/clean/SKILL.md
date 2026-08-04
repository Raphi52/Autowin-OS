---
name: clean
description: Pre-final cleanup gate between build and judge. Inspect a functionally verified deliverable for residues from failed attempts, debug instrumentation, temporary files, obsolete workarounds, duplication, dead code, orphaned references to a changed/replaced/removed feature (callers, imports, wiring, tests, docs left pointing at the old version), and narrowly justified behavior-preserving refactors; clean only attributable safe items, replay the primary signal and adjacent tests, record evidence in RUN.md, then hand the post-clean state to judge. Use on `$clean`, "nettoie avant de finir", "cherche les artefacts des essais ratés", "faut-il refactorer avant validation", automatically after build/guard succeeds and before the final judge or RUN green, and after any post-judge mutation that invalidates the prior verdict.
---

# Clean — post-build hygiene gate

## Purpose

Make the final judge inspect the state that will actually ship. Remove accidental residue without turning cleanup into an unframed redesign.

Pipeline: `frame → terrain → build → clean → judge`. Keep the RUN open through build and clean. Only `judge` may set `status: green` after auditing the post-clean fingerprint.

## Preconditions

1. Read the active `RUN.md`: `## Besoin`, `## Contraintes`, `## SOP`, `## Journal`, `## Défauts`, the primary `signal:`/`signal-cmd:` or `signal-attestable:`, and every relevant `check:`.
2. Require a fresh functional proof from `build` plus the adjacent guard. A replayable proof must name its exact command. A `signal-attestable` proof must satisfy the canonical evidence contract: artifact fresher than the action; non-empty/non-vacuous output; exit 0 with clean stderr where a command produced it; targeting through a run stamp; actual artifact inspection; and a negative counter-check showing the observation can discriminate failure. Missing or red proof → return to `build`; do not clean a broken state.
3. Capture the current diff/status and identify pre-existing user changes. Never claim, edit, delete, revert, or format unrelated/user-owned work.
4. Keep `status: open` throughout clean, after post-clean verification, and until `judge` passes. Clean never sets green.

## Workflow

### 1. Establish the clean baseline

Re-run the primary signal before editing. Record `unit=clean run=baseline VERIFIED` in `## Journal`. If it fails, stop and route to `build`.

Inventory only the task's touched surface and evidence from failed attempts. Inspect the diff, `## Journal`, temporary outputs, and nearby code for:

- **orphans of a changed/replaced/removed feature** (do this FIRST): whenever the run modified, renamed, replaced, or removed a feature, trace EVERYTHING that was wired to the old version and rewire or remove it — grep the touched scope for every caller/importer, IPC/preload/route wiring, type or interface, config/registration entry, test, and doc/UI string that referenced the old name/shape/path. Each reference must point at the NEW version or be deleted; a half-migrated reference (dangling caller, dead import, stale registration, orphaned test, doc naming a gone feature) is a DEFECT, not residue to leave. If rewiring would change behavior/semantics → record a defect and route to `build`/`frame`, do not silently re-point.
- debug prints, probes, tracing, feature flags, commented-out code, TODOs created by the run;
- backup/temp/generated files accidentally left in the deliverable;
- superseded branches, duplicate checks, workaround layers, unused imports or dead helpers;
- tests weakened, skipped, duplicated, or coupled to an abandoned approach;
- unnecessary complexity introduced by the successful fix.

Do not treat normal build outputs, existing debt, or unfamiliar untracked files as disposable merely because they look untidy.

### 2. Classify before changing

| Class | Action |
|---|---|
| Safe residue | Remove minimally; it is attributable to this run and behavior-neutral. |
| Small cleanup refactor | Allow only when behavior-preserving, bounded to touched code, and covered by the existing signal/tests. |
| Semantic/design refactor | Do not perform; record a defect and return to `frame` or `build`. |
| Ambiguous or user-owned | Preserve; ask only if it blocks closure. |
| No residue | Make no edit; record `CLEAN-NOOP` with the inspected scope and diff fingerprint. |

Refactoring is not a cleanliness aesthetic. Require a concrete defect: duplication caused by the attempts, unreachable path, misleading abstraction, or complexity that materially obstructs maintenance. No defect → no refactor.

### 3. Clean in attributable increments

Apply one classified cleanup at a time with a single writer. After each increment:

1. inspect the focused diff;
2. run the cheapest relevant test;
3. on failure, undo only that cleanup through a targeted edit and record `FAILED`—never use broad reset/checkout;
4. if fixing the failure would change semantics, stop and route to `build`.

Deletion must be explicitly attributable and safe. Ambiguous recursive deletion, production/runtime cleanup, SQL writes, process termination, or removal outside the scoped workspace requires the user's authorization under the applicable safety rules.

### 4. Prove the post-clean state

After the last edit, re-run:

1. the exact primary signal used by `build`; for `signal-attestable`, reproduce a fresh targeted artifact and inspect the artifact rather than accepting the capture command's exit code;
2. the adjacent regression/smoke suite; if no automated adjacent guard exists, record that explicitly and perform the nearest targeted attestable check instead;
3. a final diff/status scan for residue, unrelated changes, debug code, weakened tests, and accidental files.

Insert the baseline and terminal events inside `## Journal` (before the next `##` heading), after existing events and in execution order: build proof → clean baseline → cleanup increments → terminal clean event. Never prepend a terminal event before its baseline, and never append RUN events at end-of-file or under another section. Record one terminal event:

- `unit=clean run=<stamp> CLEAN-VERIFIED diff=<fingerprint> proof=<signal>` when edits were made;
- `unit=clean run=<stamp> CLEAN-NOOP diff=<fingerprint> proof=<signal>` when no edits were needed;
- `unit=clean run=<stamp> FAILED ...` on any unresolved regression.

Use the same deterministic manifest in Git and non-Git workspaces. Run `scripts/fingerprint.py --root <scope-root> --output <manifest.json> --scope <touched-directory>... --absent <removed-artifact>... --ignore <evidence-file>... <additional-touched-files...>`. The canonical resolved root is part of the fingerprint, so redirecting a manifest to another tree must fail. Each `--scope` records the complete recursive product inventory so later files, deletions, and renames are detected; each `--absent` guards a removed residue against resurrection. Keep `RUN.md`, the manifest itself, transcripts, screenshots, and other evidence outside the product scope; when layout makes that impossible, list those exact evidence files with `--ignore` and record every exclusion in the Journal. Never use `--ignore` for product/source files or to hide an unexplained artifact. Never include a RUN that records `diff=` inside its own fingerprint: that is self-referential and can never stabilize. Keep scopes narrow enough to exclude unrelated volatile build outputs. Record the manifest path and SHA-256 fingerprint. The judge replays `scripts/fingerprint.py --check <manifest.json>` and verifies that its fingerprint exactly equals the terminal Journal `diff=` value.

Before claiming the skill itself verified after changing this workflow, preserve at least one fresh-context behavioral run with raw prompt/output, fixture state, before/after diff, an attributable residue removed, an ambiguous or user-owned file preserved, replayed proofs, RUN event, and judge handoff. A narrative simulation alone is not behavioral proof.

### 5. Handoff

On `CLEAN-VERIFIED` or `CLEAN-NOOP`, keep `status: open` and invoke `judge` on the same post-clean fingerprint. Only a passing judge verdict may set `status: green`. Any later product mutation invalidates the clean evidence and judge verdict: reopen the RUN, re-run `clean`, then re-run `judge`.

If the judge returns a defect, route it to `build`; after the fix, `clean` runs again before re-audit.

## Hard stops

- Never broaden scope to clean pre-existing debt.
- Never change behavior, architecture, public APIs, data shape, or user-visible semantics under this skill.
- Never delete an ambiguous file or discard user changes.
- Never accept formatting-only churn across untouched files.
- Never claim clean on text inspection alone: primary signal + adjacent guard are mandatory.
- Never treat `clean` as the final quality verdict; `judge` remains external and final.

## Output

Return: inspected scope; removed/kept/refactor-deferred items with reasons; before/after diff fingerprint; exact tests and results; RUN journal event; handoff to `judge` or blocker.
