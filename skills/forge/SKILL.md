---
name: forge
description: FORGE the missing tool instead of abandoning the execution. Trigger the MOMENT an execution stalls because a capability does not exist — "je n'ai pas d'outil pour ça", "aucune commande ne fait X", a tool that is refused or absent from the catalogue. A tool that EXISTS and merely misbehaves (crash, hang, wrong output) is NOT a forge case (→ `heal`). `forge` turns that dead end into a named, tested, registered capability, then RESUMES the interrupted work. Do NOT use to: fix a tool that exists and is merely broken (→ `heal`), pick what to build next (→ `scout`), or add a rule to the kit (→ `kaizen`). forge builds ONE capability, the one the current execution is actually blocked on.
---

# forge — the supervisor builds its own missing tool

## Purpose

An execution that stops on « je n'ai pas d'outil pour ça » is a false wall: the tool is a file the
supervisor can write. `forge` exists so the stall becomes a capability, not an excuse. It is never
a licence to invent scope — it forges the SMALLEST capability that unblocks the NAMED execution.

## Entry gate — three questions, in order

1. **What exactly is blocked?** Name the execution, the step, and the observable failure
   (refusal message, exit code, absent command). No named block → no forge.
2. **Does it already exist?** Search the catalogue, the repo (`find_in_files`), and the Brain
   (`brain_query`) BEFORE writing anything. The duplicate is failure mode number one: a second
   command that does what an existing one already does splits the truth in two.
3. **Is a tool the right shape?** A one-shot need is a command run once, not a permanent capability.
   Forge only what will be called AGAIN, or what the execution cannot proceed without.

If the answer to 2 is "yes", stop and use it. Report the search, do not forge.

## Procedure

### 1. SPEC — write the contract before the code

One short block, in the run: `name` · what it does in one sentence · arguments and their types ·
what it returns · what it REFUSES. A tool with no stated refusal surface is a tool that will lie
one day.

Choose the cheapest form that satisfies the contract, in this order:
- an existing command with different arguments (no new tool at all),
- a script in the repo, called through the authorised runner,
- a real capability wired into the app's command bus.

### 2. BUILD — red before green

Write the failing test FIRST: it must fail for the missing capability, not for a typo. Then
implement. `edit_file` verifies each edit, so DEFINE before WIRING — the symbol must exist before
anything references it.

Non-negotiables for anything wired into the bus:
- explicit allow-list of arguments; anything unknown is refused, not silently ignored,
- refusals are RETURNED, never thrown into a swallowed catch,
- no self-recursion: a tool must not be able to relaunch the pipeline that called it.

### 3. REGISTER — make it discoverable

A tool nobody can see is not a tool. Declare it where the app actually reads its catalogue, and
check the declaration is the same string the caller uses. Two lists = the label that lies.

Registration is PROVED, not assumed: after declaring, RE-READ the catalogue the caller actually
consults and find the new name in it. A declaration written in a file the app never reads is the
same dead end forge was invoked for, one layer deeper.

**Autowin OS has TWO registration surfaces, and the bus alone is not enough.**
1. **The command bus** — publishing there makes the tool visible to the CHAT agent, whose prompt is
   generated from the live catalogue (`src/main/chat-pilotage-prompt.ts`). Nothing else to do there.
2. **`OUTILS_NOEUD_SKILL`** in `src/main/skill-node-tools.ts` — a HARD-CODED allow-list. It filters
   the skill-node prompt, the `<cmd>` execution path (an unlisted name is RETURNED as `refuse`), the
   native `mcp__autowin__*` tools, and the bus wiring in `src/main/index.ts`. A tool absent from
   this array is invisible AND refused inside every workflow node — the orchestrator that plays the
   skills will never pick it, however correctly it is published on the bus.

So: add the exact tool name to `OUTILS_NOEUD_SKILL`, then PROVE it on BOTH surfaces — the name
appears in the generated skill-node prompt (`promptOutilsNoeudSkill`, with its real argument names),
and a node call comes back OK instead of « REFUSÉ — indisponible depuis un nœud de workflow ».
Registering on the bus only, then reporting the tool as available to the orchestrator, is a false
green.

### 4. PROVE

Run `verify`, targeted on the new test file. Report the exit code. « auto-déclaré, non vérifié »
is the only honest wording when the run did not happen.

### 5. RESUME

Go back to the execution that stalled and finish it WITH the new tool. A forge that ends on the
tool, without the work it was forged for, is half a job.

### 6. RETAIN

`remember` ONE lesson: the capability that was missing, and what the gap revealed. `type: domain`
for the capability itself, `type: lesson` if a pattern caused the gap.

## Report

Close with: the block (named) · the tool forged (name + contract in one line) · where it is
registered · the proof (test name, exit code) · the resumed execution and its outcome.

## Don't

- Don't fake the tool's output to keep going. A stub that returns plausible data is the worst
  possible outcome of this skill.
- Don't widen an existing tool "while we're at it" — the named block only.
- Don't forge a tool for a capability the environment genuinely does not expose (no credentials,
  no network, no permission). Say so, name what you probed, and stop.
- Don't declare it registered before reading the command's own report: a call can SUCCEED while
  carrying a refusal.
- Don't forge from inside a forge. If the tool being forged is itself blocked on a missing
  capability, STOP at depth two: report the chain of gaps and let a human cut it. A skill whose
  answer to its own blockage is itself has no floor.
