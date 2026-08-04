---
name: terrain
description: >-
  Step 2 of the pipeline (frame→[explore]→terrain→build→clean→judge): from a framed need with a settled approach,
  PREPARE THE SELF-CORRECTION TERRAIN before launching autonomous work — (1) OBSERVABILITY (how Claude gets its
  screenshots + logs to loop on its own real output), (2) the ENVIRONMENT / tech, (3) the resume STATE — and
  BUILD the missing harness if absent; PLUS the loop spec the executor needs (per-increment signal, decompose
  map, cost caps, green-checkpoint, need→loop→judge wiring, /goal driver arming at handoff). The loop's EXECUTION mechanics (decompose into
  signal-bearing increments, red-first then green, parallel dispatch, anti-regression cadence, systematic
  debugging, checkpoint/rollback) are OWNED BY THE ENGINE — Chapter 4 BUILD — consulted by the executor
  during the build phase; no third-party skill is involved. Use when you want to
  launch autonomous/iterative work and must first PREPARE how Claude will loop — especially on a project/PC
  where this harness does not exist yet. Trigger on "prepare the workflow/terrain", "how will Claude loop / get its screenshots-logs", "set up self-correction / the autonomous work environment", "run Claude solo to completion". Chains after `frame` (need scoped, approach settled) and before the build,
  then `clean`, then `judge`. Do NOT use to frame the need or pick the approach (→ `frame`), to execute the loop mechanics
  themselves — decompose/execute a plan, TDD, test-driven increments (→ ENGINE Ch.4 BUILD, the executor's
  manual; no skill fires during the build) — nor to
  judge the finished deliverable (→ `judge`).
---

# terrain — prepare the self-correction terrain (step 2)

## Purpose
**Make the ground ready for Claude to work AUTONOMOUSLY and self-correct — BEFORE the loop starts.** A framed
need with a settled approach isn't enough to run solo: Claude must be able to SEE its own real output
(screenshots + logs), run in the right environment, and resume after interruption. Terrain installs that
observability + harness + resume-state (building what's missing) so the autonomous loop catches its own errors
instead of running blind.

## Procedure

1. **Read the RUN.md first** — header `regime:`, `## Besoin`, and the `Décision:` line of `## Options`. The chosen approach pilots the harness: a CLI approach and a GUI approach demand different observability; mounting the wrong one makes the executor blind. You spec ONLY the signal↔harness bridge specific to this task; the generic loop mechanics are **owned by ENGINE Ch.4 — BUILD**. Never re-specify those.

2. **Ex-ante devis (one line, before locking regime)**: expected turns × fan-out width × judge passes → rough token/time range. The regime dial is the human's; never set it blind without a devis. In doubt **lower + flag**, note the correction in `## Besoin`. *disposable* = minimal terrain to verify one shot (skip skill packaging); *standard* = full terrain + the engine loop (Ch.4); *critical* = full terrain + ≥1 out-of-model source (see `judge`).

3. **Detect the three prerequisites in parallel** — read-only, independent → fan-out 3 explorers in ONE message. Then mount what is missing in serialized, idempotent, reversible steps — **one builder for the build, never two concurrent**. Confirm before any heavy or irreversible action. A loop cannot self-correct without all three:

   - 🔭 **OBSERVABILITY — the feedback the loop reads.** *How does the executor see the REAL effect of its work?* By tech: **UI** → post-action screenshot READ by Claude (PrintWindow → PNG on disk; hunt an existing capture script first). **Capture-AND-drive channels for a UI, when connected this session** (route via the GUI-control reflex — desktop MCP / browser / local web app / UIA script): a **desktop-control MCP** (e.g. windows-mcp: `Snapshot` = UIA tree + screenshot + coords, then `Click`/`Type`) gives BOTH the observation and the action in one loop; a **browser** target → the Chrome tools (`read_page` + screenshot as signal, `navigate`/`computer` to drive); a **local web app** → Preview (`preview_start` + screenshot/inspect); an **opaque / no-steal-focus** app → a UIA/FlaUI/PostMessage script. Prefer the structural (UIA tree) signal over pixel-vision when the app exposes one. **CLI / service / batch** → logs + exit code; **code / lib** → tests fail→pass (falsifiable); **data / SQL** → verification query on produced state; **doc / plan / skill** → walk ONE concrete case end to end. Two non-negotiables: **ensure-fresh** — never pilot a stale binary, check artifact timestamp and rebuild if older than source (a stale-binary incident has cost days); and a **signal that AUTO-PROVES** (ENGINE Ch.2): fresh (artifact newer than the action), non-vacuous (N>0 tests / non-empty log / exit==0 + clean stderr), run-stamp-bound to THIS run, with a negative control (does the check fail when it should?).

   - 🖥️ **ENVIRONMENT / TECH.** Stack, build/run/test commands, where logs and artifacts physically live, what is authoritative. If `frame` already recorded recon in the RUN.md — read it, don't re-scan; fill only workflow-specific gaps (feedback source, ensure-fresh gesture).

   - 📋 **RESUME STATE = RUN.md itself.** Open it `status: open` (the Stop gate then takes over closure — never set green to satisfy it). The live state lives in `## Journal` (append-only events) and `## Reprise` (Goal / Hypothesis / Tried / Next / Blockers + turn counters) — this is the 30-second resume after compaction. Fill the header `signal:` and, where possible, an **IDEMPOTENT whitelisted `signal-cmd:`** — the gate will REPLAY it rather than believe your green.

4. **Prerequisite deliverable gate + `## SOP`**: confirm "feedback via X, env Y, state via RUN.md" is explicit and artifacts are mounted. Then write task-specific `## SOP` as `action → command/tool → expected signal → fallback/stop`; reference ENGINE Ch.4, never duplicate it.

5. **Per-increment signal** = a real-observation artifact from the harness above (screenshot read, log+exit, green test, query result) — **never self-judged text**. This is the bridge that makes the output judge-able. **It must reproduce the USER's symptom AS THEY LIVE IT** (their scenario, their view, their success criterion) — not a technical proxy adjacent to it. If ≥2 causal steps separate the signal from the terminal effect the user observes, it is NOT a closure signal (scar: "workers dispatched" passed green while the user saw failed/black tiles — the proxy was clean and entirely beside the point).

6. **Test pyramid**: pure logic in unit tests run in the HOT loop (seconds); e2e/UI/integration at the gate.

7. **Decomposition map** for parallelism (only when increments are genuinely parallel; a single deliverable stays a simple flow): annotate each `{independent | depends-on-X}` + its signal; mark **shared resources** (build / DB / bench / port) and prescribe **isolation** (worktree/scratch per increment) — a single builder only. A serial dependency map makes everything downstream serial; maximize the independent ratio deliberately.

8. **Cost caps**: global 12 turns (adjustable) + progress floor **N=3** (3 turns with no failed→done and no signal turning green → hard-stop). Plus anti-destruction (irreversible op → stop + confirm/backup).

9. **Green checkpoint + rollback to last green**: snapshot a NAMED green BEFORE each increment (commit/tag in a **disposable worktree** — abandoning = dropping the branch). On a CONFIRMED regression, REVERT to the last green and re-attack with a different hypothesis — never stack fixes on a broken state. Multi-repo green = a **coordinated TUPLE** (restoring one repo alone restores only half the green).

10. **Blockers → parallel resolvers BEFORE escalation**: on ≥2–3 exhausted distinct approaches, dispatch resolver agents with orthogonal hypotheses. Interrupt the human only for hard-stops (destructive, out-of-scope, legacy untouchable). **Anti-littering**: clean scratch at stop; keep the deliverable + RUN.md.

11. **Arm the `/goal` driver at handoff** *(native Claude Code ≥ 2.1.139; decision USER-OK 2026-07-10)* — the stop-gate BLOCKS false closure but does not RELAUNCH work (Stop-hook blocks are capped at 8 consecutive); `/goal` is the native relaunch driver + live cost panel (elapsed/turns/tokens — the cost-visibility reflex). Arm at handoff, BEFORE the build starts: the evaluator judges each subsequent turn, and the condition becomes satisfiable once the first signal output lands in the transcript. **Compile the condition FROM the RUN, never free text**: the `signal:`/`signal-cmd:` + the DoD items, each demanded as proof VISIBLE in the transcript — the `/goal` evaluator (separate fast model) reads ONLY the transcript and runs nothing, so a sloppy condition swallows self-declared success; align the driver on the gate's authority instead of creating a second judge. Keep the compiled condition ≤4000 chars — compress a long DoD to its essential checks, never concatenate the RUN verbatim. Template:
    > `/goal Done ONLY when the transcript SHOWS: (1) <signal-cmd> executed with exit 0 AND its output visible (N>0 assertions displayed, not merely claimed), (2) the RUN.md at <path> at status: green shown via a read/tool result (not stated in prose) AND the end-of-turn accepted by the stop-gate (no BLOCK message after it), (3) <task's terminal artifact, e.g. post-action capture READ>. A "done" without these artifacts visible does not count — keep working.`
    **ONE condition per session** — before arming, check the session's Journals for a prior `goal armed =` on a still-OPEN run: re-arming REPLACES it silently (trace the supersede in both Journals, or skip arming and rely on the gate alone). Arming is USER-side (⚠️ programmatic arming unverified — pilot it): hand the ready-to-paste line ("arm this before letting me loop"). **Non-interactive run** (`-p` / scheduled / remote-headless — nobody to hand the line to) → record `not armed: non-interactive — stop-gate + Ch.4 loop only`; disposable with no RUN.md → `not armed: disposable, no RUN to compile from`. Trace `goal armed = <condition>` in `## Journal`; on session resume the condition is restored — re-check it still matches the RUN's signal/DoD (drifted → re-arm and re-trace). **At close (green / degraded-closed): have the user run `/goal clear`, logged in Journal** — a lingering condition keeps the evaluator judging (and nudging) later unrelated work. **Driver, never authority**: `/goal` pushes, the stop-gate certifies — the evaluator saying "condition met" is NOT a green. **Pilot guard**: on the FIRST armed run, observe CONCRETELY (evaluator cost/latency · does it agree with the gate's block decisions · no relaunch after close) before making arming the default; log findings to `## Cicatrices`.

12. **Wire `clean` then `judge` (steps 4–5)**: after build's proof and adjacent guard, `clean` inspects attributable residue, replays the signal, and fingerprints the post-clean diff; then hand the deliverable + RUN path to `judge`. A judge defect re-enters as an increment, followed again by `clean`. Any added signal also stales the armed `/goal` condition — re-compile and re-hand it (or trace unchanged coverage). The cycle cap remains `judge`'s. **Package as a reusable skill ONLY on recurrence ≥2**; name `loop-<task>`, cover terrain + loop spec + handoffs, then trigger-test it.

## Output

Deliver to the user — in **plain words, no internal jargon**:

- Confirmed regime + **up-front estimate** (rough turns × time)
- Loop plan: how Claude sees its real result / the environment / how it resumes
- Terrain artifacts mounted (or proposed, awaiting confirmation)
- Task-specific spec: signal · **task breakdown** (parallel vs sequential) · caps · **last-working-snapshot** checkpoint · judge wiring
- Explicit handoff to the build (ENGINE Ch.4) · loop-skill created OR "no skill — disposable / not recurring"
- The ready-to-paste `/goal` line (user arms it at loop start) — or "not armed: <reason>" (e.g. short interactive run)
- The RUN.md path

Never report "done" without a RUN.md that is **open and filled** (signal + Reprise) — the build hasn't started yet. **Exception**: a `disposable` one-shot may need no RUN at all — ENGINE regime-table + `frame` proportionality.

**Next: run the work** (per ENGINE Ch.4 — BUILD), **then `clean`, then `judge`, regime propagated.**

## Don't

- **Frame the need or pick the approach** — that's `frame`'s job; terrain starts with a settled `Décision:`.
- **Execute the loop mechanics** (decompose/execute a plan, TDD, test-driven increments) — those are ENGINE Ch.4 BUILD, the executor's manual; no skill fires during the build.
- **Re-specify generic loop mechanics** — only the task-specific signal↔harness bridge belongs here.
- **Clean or judge the finished deliverable** — those are `clean` (step 4) then `judge` (step 5).
- **Set `status: green` to satisfy the Stop hook** — the gate replays `signal-cmd`; a false green blocks.
- **Mount two concurrent builders** — serialized, idempotent, reversible steps only; confirm before irreversible actions.
- **Invent a judge cycle cap** — `judge`'s cap is authoritative; terrain does not duplicate it.
- **Let `/goal` (or its evaluator) act as closure authority** — it is a relaunch driver; only the stop-gate's replayed proof (or USER-OK) closes. Never arm it during framing/QCM phases — only at the handoff to the build.

## Engine & reflexes

Loop-execution mechanics — decompose into signal-bearing increments, red-first then green, parallel dispatch, anti-regression cadence, systematic debugging, checkpoint/rollback — are **canonical in `_engine/ENGINE.md` Ch.4 BUILD**. Terrain prepares the ground; the executor consults Ch.4 during the build. On any divergence between this skill and the engine, the engine wins.

Workspace convention and `signal-cmd` whitelist: **ENGINE Ch.3** (RUN.md header `status/regime/signal/signal-cmd/gate`, single-writer, FLAKY, session-scoping + legacy fallback). Signal trustworthiness (proof classes, self-proving, auto-proves): **ENGINE Ch.2**.

Workspace path (session-scoped): `~\.claude\runs\<session_id>\<subject>-workspace\RUN.md` — set the `session:` header. The installed Stop hook reads RUN.md and **blocks end-of-turn while a run is open/red** — that out-of-model gate is the real closure authority, not you.

Reflex anchor: **the signal must reproduce the USER's symptom as they live it** — a proxy two causal steps away from the terminal effect is not a closure signal.
