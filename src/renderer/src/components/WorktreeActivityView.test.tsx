// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeActivityView } from './WorktreeActivityView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function render(props: Parameters<typeof WorktreeActivityView>[0]): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(WorktreeActivityView, props)))
}

const merged: WorktreeAgentActivity = {
  agentId: 'a1',
  agentName: 'Scout',
  state: 'merged',
  files: [
    { path: 'orchestrator.ts', kind: 'mod' },
    { path: 'worktree-ui.tsx', kind: 'add' }
  ],
  startedAtMs: 1000,
  endedAtMs: 2000
}
const conflict: WorktreeAgentActivity = {
  agentId: 'a2',
  agentName: 'Judge',
  state: 'conflict',
  files: [{ path: 'os.ts', kind: 'mod' }],
  startedAtMs: 3000,
  endedAtMs: 4000,
  conflictWith: ['Builder'],
  conflictFile: 'os.ts'
}
const blocked: WorktreeAgentActivity = {
  agentId: 'a3',
  agentName: 'Builder',
  state: 'blocked',
  files: [{ path: 'os.ts', kind: 'mod' }],
  startedAtMs: 5000,
  endedAtMs: 6000,
  attentionReason: 'base-dirty'
}

describe('WorktreeActivityView (Mix 2)', () => {
  it('rend une lane de frise par agent + le journal', () => {
    render({ agents: [merged, conflict], nowMs: 5000 })
    expect(container.querySelectorAll('[data-testid="wt-lane"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="wt-jrow"]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="wt-frieze"]')).toBeTruthy()
  })

  it('colore la lane selon l’issue (merged/conflict)', () => {
    render({ agents: [merged, conflict], nowMs: 5000 })
    const outcomes = Array.from(container.querySelectorAll('[data-testid="wt-lane"]')).map((l) =>
      l.getAttribute('data-outcome')
    )
    expect(outcomes).toContain('merged')
    expect(outcomes).toContain('conflict')
  })

  it('affiche le badge conflit + bouton, et déclenche onResolveConflict', () => {
    const onResolve = vi.fn()
    render({ agents: [conflict], nowMs: 5000, onResolveConflict: onResolve })
    const btn = container.querySelector('.wt-btn') as HTMLButtonElement
    expect(btn).toBeTruthy()
    expect(container.textContent).toContain('À toi de trancher')
    act(() => btn.click())
    expect(onResolve).toHaveBeenCalledWith('a2')
  })

  it('affiche les changements locaux comme un blocage sans faux bouton de conflit', () => {
    render({ agents: [blocked], nowMs: 7000 })

    expect(container.querySelector('[data-outcome="blocked"]')).toBeTruthy()
    expect(container.querySelector('.wt-badge-blocked')).toBeTruthy()
    expect(container.textContent).toContain('changements locaux')
    expect(container.querySelector('.wt-btn')).toBeNull()
  })

  it('affiche une opération préexistante comme prioritaire sans faux conflit', () => {
    render({
      agents: [{ ...blocked, attentionReason: 'base-in-progress' }],
      nowMs: 7000
    })

    expect(container.textContent).toContain('ta branche est déjà occupée')
    expect(container.querySelector('.wt-badge-blocked')?.textContent).toContain(
      'ton travail en cours passe d’abord'
    )
    expect(container.querySelector('.wt-btn')).toBeNull()
  })

  it('affiche une copie rangée sans prétendre à une fusion quand aucun fichier n’a changé', () => {
    render({ agents: [{ ...merged, files: [] }], nowMs: 5000 })

    expect(container.textContent).toContain('Aucun changement · copie rangée')
    expect(container.textContent).not.toContain('Fusionné tout seul')
    expect(container.textContent).not.toContain('ajouté à ton code')
  })

  it('résume le nombre de copies en attente dans l’en-tête', () => {
    render({ agents: [merged, conflict], nowMs: 5000 })
    expect(container.textContent).toContain('attend ta décision')
  })

  it('aucun jargon git dans le rendu', () => {
    render({ agents: [merged, conflict], nowMs: 5000 })
    expect(container.textContent).not.toMatch(/HEAD|detached|rebase|checkout|git merge/i)
  })

  it('état vide → message pédagogique, pas de frise', () => {
    render({ agents: [] })
    expect(container.querySelector('[data-testid="wt-frieze"]')).toBeNull()
    expect(container.textContent).toContain('Aucune copie en cours')
  })
})
