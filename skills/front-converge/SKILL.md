---
name: front-converge
description: Use when the user wants to DESIGN or iterate a UI/layout and the visual intent is NOT yet settled — "fais-moi une interface / un écran / une page", "propose des layouts", "je sais pas quel design", "itère sur le design", "trouve le bon agencement", "refais le look de X". Drives a VISUAL ELICITATION LOOP: diverge ~3 distinct directions as rendered mockups → user keeps/kills/mixes → refine → converge to explicit approval → port to target tech. TECH-NEUTRAL (web / WinForms / WPF). Do NOT use when the user already DESCRIBES the layout structure or hands a finished spec — that is an implementation order, go to `frontend-design` directly; nor for back-end/logic work.
---

# front-converge — visual elicitation through iterative mockups

## Purpose
Surface the user's REAL visual intent by SHOWING it, not guessing it (words are lossy; the user recognizes what they want when they SEE it). DIVERGE into distinct directions → render as comparable mockups → capture the choice → NARROW → converge to explicit approval → materialize the winner in target tech. NOT "produce one good UI" (that is `frontend-design`, INVOKED per variant). The new thing is the **convergence loop** (invariant); the render+capture backend is PLUGGABLE.

## When NOT to use (boundary with frontend-design)
- User already DESCRIBES the layout ("sidebar left, card grid, blue header") → spec → `frontend-design`.
- A finished design/spec to implement → `frontend-design`.
- Back-end / data / logic → not this skill.
Use only while visual intent is OPEN and worth diverging on.

## The loop (procedure)
1. **Frame the minimum** — which screen/surface, the REAL content, the TARGET TECH (web/WinForms/WPF — ASK if not obvious, never assume web), hard constraints (design system? responsive?). Do NOT over-frame the style — the loop discovers it.
2. **Read the user's taste FIRST from memory** (`[[feedback_portail_design_lineaire]]`), don't hardcode it — so divergence stays within the taste + its anti-patterns, and current if taste evolves.
3. **Diverge K=3 DISTINCT directions** (not cosmetic variants). Within taste guardrails, each MUST differ on **≥2 axes**: information density · typographic hierarchy · accent-color usage · spatial structure (grid/columns/cards) · motion/restraint. Invoke `frontend-design` for each direction's execution quality. Round 1 = broad divergence (layout + tone). **Shared vocabulary**: named directions/structures/details (Linéaire, editorial, dense, rail, hairline, status-stripe…) with rendered examples live in `design-glossary.html` (bundled) — use its terms; it marks the user's default direction + banned anti-patterns.
4. **Render + CAPTURE + READ** each direction (backend per tech, below). **Self-check BEFORE showing**: not broken (non-empty render, glyphs OK, no dead binding/layout) + taste guardrails respected. A capture not READ has no value.
5. **Present for CHOICE** — one side-by-side gallery artifact + ask **keep/kill/mix** (+ free comment). Prefer `AskUserQuestion` if available, else ask plainly. If user rejects all 3 → re-diverge differently, never re-offer the same set.
6. **Narrow** — refine the kept direction + GRAFT liked parts of others. Later rounds = narrowing (style/density/detail), not broad divergence.
7. **Converge → STOP at EXPLICIT user approval** (never auto-stop: aesthetics not auto-provable). Cap ~4-5 rounds; if no convergence → "lock the layout, iterate only style" or raise back to user.
8. **Freeze + PORT** — produce a design spec (below), hand to `frontend-design`/`build` for implementation. This skill doesn't rewrite the implementation engine; it delivers the settled design and ports it.

### Design-spec template (the freeze handed to the port)
```
TARGET TECH : web (React/Next…) | WinForms | WPF
LAYOUT      : grid/structure (regions + placement)
TOKENS      : colors (bg/surface/accent/text) · typography (display/body) · spacing scale · radius
TONE        : chosen aesthetic direction in one line
GUARDRAILS  : taste rules that must hold (from memory)
KEPT/KILLED : elements grafted in, elements rejected
```
**Porting notes per tech** (HTML mockup conveys layout + intent, not pixel-exact):
- **web** → pass HTML Artifact + spec to `frontend-design` (closest target).
- **WPF** → layout to `Grid`/`StackPanel`/`DockPanel`; tokens to `ResourceDictionary` (brushes, styles); drop web-only effects. **MANDATORY**: ≥1 real-render capture (build → `capture-window.ps1` → Read) before presenting — HTML can't faithfully represent native control layout.
- **WinForms** → map to `TableLayoutPanel`/`FlowLayoutPanel`/`Panel`; ignore CSS; same MANDATORY real-render capture.

## Render+capture backends (pluggable per tech)
| Target | Render | Capture READ by Claude |
|---|---|---|
| **web / HTML** | `Artifact` tool (self-contained page) | render locally with **Claude Preview** and screenshot. Deferred tools — load first: `ToolSearch "select:mcp__Claude_Preview__preview_start,mcp__Claude_Preview__preview_screenshot,mcp__Claude_Preview__preview_stop"`. Per-round cycle: `preview_start` → `preview_screenshot` → **Read** PNG → **`preview_stop`** (always stop before next round, else a stale preview blocks the next `preview_start`) |
| **WPF / WinForms** | build + launch the project | `capture-window.ps1` (bundled): `-Exe <path>` / `-WindowTitle <substring>` / `-ProcId <pid>` → PrintWindow → PNG → **Read** |
| any target | per-variant quality | invoke `frontend-design` (do NOT reimplement) |

Note: `visualize.show_widget` renders INLINE in chat (presenting to user) — no PNG on disk, NOT a substitute for the READ self-check; use Claude Preview for that.

`capture-window.ps1` (bundled): generic (title/PID/exe), detects "exited early" crash + near-black renders. Ex: `powershell -NoProfile -File capture-window.ps1 -Exe "C:\proj\bin\Debug\App.exe" -KillFirst`.

## Taste guardrails
Read from memory at runtime (`[[feedback_portail_design_lineaire]]`), don't bake values here (would go stale). The fiche is the single source of truth. Guardrails BOUND the divergence, don't cancel it (3 directions stay distinct on ≥2 axes). Always validate against the read capture.

## Caps
- K = **3** directions/round · cap ~**4-5 rounds** · variants generated in parallel.
- Closure = **explicit user approval** (attestable, not replayable — assumed honestly).

## Don't
- Do NOT reimplement `frontend-design` (per-variant quality) nor the `Artifact` tool — ORCHESTRATE them.
- Do NOT converge at random: respect the taste guardrails from memory.
- Do NOT show a mockup not CAPTURED+READ (dead binding/layout is invisible otherwise).
- Do NOT declare "done" without explicit user approval.
- Do NOT assume the tech (web vs WinForms vs WPF) — ask.
- Implementing an ALREADY-settled design → `frontend-design` directly (not this loop).

## Engine & reflexes
- Parallel variant generation, loop-until-dry, dedup-by-core-idea → **ENGINE Ch.1 (GENERATE & GATE)**. Freeze→port handoff + code increments from the spec → **ENGINE Ch.4 (BUILD)**. On divergence, the engine wins.
- Reflex: a capture not READ has no value; closure of aesthetics is the human eye, not a self-judged "looks good".
