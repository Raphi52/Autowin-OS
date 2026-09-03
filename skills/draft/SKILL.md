---
name: draft
description: Use when the user wants to DESIGN or iterate a UI/layout and the visual intent is NOT yet settled — "fais-moi une interface / un écran / une page", "propose des layouts", "je sais pas quel design", "itère sur le design", "trouve le bon agencement", "refais le look de X". Drives a VISUAL ELICITATION LOOP: diverge ~3 distinct directions as rendered mockups → user keeps/kills/mixes → refine → converge to explicit approval → port to target tech. TECH-NEUTRAL (web / WinForms / WPF). Do NOT use when the user already DESCRIBES the layout structure or hands a finished spec — that is an implementation order, go to `frontend-design` directly; nor for back-end/logic work.
---

# draft — visual elicitation through iterative mockups

## Purpose
Surface the user's REAL visual intent by SHOWING it, not guessing it (words are lossy; the user recognizes what they want when they SEE it). DIVERGE into distinct directions → render as comparable mockups → capture the choice → NARROW → converge to explicit approval → materialize the winner in target tech. NOT "produce one good UI" (that is `frontend-design`, INVOKED per variant). The new thing is the **convergence loop** (invariant); the render+capture backend is PLUGGABLE.

## When NOT to use (boundary with frontend-design)
- User already DESCRIBES the layout ("sidebar left, card grid, blue header") → spec → `frontend-design`.
- A finished design/spec to implement → `frontend-design`.
- Back-end / data / logic → not this skill.
Use only while visual intent is OPEN and worth diverging on.

## The loop (procedure)
1. **Frame the minimum** — which screen/surface, the REAL content, the TARGET TECH (web/WinForms/WPF — ASK if not obvious, never assume web), hard constraints (design system? responsive?). Do NOT over-frame the style — the loop discovers it.
2. **Read the user's taste FIRST from memory — BLOCKING, before drawing anything** (`brain_query` on the user's visual preferences; if the host has no memory tool, say so; fiche `[[feedback_portail_design_lineaire]]`), don't hardcode it — so divergence stays within the taste + its anti-patterns, and current if taste evolves.
3. **Diverge K=3 DISTINCT directions** (not cosmetic variants). Within taste guardrails, each MUST differ on **≥2 axes**: information density · typographic hierarchy · accent-color usage · spatial structure (grid/columns/cards) · motion/restraint. Invoke `frontend-design` for each direction's execution quality. Round 1 = broad divergence (layout + tone). **Shared vocabulary**: named directions/structures/details (Linéaire, editorial, dense, rail, hairline, status-stripe…) with rendered examples live in `design-glossary.html` (bundled) — use its terms; it marks the user's default direction + banned anti-patterns.
4. **Render + CAPTURE + READ** each direction (backend per tech, below). **Self-check BEFORE showing**: not broken (non-empty render, glyphs OK, no dead binding/layout) + taste guardrails respected. A capture not READ has no value.
5. **Present for CHOICE** (and ALWAYS with a fresh batch of 3 — see "Never stop proposing") — one side-by-side gallery artifact + ask **keep/kill/mix** (+ free comment). Prefer `AskUserQuestion` if available, else ask plainly. If user rejects all 3 → re-diverge differently, never re-offer the same set.
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
| **surface of a RUNNING app** (redesigning a part of a live app — chat bar, panel, toolbar) | inline render in the host chat | the live app IS the render target: **`desktop_observe`** the real screen, then draw at the REAL SCALE of that component (same width, same font sizes, same live colors read from its CSS/XAML). A thumbnail sketch 3x smaller than the real widget is NOT a mockup and misleads the user. |
| **host WITHOUT `Artifact`/Claude Preview** (e.g. an embedded agent chat) | inline HTML block supported by the host | those deferred MCP tools do NOT exist here — do not pretend to capture. Substitute: `desktop_observe` on the real surface, else state plainly "not observed". |

### Inline mockup recipes (host chat, no Preview) — MANDATORY
The inline renderer has NO emoji font and NO icon font. Every mockup icon/button MUST be built from these recipes, never from a pasted glyph:
- **Icons**: NEVER `📎 🎤 ↑ ◍ ◼ ⏎` as drawn objects. Use a lowercase monospace WORD (`fichier`, `micro`, `envoyer`) or an inline `<svg>` with `stroke="currentColor"`. Keyboard keys stay as text only inside a caption line, never as a button face.
- **Round/pill button**: centring by `inline-grid`+`place-items` is unreliable inside a flex row. Use exactly `display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:32px;height:32px;line-height:1;border-radius:50%` and put an `<svg>` (not a character) inside.
- **Self-check before showing**: re-read your own HTML and confirm zero emoji codepoints and zero character used as a button face. A mockup whose button renders wrong invalidates the whole round — the user judges the drawing, not the intent.

Note: `visualize.show_widget` renders INLINE in chat (presenting to user) — no PNG on disk, NOT a substitute for the READ self-check; use Claude Preview for that.

`capture-window.ps1` (bundled): generic (title/PID/exe), detects "exited early" crash + near-black renders. Ex: `powershell -NoProfile -File capture-window.ps1 -Exe "C:\proj\bin\Debug\App.exe" -KillFirst`.

## Taste guardrails
Read from memory at runtime (`[[feedback_portail_design_lineaire]]`), don't bake values here (would go stale). The fiche is the single source of truth. Guardrails BOUND the divergence, don't cancel it (3 directions stay distinct on ≥2 axes). Always validate against the read capture.

## Never stop proposing (conversation-wide invariant)
The loop does NOT end when a round is presented. As long as the user has NOT explicitly ordered the IMPLEMENTATION of one solution ("implémente celle-là", "go sur la 2", "code-la", explicit approval to build), EVERY reply in the conversation ends with a NEW batch of **3** proposals. This holds for the WHOLE conversation, across rounds, including after feedback, mixes, rejections, off-topic detours or a partial "j'aime bien la 2" — a preference is NOT an implementation order; keep proposing 3 refinements of it.
- Never reply with only comments, questions or an analysis: comment/ask AND propose 3.
- Never re-offer an identical batch: each new batch of 3 must differ (round 1 = broad divergence, later rounds = narrowing on the kept direction).
- The ONLY exit is the user's explicit go to implement (or an explicit "stop"). At that moment, freeze the spec and port (step 8).

## Caps
- K = **3** directions/round, **every round, until the user orders implementation** · target ~**4-5 rounds** (soft: keep proposing if the user keeps iterating) · variants generated in parallel.
- Closure = **explicit user approval** (attestable, not replayable — assumed honestly).

## Don't
- Do NOT reimplement `frontend-design` (per-variant quality) nor the `Artifact` tool — ORCHESTRATE them.
- Do NOT converge at random: respect the taste guardrails from memory.
- Do NOT show a mockup not CAPTURED+READ (dead binding/layout is invisible otherwise).
- Do NOT sketch a live app's surface from imagination or at reduced scale: READ its real style file (colors, sizes, spacing) and `desktop_observe` it FIRST — mockups drawn blind are the #1 source of "propositions douteuses".
- Do NOT declare "done" without explicit user approval.
- Do NOT stop proposing batches of 3 while no implementation order has been given — a reply without 3 new proposals is a failure of this skill.
- Do NOT assume the tech (web vs WinForms vs WPF) — ask.
- Implementing an ALREADY-settled design → `frontend-design` directly (not this loop).

## Engine & reflexes
- Parallel variant generation, loop-until-dry, dedup-by-core-idea → **ENGINE Ch.1 (GENERATE & GATE)**. Freeze→port handoff + code increments from the spec → **ENGINE Ch.4 (BUILD)**. On divergence, the engine wins.
- Reflex: a capture not READ has no value; closure of aesthetics is the human eye, not a self-judged "looks good".
