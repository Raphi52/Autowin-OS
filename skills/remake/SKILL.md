---
name: remake
description: Harvest the hindsight that only a FINISHED product reveals, then spend it by DRIVING THE WHOLE PIPELINE. Reads the completed deliverable as its own specification, then runs `scout` (with the regret bar) to surface the candidates, `frame` on every candidate retained after the cost is shown, and the full chain per framed need — `build` → `clean` → `judge` — before replaying the target's own signal. One gesture instead of a pipeline steered by hand. Unifies "si tu devais le refaire en analysant le produit fini, que ferais-tu différemment ?" followed by "fais-le". Trigger on `/remake`, "si tu devais le refaire", "que ferais-tu différemment", "refais-le mieux", "avec le recul, comment tu l'aurais construit", "remake this", "rebuild it knowing what you know now", or right after a deliverable is VERIFIED and you want the accumulated compromises paid down. The proof obligation is INVERTED versus build: there is no bug to reproduce, so every change must prove it breaks NOTHING — the target's existing signal is the net, and remake REFUSES to run without one it can actually replay. It sequences the phases and never re-implements one. Do NOT use to: audit whether a deliverable is correct or done (→ `judge`, whose bar is the DEFECT, not the design regret); pick what to work on when the deliverable is not FINISHED (→ `scout` alone); redesign the visual layout of a screen, where the question is what it should LOOK like (→ `front-converge`, even when the user says "refais") ; a bare "refais-le mieux" with no finished, verified target in view — ask WHICH deliverable before routing, since the same words fit a screen's look and a module's design; remove residue from failed attempts (→ `clean`); improve Claude's own behaviour or the kit's rules (→ `kaizen`). If the TARGET itself is the kit, the hooks, `CLAUDE.md` or memory, remake lists the regrets and STOPS — it never writes there autonomously.
---

# Remake — the second system, built for real

## Purpose

A finished product reveals the shape it should have had. Decisions taken under uncertainty are now
obviously wrong; an abstraction added out of caution turned out unnecessary; the structure grew by
accretion. That lucidity exists **only once the thing is done**, and it evaporates. `remake` harvests
it and spends it: it reads the finished deliverable as its own specification, asks what would be built
differently starting today, and **drives the whole pipeline on the answer** — `scout` to surface the
candidates, `frame` on each, then `build` → `clean` → `judge`. One gesture instead of a pipeline
steered prompt after prompt.

**The bar is the design REGRET, not the defect.** `judge` finds what is *wrong*, provable against the
need. `remake` finds what is *not wrong but would be written otherwise*. Confusing the two turns taste
into obligation.

**The proof obligation is INVERTED.** `build` proves a change FIXES something — there is a bug, so
there is a red→green. `remake` has no bug to reproduce, so its changes must prove they break
**nothing**: a harder guarantee, and the one a bare "fais-le" never provides. Everything in step 0
exists to make that guarantee real — a signal that can fail and is actually verified, green before and
after, and one atomic undo. No signal, no remake: autonomous execution whose only net does not exist is
the single configuration where this skill is harmful. "Verified" has two legitimate shapes and no
third: a `signal-cmd` the gate replays, or an attested signal under `regime: critical`, the only regime
where the gate demands one.

## Procedure

### 0. Preconditions — and this step WRITES

Target = the deliverable of the current RUN, else an explicitly named file/module/folder. **Never the
whole repository implicitly** — that yields a shallow sweep at ruinous cost. Too large to hold? Ask
which slice; do not skim.

**FROZEN PERIMETER — checked HERE, before spending anything.** Target = the kit (`~/.claude/skills`),
the hooks, `CLAUDE.md`, or memory: produce the ranked list and **STOP**. No `frame`, no phase, no
write. FIRST gate, before the `scout` fan-out, because the kit is the most likely `/remake` target:
placed any later, the guard is falsified by the agents already paid for. A skill that rewrites its own
rules autonomously is what `kaizen` forbids, and the prohibition does not lift because a different
skill is asking. Human OK reopens it — for the named files only.

**Step 0 is NOT read-only, and the order below is the safe one.** It creates a rollback point, it
breaks a line on purpose, it may create a worktree and a junction. Steps 1-2 (scout, rank) are the
read-only ones.

**0.a — Anchor the starting state FIRST.** Before any deliberate breakage, so nothing can be left
broken without a way back. The **anchor** is a named gesture available even on a clean tree: record
the starting HEAD hash. The rollback HANDLE — the enumerated list of your own commits — does not
exist yet; it is constituted at step 4 and verified at step 5. Do not ask for it here.
  - **Attribute the dirt PER FILE, and refuse the co-dirty one.** A dirty tree is not automatically
    someone else's: `git status`, `git log -3`, `git stash list` and the session's own RUN tell you
    whose each file is. Yours → commit it by name (never `git add -A`). But a file carrying YOUR edit
    AND another session's uncommitted one is **co-dirty**: `git add <file>` stages its content as it
    stands and swallows the neighbour's work into your commit — which then enters the rollback handle,
    so a step-5 revert destroys it, attributed to you. A co-dirty file is never committed: isolate, or
    ask. Probe too for a third-party operation IN PROGRESS (`.git/MERGE_HEAD`, `index.lock`, an
    unfinished rebase or revert): acting inside one corrupts it for every session on the tree.
  - Another session's dirt → **the ENTIRE remake moves into an isolated worktree**: steps 0-5 all run
    there, signal included, and bringing the result back is a SEPARATE gesture the user asks for. A
    rollback point in a worktree while the build happens in the main tree restores a state that never
    existed. Neither clean nor isolable → STOP.
  - **A shared tree goes dirty AFTER step 0 — the normal case, and it does not retroactively migrate
    the work.** What moves is the **measuring instrument**: run the signal in a throwaway worktree on
    your own committed HEAD (`node_modules` junctioned in — `cmd /c mklink /J <wt>\node_modules
    <main>\node_modules`), keep committing in the main tree, file by file. That buys the ability to
    prove a red belongs to someone else instead of assuming it.
  - **The handle is a LIST OF HASHES, never a range**, and it is verified on **content as well as
    authorship**: `git log --oneline --no-walk <list>` proves who authored them, not what they carry,
    so `git show --stat <hash>` must also land inside the partition's file list.
  - **Perimeter touching a PERSISTED format or an external contract → the rollback covers the DATA
    too.** Reverting code does not un-migrate a rewritten file, and a field this build stopped writing
    may be one the previous binary REQUIRED. Back the file up before the first migrated write, write
    the restore procedure down — including any journal that would replay post-remake records over a
    restored snapshot — and read step 5 for the guard that makes the restore itself safe. No data
    rollback, no remake on that candidate.
  - Not a git target (a doc, a folder) → the rollback point is an explicit copy, **scoped to the
    candidate's perimeter and enumerating what it EXCLUDES** (at minimum the gitignored paths and any
    live store: copying those yields an incoherent snapshot, costs gigabytes, and restoring it would
    overwrite other agents' live state). One copy = one all-or-nothing undo, so the copies are made
    **per partition, after step 2** — the partitions do not exist yet here.

**0.b — The signal must satisfy TWO independent constraints, not one.** This is where the whole
guarantee lives, and where it is most easily hollow. `stop-gate.ps1` applies both, in this order:
  1. **It must PROVE** — `Test-MeaningfulProof` requires a test/build runner or a script **at the head
     of the command** (after stripping a leading `cmd /c`). Fail it and the gate appends
     *"signal-cmd ne PROUVE rien"* and BLOCKS every green, whatever the tests say.
  2. **It must be WHITELISTED** to be replayed at all — `dotnet test`, `dotnet build`, `cmd /c`,
     `powershell [-NoProfile] -File`, `pwsh [-NoProfile] -File`. Outside that list the gate replays
     nothing and stamps its verification anyway.

  Two constraints, two distinct failure modes, and a form can pass one while failing the other.
  **Measured by running the gate's own function:** `cmd /c "cd /d <abs> && npm test"` proves NOTHING
  (the `cd` sits at the head) → permanent BLOCK; `npm test` alone proves, but is never replayed. The
  forms that satisfy BOTH: **`powershell -NoProfile -File <abs>\signal.ps1`** (the script does the
  `cd`, runs the suite, propagates `$LASTEXITCODE`) — prefer this one — or
  `cmd /c "npm test --prefix <abs>"`.
  - **`signal-cmd:` is for the REPLAYABLE. Anything else goes in `signal-attestable:`** (ENGINE,
    foundation §1 header) — a read capture, a query, a human-read artifact, with the attestation
    contract `clean` defines (fresh artifact, run-stamped, non-vacuous, negative control). A visual
    target is not a target without a signal; it is a target with the other kind. **And it forces
    `regime: critical`**: critical is the ONLY regime where the gate DEMANDS an out-of-model proof, so
    an attestable signal carried at `standard` is verified by nobody. Attestable but not critical → the
    refusal applies, exactly as if there were no signal at all.
  - **The 120 s cap is real.** The gate kills a replay at `GATE_REPLAY_TIMEOUT_MS` (default 120000) and
    returns 124. Measured duration above the cap → the autonomous default is a replayable SUBSET under
    the cap in `signal-cmd:`, the full suite carried as an attested `signal:`. Raising the variable is
    NOT an autonomous option — it lives in `settings.json`, inside the frozen perimeter, so it takes a
    human OK. Silence here becomes a phantom regression at step 5.
  - **Time THE EXACT COMMAND**, not a subset of it: its duration feeds the cost line. Take the repo's
    canonical command (`npm test` and what it chains) unless a narrower scope is justified in the RUN —
    a vitest-only net misses a typing regression. Definition changes later (a candidate adds tests, the
    scope widens) → **re-time and re-state the number**. Measured: a "3 s" quoted at step 0 was still
    cited as "replaying is free" while every real run took 25 s.
  - **Flaky signal → not a `signal-cmd:`.** The gate replays ONCE, no retry: a flaky suite makes the
    parent's closure a coin toss. Wrap the double-run in the script and point `signal-cmd:` at that, or
    carry it as attested. Then `degraded-closed` on "flaky, colour confirmed outside the gate" is
    legitimate.

**0.c — PROVE the signal can go RED — and treat the breakage as the dangerous act it is.** A signal
that cannot fail is not a net. But this sabotage lands in the one window the topology leaves untraced
(no RUN exists yet, so no gate watches), on a tree other sessions write and a watcher may compile
live. So, in order:
  1. **Inventory the live writers** — watchers, the running app, concurrent sessions (the
     session-inventory hook already reports them). Any of them, or a shared tree → **break the line in
     the throwaway measuring worktree**, never in the tree they compile. A deliberately broken line
     served to the user and to other sessions' measurements is contamination, and nobody is warned.
  2. **Write the trace BEFORE the breakage** — absolute file path + its HEAD hash. It is the only
     write worth making in this untraced window, and the only thing that allows a restore after a
     crash, a context loss, or an interruption.
  3. Break one line inside the perimeter, run the signal command **directly** (not through the gate —
     no RUN exists yet), watch the red.
  4. **Restore by command, never from memory**: `git checkout -- <file>` (or the copy, off git). Then
     a **blocking checkpoint before anything else**: `git status --porcelain <file>` empty AND the
     signal green again. Skip it and a residual sabotage becomes indistinguishable from a candidate's
     edit — the red it causes is imputed to sound work, and step 5 reverts what was fine.

  Measured: a `tsc --noEmit` that compiled nothing (`files: []`) sat in a DoD as the typing net — a
  strictly empty green. Attestable signal → the red proof is the attestation's **negative control** (a
  deliberately wrong artifact submitted to the same reading, traced in the RUN), not a CLI red.

**0.d — Green where the remake will actually run.** If 0.a moved into a worktree, the green measured
elsewhere no longer counts: a worktree carries neither untracked nor ignored files (`node_modules`,
build outputs, `.env`). Re-capture it there, and require green before continuing. Not runnable or not
green there → STOP; never fall back silently to the main tree. **Write every `signal-cmd:` and
`check:` as an ABSOLUTE path rooted in the worktree** — the gate replays them from the SESSION's cwd,
so a relative command runs against the wrong code, and the failure mode that matters is the false
GREEN on code the remake never touched.

**RUN topology.** Path, header and closure conventions: ENGINE Ch.3 — not restated here. What is
specific to remake:
  - Steps 0-2 open **no RUN**: the parent is created at **step 3**, once the cost has been accepted.
    Earlier, it would sit `open` across the step-2 human wait and the gate would block the very turn
    that asks for the go. One consequence to hold: the proof that the gate really REPLAYS the signal
    needs a RUN carrying it, so it cannot happen at step 0 — it happens at step 3, below, before any
    phase runs. Step 0 proves the signal can go red; step 3 proves the gate is armed. Two proofs, two
    moments, neither optional.
  - **One child RUN per FILE-COLLISION PARTITION, not per candidate.** Design regrets concentrate on
    the same files by construction — that is what makes them regrets. Measured: 10 of 12 candidates
    touched the same two files. Group the colliding ones, name the partition, sequence inside it; only
    genuinely disjoint candidates get their own RUN. Suffix `remake-<NN>-<slug>`, `NN` = rank in the
    candidate table. A candidate dropped at step 2 opens no child RUN.
  - **`regime: standard` MINIMUM on the parent and on every child, and `gate: off` forbidden on the
    parent.** Both for the same reason: they are the only out-of-model authority over the remake.
    `disposable` disarms the signal replay, the ≥3-scored-options rule AND the unchecked-DoD block all
    at once — every guarantee this file claims as a fact evaporates without a word of warning.

### 1. SCOUT — surface the candidates, with the regret bar

Delegate the derivation to `scout`. `remake` supplies what `scout` cannot invent — **the bar is the
design regret**, and the target already WORKS. Fan the lenses out in parallel (ENGINE Ch.1), dedup by
core idea:

- **Structure** — what would live elsewhere, be split, or be merged.
- **Naming** — what a reader must decode instead of read; names that lie about what they hold.
- **Unnecessary abstraction** — indirection for a case that never came: an interface with one
  implementation, an alias for one caller, a hook nobody uses.
- **Coupling** — what knows too much about what; the change that forces three unrelated edits.
- **What would not be built at all** — the sharpest lens, and the one nobody runs.
- **Today's skeleton** — sketch what you would write NOW from the need alone, then diff against the
  real thing. Keep it a sketch: a full reconstruction invents a skeleton disconnected from the
  constraints that shaped the code.

Each finding names **the observation that would catch its regression** — without it, a later audit
cannot tell the safe from the lucky.

**Two things must be said to `scout` explicitly, or the delegation returns the wrong table.**

**(a) Its survival gate is REPLACED, not extended.** `scout` keeps a candidate only as a 🔧 fix (a REAL
defect with `file:line`) or a 🆕 new thing. A regret is neither — the code WORKS, so no defect; it
EXISTS, so not new — and it dies at the gate. Either the table comes back empty and `remake` concludes
"nothing to redo" when it only measured its own filter, or the regret is relabelled a defect, which
this skill forbids. State the substitute: **♻️ regret — survives iff a real `file:line` + the one-line
form it would take today + the observation that would catch its regression** — and ask for the Type
column extended to ♻️, since a gate with no column to land in gets its regrets relabelled 🔧.

**(b) Its mandatory arms are DISARMED, including the self-re-arming ones.** The bold/ambition quota
injects greenfield features that are not regrets; the CLEAN-ROOM lens refuses to read the existing
code and contradicts this skill's premise (the finished product IS the specification); the web
prior-art arm answers a question nobody asked. Naming those three is not enough: `scout` re-lights the
bold arm through its **WIDEN** step (no high-impact candidate survived — the nominal outcome when the
target already WORKS) and its **self-gate** (every new candidate merely finishes the planned). Disarm
those two by name too, with the substitute rule: *on a regret table, the absence of a high-impact
candidate is an honest result, not a tepid harvest, and triggers no extra round.*

An arm that fires anyway and yields something valuable leaves the regret table and is surfaced
separately — it does NOT enter step 3, and it is not built under the banner of "what I'd do
differently".

### 2. Rank, then SHOW THE COST before going further

Impact ⊥ effort, two axes, never one collapsed score (ENGINE Ch.1). Everything retained goes through
`frame`, so **the list length IS the price**. Surface one line covering both costs before committing:

- **The agents, from a NAMED tally** — N lenses + N frames + N chains + **N `terrain` if armed** (see
  the dispatch contract: it is disarmed by default, and counted the moment it is not). Compare the
  total to the regime's agent bracket (CLAUDE.md reflex 4) and to the session's cumulative count; any
  overrun carries its line of justification.
- **The signal replays × its measured duration** — once per build increment, once per `clean`, once at
  the close, **plus one gate replay per RUN that transitions to green** (parent + N children) **and
  each `check:` line**. On 6 partitions that is 7 uncounted replays; on a 20-minute suite it is the
  whole budget.

Three multiplicands are not yet decided at this point — the number of build increments, the
judge→build iterations, and whether `terrain` is armed. Give them as a RANGE with its upper bound
shown, and reserve "counted" for the terms actually known (lenses, frames, partitions, the measured
signal duration). A fake precision on an undecidable term is not honesty, it is decoration.

Both figures are **COUNTED, not guessed** where they can be: measured on the first real run, "~50 agents" meant about 15
and "3 s" meant 25 — the user said yes to two wrong numbers. Reality diverging by more than ~2× while
the remake runs → **say so again mid-course**. If the product exceeds what the target is worth, say so
and propose replaying at milestones instead of every increment.

Then **STOP and wait for the go** if the count exceeds what the request implied, or if the cost line is
not obviously acceptable; otherwise continue and say that you did. "One gesture" means the user does
not steer each phase — not that the bill arrives afterwards.

**A "no" here is a real outcome, and step 0 left things behind.** Undo it by NAMED, bounded gestures:
the worktree by the absolute path recorded at 0.a and that one only — **never `git worktree prune`,
never a remove on a path you did not create**: this repo carries other agents' LIVE worktrees, and a
generic cleanup takes their work in flight. The junction by its own path. Confirm 0.c's deliberate
breakage is back (`git status --porcelain` empty on that file). **The commit from 0.a stays** — it
holds legitimate pre-existing work, so rewriting shared history to remove it would destroy commits
other sessions may have layered on top. Say it remains; if it truly must go, that is `git revert` of
the single enumerated hash, never a reset. Report the target untouched.

**No candidate is an honest result too.** `scout` returning nothing means no regret worth paying for.
Say it and stop; do not run steps 3-5 on an empty list. If you drop anything, say what and why — a
quiet cut reads as "covered everything" when it did not.

### 3. FRAME every candidate retained — and write the parent's own need

A `scout` candidate is a lead, not a task. `frame` scopes the need, checks what already EXISTS (the
duplicate trap), scores the approaches and states its assumptions. Skipping it hands `build` a vague
wish and gets a vague change back.

**PROVE THE GATE IS ARMED, now that a RUN exists to carry the signal.** Break a line inside the
perimeter again, close the parent RUN, and read the gate's refusal: it must cite
`REJEU signal-cmd ECHOUE (exit N)`. Any other BLOCK — typically *"signal-cmd ne PROUVE rien"* — means
the form is wrong, not that the gate is watching, and treating it as proof of arming is the exact
false-green this step exists to prevent. Then restore by command and re-check as in 0.c. Never
observed a replay-refusal → the closure is labelled *self-declared, gate not armed*.

**Write the PARENT's `## Besoin` HERE, before any phase runs** — nobody else will, and step 5 has to
tick its DoD item by item. It holds the object of the remake, the candidate table, the signal and the
rollback handle, and a cochable DoD whose items are the closure contract itself: *original signal
replayed green, unchanged* · *extended signal justified* · *candidate × phase matrix published* ·
*rollback handle enumerated and verified*. Each item names its proof. Written at the close instead, a
DoD gets tailored to the result — the defect `CLAUDE.md` names outright.

**A candidate may DIE here, and that is the framing succeeding.** Step 2 drops on cost; step 3 kills on
evidence — the regret is wider than the code, the thing is already done, the fix costs more than it
buys. Say so with the reason, remove it from the count, move on. Without this, the step-2 commitment
pushes the framing to manufacture a regret that isn't there. 

**A regret that turns out to be a real DEFECT is reclassified, not smuggled through.** The inverted
proof obligation is calibrated for iso-behaviour changes. A genuine behavioural divergence takes
`build`'s bar instead: reproduce it red first, then green. Measured on one run of 12: 3 died at
framing, 2 were reclassified.

Independent candidates frame in PARALLEL; two touching the same code are NOT independent — frame them
together or sequence them, so the second is framed against the first's result and not a stale reading.

### The dispatch contract — stated to EVERY phase, EVERY time

The failure mode that keeps coming back in different clothes: a delegated phase does not see what
`remake` decided. It resolves its own RUN, works in the session's cwd, follows its own arbitration
rule, and obeys its own contract about what it must write before reporting done. So every dispatch —
`frame`, `build`, `clean`, `judge` — carries all five:

1. **The absolute child-RUN path.** Relative, a sub-agent writes into the target repo, outside what the
   gate scans: an invisible RUN nothing enforces. It must stay directly under the session's run folder
   — the gate does not recurse. **Never move `AUTOWIN_RUN_ROOT` per candidate** (the one documented
   lever to steer `judge`'s singular glob): it relocates the child out of the scanned subtree and
   recreates exactly that invisible RUN.
2. **The working root** — the worktree, when 0.a moved there. "Steps 0-5 all run there" is a sentence
   in this file, not a property of the environment; a phase that was not told works in the main tree.
3. **The arbitration mandate.** `frame` hands a real fork back and waits unless told to decide. N
   sub-frames after a single go, each meeting a fork, all stop at once — on a skill whose promise is
   not steering by hand. So choose per candidate: **"decide for me"** (default, for an obvious form;
   the decision then needs its ≥3 scored options — ENGINE Ch.1 anti-fixation — or no `Décision:` line
   at all rather than two straw options), or **return the fork to the parent** BEFORE the child RUN is
   opened (an `open` child across the human wait blocks the turn that asks the question). The parent
   batches every returned fork into ONE question, then re-dispatches with the answer and a "decide for
   me" mandate.
4. **The perimeter, explicitly — and never "the recent diff".** It is GRADUATED, because at the first
   dispatch none of the remake's commits exist yet: to `frame`, the perimeter is the FILE LIST plus the
   anchor HEAD from 0.a; to `build`, `clean` and `judge`, it is the enumerated hashes that build
   produced for THAT partition, plus its files. Never a range: on a shared tree another session's
   commits sit interleaved with yours. Measured in both directions — a judge attributed a stranger's
   commit to the remake, and a builder blamed "a concurrent session" for a red that was its own
   uncommitted work.
5. **Do NOT chain onto `terrain`, and the parent RUN is off-limits.** `frame`'s own contract ends with
   an unconditional handoff to `terrain`: left alone, N sub-frames launch N unbudgeted `terrain`. Add
   it deliberately before `build` when the work needs a harness that does not exist — and then count it
   at step 2. And a phase touching the parent's status turns it green on candidate 2 of 6, which the
   gate then validates as a statement about the whole remake.

Do not, on the other hand, tell `frame` to "return without writing": it refuses to report done before
`## Besoin`, `## Contraintes` and `## Confiance` (plus `## Options` + `Décision:` when it arbitrates)
are in a RUN, and a contract forcing a phase to break its own is not a contract. Point it at a file of
its own instead. What must NOT happen is N agents resolving the same default path and overwriting each
other (single-writer, ENGINE Ch.3).

**Whenever this file says a phase "does X", check that phase's own SKILL.md before believing it.**
Where the two disagree the phase wins, and the fix belongs in the dispatch contract above — not in a
stricter sentence here.

### 4. Run the pipeline to the end — build → clean → judge

Each framed need runs the real chain, in order: `build` (executes, red→green, anti-regression) →
`clean` (post-build hygiene) → `judge` (adversarial audit). `judge` returns defects to `build`, not to
`remake`: that loop belongs to the phases and runs to the regime threshold before control comes back.

`remake` decides WHAT and drives the sequence; each phase owns its HOW. Do not grow a second execution
engine, a second audit, or a second cleanup — a divergent copy of a phase is worse than no phase.

Frozen perimeter: unchanged, and it has not lifted.

### 5. Close

Replay the signal — **the target's own, from step 0**, not a phase's internal verdict. A green `judge`
per candidate does not prove the target still works as a whole: each phase proved its own change,
nobody proved their SUM.

**Report BOTH numbers.** Candidates add tests; extending the net is healthy, shrinking it never is. So
state the ORIGINAL signal, unchanged, still green, AND the extended one, every change in the count
justified. A single number that silently moved from 204 to 212 is not a replay of step 0's signal.

Attestable signal → the replay is a FRESH attestation: same reading perimeter as step 0, run-stamped,
with its negative control, and "both numbers" becomes "the same reading checklist, any extension
justified".

**Publish a candidate × phase matrix** — one row per candidate, one column per phase actually run. An
empty cell is declared, not left silent: coverage by ricochet, where one partition's `clean` happens to
span another's commits, reads as full coverage and is not. Measured: 2 candidates of 12 got neither
`clean` nor `judge`, and nothing said so.

Not green → **identify what the red IS before destroying anything**:

1. **Is it even a red?** Exit 124 is the gate's 120 s cap, not a regression. A replay that timed out,
   or a `signal-cmd` the gate never replayed at all, says nothing about the code — fix the signal's
   form (0.b) and re-close. Reverting healthy work over a hook timeout is the expensive mistake here.
2. **Replay once more.** A flaky signal red by bad luck would otherwise throw away sound work.
3. **Re-probe the tree.** Step 0's cleanliness is a DATED fact and these trees move mid-session. Gone
   dirty since → the revert is forbidden outright: hand back, saying what is at stake.
4. **Bisect by PARTITION, do not carpet-bomb.** Partitions are the disjoint unit — candidates inside
   one collide by construction, so reverting them "one at a time" produces conflicts or a state never
   tested. Revert whole partitions, newest first, replaying between each. Bisection unavailable (a
   non-git target with one copy) → say that the granularity is all-or-nothing and what it costs.
   The revert itself is bounded, or it becomes the damage:
   - **Check for foreign commits first.** `git log <hash>..HEAD -- <the partition's files>` returning
     anything that is not yours FORBIDS the revert: hand back instead, saying what is at stake. The
     handle proves the commits are yours; it says nothing about who touched those files since.
   - **`git revert --no-commit <enumerated hashes>`**, never a range. First conflict →
     `git revert --abort`, then report: a shared tree left in a conflicted revert blocks EVERY
     session's commits, and the next third-party `git pull --autostash` on that state is how work
     disappears.
   - Shared tree → do the revert in an isolated worktree, consistent with how a push is handled there.
5. **A DATA rollback obeys the same dated-fact rule as the tree.** Before restoring a snapshot, re-probe
   the file (hash or mtime versus the snapshot): changed since → restoration is FORBIDDEN, hand back
   and say what is at stake. Otherwise the restore silently destroys every write made since — user
   data, the gravest class, and unrecoverable once overwritten. Back up the CURRENT state before
   overwriting it, so the restore is itself reversible, and confirm no live writer holds the file.
6. **Report the culprit either way.** A remake that leaves the target worse than it found it has
   failed, and says so.

**Close the children, then the parent** (statuses and their proof: ENGINE Ch.3). The parent is the only
RUN whose scope is the remake as a whole, so it closes with its gate armed and its DoD ticked item by
item against the final replay. An item that cannot be honestly ticked makes the status
`degraded-closed` — never `green` under an escape hatch. Measured: the first real run closed `green`
with five unticked boxes and the gate off, and nobody but a later audit noticed.

## Output

The ranked candidates (impact ⊥ effort, with what was dropped and the cost shown), what each was framed
into, the phases actually run per candidate with their verdicts, the target's signal replayed green
before and after, and the single rollback handle. Written in the living RUN.md.

## Don't

- **Run without a signal the gate actually verifies** — the refusal is the feature. A `signal-cmd`
  outside the whitelist is never replayed, one that fails the proof rule blocks every green, and an
  attested signal below `critical` is checked by nobody. All three are "no signal".
- **Rewrite the frozen perimeter** — kit, hooks, `CLAUDE.md`, memory: propose only.
- **Present a regret as a defect** — that is `judge`'s bar, and borrowing it makes the skill lie.
- **Leave `disposable` on a remake RUN, let a phase chain onto `terrain`, or let one touch the parent** —
  three silent ways to lose the guarantees this file claims.
- **Bisect before knowing the red is a red** — a 120 s timeout is not a regression.
- **Reimplement a phase, or hand `build` an unframed candidate** — `remake` sequences and adds the
  regret bar; it re-implements none of them, and a scout lead is not a task.
- **Skim a target too large to hold, or hide the cost of what emerged** — ask for the slice; show the
  count.
- **Use to**: audit an existing deliverable (→ `judge`) · pick what to work on when the deliverable is
  not finished (→ `scout`) · redesign what a screen should LOOK like (→ `front-converge`) · clear
  failed-attempt residue (→ `clean`) · change Claude's own behaviour (→ `kaizen`).

## Engine & reflexes

- Parallel fan-out, loop-until-dry, dedup-by-core-idea, impact ⊥ effort, anti-fixation: **ENGINE Ch.1**.
  RUN path, header fields, closure discipline: **Ch.3**. Execution mechanics: **Ch.4**. On divergence,
  the engine wins — this file adds the regret bar, the signal's replayable form, and the dispatch
  contract, and restates none of the rest.
- **This file is long ON PURPOSE, and it is not split.** It runs ~2.5x the biggest phase it sequences —
  flagged, weighed, decided: the body costs ~6k tokens once per invocation, some 3% of a real remake,
  while ONE unread safety rule costs another session's work or user data. The bulk is steps 0 and 5,
  which are gestures, not documentation; putting them behind a "read this first" pointer would apply
  here the very defect this file warns about. Cut decoration, never a rule or the measurement that
  makes it unambiguous. `verify-remake.ps1` ratchets against silent growth.
- Reflex anchor: **closure authority lives outside the model** (reflex 2). Here it is the target's own
  signal — which is why a target without one is refused, and why a signal the gate does not actually
  verify is treated as no signal at all.
