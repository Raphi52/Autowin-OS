---
name: salvage
description: Find and recover work stranded anywhere in a git repository — uncommitted changes, stashes, detached worktrees, orphan commits, unmerged and recovery branches, dangling objects in the reflog — then decide per item whether to merge it, drop it, or leave it, carry that decision out without losing anything, and finish on a CLEAN working tree so the next pull, branch switch or update is not refused. Judges every candidate by CONTENT, never by its message, because the most common finding is work already integrated under a different implementation. Use when a repo has accumulated side-work across sessions, agents or worktrees; when a tool reports "unpublished work"; before a big merge, migration, branch cleanup or machine handover; after an interrupted rebase, a crashed agent run, or a stash you no longer trust; or on "did I lose work?", "what is still not merged?", "clean up my stashes/branches/worktrees". Do NOT use to review code quality, to resolve a merge conflict you are already inside, or to restore a file from a single known commit.
---

# salvage — find stranded work, then merge it or drop it, without losing anything

## Purpose

**Almost nothing a git repository has committed is truly gone — but plenty of it is invisible.** Work
strands in places no routine command shows: a detached worktree, a stash nobody popped, a branch
never merged, an object only the reflog remembers. This skill sweeps every hiding place, decides per
item, and executes — with the discipline that makes the decision trustworthy: **judge by content,
prove before you delete, and never measure a candidate against a tree you have already contaminated
with it.**

The most common outcome is not rescue. It is discovering the work is **already there**, written
differently. Treating a duplicate as a loss re-introduces old code over new; treating a loss as a
duplicate throws work away. Telling them apart is the whole job.

## Procedure

### 1. SWEEP — enumerate every hiding place

Run all of these. Each finds work the others cannot see. Record every hit with its SHA.

```bash
git status --porcelain                  # uncommitted, including STAGED (a staged file blocks merges)
git status --porcelain --ignored        # real work hidden by .gitignore (configs, local fixtures)
git stash list                          # stashes — and see the stash trap under Don't
git worktree list --porcelain           # linked worktrees: HEAD sha + detached/branch state
git branch --no-merged HEAD             # local branches carrying unmerged commits
git branch -r --no-merged origin/HEAD   # same, on the remote
git log --oneline --all --not --remotes # commits on no remote: unpushed, so only on this machine
git fsck --no-reflog --lost-found       # dangling commits/blobs: dropped stashes, killed rebases
git reflog --date=iso                   # what HEAD did recently: hard resets, aborted operations
```

**Detached worktrees are the blind spot.** A worktree sitting on a detached HEAD holds commits that
**no `git for-each-ref` will ever list** — they belong to no branch. Only a directory scan crossed
with a reachability check finds them:

```bash
# substr, not $2: worktree paths contain spaces far more often than you expect.
git worktree list --porcelain |
  awk '/^worktree /{p=substr($0,10)} /^HEAD /{print substr($0,6) "\t" p}' |
while IFS=$'\t' read -r sha path; do
  # already contained by some ref -> not orphaned
  git for-each-ref --contains "$sha" --count=1 --format='%(refname)' | grep -q . && continue
  # brings a patch the base does not already have
  git cherry HEAD "$sha" | grep -q '^+' && echo "ORPHAN $sha $path"
done
```

The two filters pull in opposite directions, and both are needed. `for-each-ref --contains` skips
commits some branch already holds. `git cherry` compares by **patch-id**, so it stays silent on work
already re-applied under a different SHA — a cherry-pick, a manual re-apply. Drop the first and the
sweep screams about every stale base; drop the second and it hides real work.

**Tool-specific roots.** Agent runners, IDEs and CI often keep private worktrees or backup branches
in their own namespace. List what is not a normal ref, and inspect any directory such a tool owns
beside the repo:

```bash
git for-each-ref --format='%(refname)' | grep -vE '^refs/(heads|tags|remotes)/'
```

**Ask the user what tooling writes to this repo.** You cannot guess it, and a whole class of stranded
work lives exactly there.

### 2. TRIAGE — is it actually missing? (before any decision)

For each candidate, answer one question: **does its content exist in the tree today?** Never answer
from its message — a stash labelled "WIP dark mode" may hold work shipped weeks ago.

1. **Diff its files against the working tree**, one by one:
   `git show <sha>:<path> | diff - <path>`. Identical → already integrated.
2. **Search for the FEATURE, not the diff.** The same intent is routinely re-implemented differently:
   a lookup table where the candidate used nested conditionals, a hook where it used a class. Grep for
   the identifiers, the strings, the behaviour. A textual diff calls these "missing" when they are
   present — **the single most frequent false alarm in this whole procedure.**
3. **Locate its base**: `git merge-base <sha> HEAD`, then
   `git diff --stat $(git merge-base <sha> HEAD) HEAD -- <paths>`. A far-moved base does not make the
   work stale — it makes a file-level restore **destructive**.
4. **Check the remote too.** Work can be absent locally yet already pushed: compare against
   `origin/main`, not only `HEAD`.

Classify each: **DUPLICATE** (content present, possibly rewritten) · **UNIQUE** (genuinely absent) ·
**SUPERSEDED** (an evolved version of the same intent is present) · **UNKNOWN** (say so, do not guess).

### 3. DECIDE — per item, with the human owning taste

| Verdict | Action |
|---|---|
| DUPLICATE | Drop the carrier. Nothing to merge — and name the existing code that covers it. |
| SUPERSEDED | Usually drop. If the old version carries something the new one lacks (a test, an edge case, a named constant), graft **that part only**. |
| UNIQUE | Merge — step 4. |
| UNKNOWN | Leave untouched. An unresolved item is never a deletion candidate. |
| Conflicting intents | **Surface to the human.** |

**Conflicting intents** is the case that costs most when handled silently: the tree and the candidate
solve the same problem differently. Keep the better **structure** — named constants, separated knobs,
tests — and let the human choose the **values**, especially anything visual, tonal or
performance-tuned. If honouring their choice forces you to relax an assertion the candidate shipped,
understand what that assertion encoded: a bound on someone's taste is not a correctness property, but
**loosening it silently is indistinguishable from cheating**. Say it, and write the reason where the
assertion lives.

### 4. RECOVER — apply without overwriting

- **Merge by patch, never by file restore.** `git cherry-pick <sha>`, or
  `git diff <base>..<sha> > /tmp/p.patch && git apply --3way /tmp/p.patch`.
  **Never `git checkout <ref> -- <file>`** when the base has moved: it replaces the whole file and
  silently deletes everything committed since.
- **On a shared or dirty tree**, work in an isolated worktree — `git worktree add <tmp> <base>` —
  apply and commit there, then merge. A shared index mixes your change with whatever else is staged,
  and someone else's conflict blocks your commit.
- **Resolve conflicts deliberately, and record why**: which side won, and what the loser contributed.
  Six months later that note is the only trace of the decision.
- **Verify after applying.** A clean 3-way apply proves the text merged, never that the result is
  coherent. Run the tests the work touches.

### 5. DISPOSE — deletion needs a receipt

Before removing any carrier, **record its SHA**:

```bash
git stash list --format='%gd %H %s'   # capture ids BEFORE dropping anything
git rev-parse refs/heads/<branch>
```

Dropped stashes and deleted branches survive in the object database until `git gc` prunes them:
`git stash apply <sha>` and `git branch <name> <sha>` bring them back. Recording the SHA turns an
irreversible act into a reversible one and costs one line.

**Never run `git gc --prune=now`, `git reflog expire` or `git worktree prune` during a salvage** —
they are precisely what makes these objects unrecoverable. Get an explicit yes before deleting
anything you did not create.

### 6. LEAVE THE TREE CLEAN — a salvage that ends dirty blocks the next action

**A salvage is not finished when the verdicts are written; it is finished when `git status
--porcelain` is empty.** Every downstream operation refuses a dirty tree: pulling, rebasing,
switching branch, and the app's own **« Mettre à jour »** button, which declines rather than merge
over uncommitted work. Leaving probe files, half-applied patches, a `.rej`, a temporary worktree or
an un-popped index behind turns a successful rescue into a stuck repository — the user pressed
salvage, then could not press update.

Close the loop, in this order:

```bash
git status --porcelain             # MUST be empty at the end — staged included
git status --porcelain --ignored   # your own scratch files count as residue too
git stash list                     # every stash you created is popped or explicitly kept + noted
git worktree list --porcelain      # every temporary worktree you added is removed
git diff --name-only --diff-filter=U ; grep -rn '^<<<<<<< ' -- .   # zero conflict markers
```

Rules for closing:
- **What you recovered gets committed.** An applied patch left uncommitted is not salvaged, it is a
  new stranded item — the exact state this skill exists to remove.
- **What you created for the investigation gets removed**: temp patches (`/tmp/p.patch`), probe
  files, isolated worktrees (`git worktree remove <tmp>` — never `git worktree prune`).
- **What was dirty BEFORE you started stays exactly as it was.** Note it in the report as
  pre-existing and untouched; do not commit or discard someone else's work in progress to reach a
  clean status.
- **If the tree cannot be made clean** (unresolved item, conflict the human must settle), say so
  explicitly, name what remains and why, and warn that update/pull will refuse until it is settled.

### 7. REPORT

One row per item: what it is · where it lived · verdict **with its evidence** (which file matched,
which identifier was found) · action taken · recovery SHA. State plainly what you could not classify.
End the report with the **final `git status --porcelain`** (empty, or the exact lines that remain and
why) — that line is the proof the repository is usable again.

## Don't

- **Don't trust the message.** Stash and branch labels describe intent at the time of writing, not
  reality now. Compare content.
- **Don't judge a candidate against a tree you have already applied it to.** Once an apply, pop or
  merge has touched the tree, every later comparison measures the candidate against itself and
  concludes "already present". Restore or snapshot the tree first, then compare.
- **Don't run bare `git stash pop`.** If your own `git stash push` had nothing to stash — files
  already clean or committed — **no entry is created**, and the bare `pop` takes *someone else's*
  stash off the top, applying unrelated work and leaving conflict markers. Pass an explicit
  `git stash apply <sha>`, and confirm a push actually created an entry before relying on it.
- **Don't dismiss a git warning because it names a file you were not thinking about.** "The stash
  entry is kept in case you need it again" means the apply conflicted. Check the whole tree —
  `git status`, then grep for conflict markers — not just the file you had in mind.
- **Don't restore a file wholesale** when its base has diverged. Patch it.
- **Don't delete without a recorded SHA**, and never another author's work without a clear yes.
- **Don't declare the sweep complete** while an item is UNKNOWN. Report it unresolved.
- **Don't stop at the verdicts and walk away.** A rescue that leaves the tree dirty just moved the
  problem: the next pull, branch switch or « Mettre à jour » is refused. Finish on an empty
  `git status`.
- **Don't read a silent reporting tool as "nothing stranded".** A reporter blind to detached
  worktrees reports zero forever. Verify it covers the categories in step 1.

## Reflexes

- **The default finding is DUPLICATE.** Parallel sessions and agents converge on the same fixes far
  more often than they lose work. Expect it; let evidence overturn it.
- **Recoverability before judgement.** Make everything reversible first, decide second. A wrong call
  you can undo is an inconvenience; a wrong call you cannot is a loss.
- **A clean apply is not a correct merge.** Text merging and meaning are unrelated.
- **Done means clean, not decided.** The last command of a salvage is `git status --porcelain`, and
  it is empty — or every remaining line is named and justified.
- **Taste belongs to the human.** Structure, tests and naming you can judge. Colours, thresholds and
  timings you cannot — surface them with the numbers side by side.
