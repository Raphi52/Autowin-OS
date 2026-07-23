// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StepThread } from './ChatView.parts'
import type { OrchStep } from './chat-view-model'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(steps: OrchStep[]): void {
  act(() => root.render(createElement(StepThread, { steps })))
}

describe('StepThread — preuves d’exécution inline', () => {
  it('affiche la commande, le exit-code et le stdout d’une command_execution', () => {
    render([
      {
        step: 'exec',
        evidence: [
          {
            type: 'command_execution',
            kind: 'verification',
            ok: true,
            summary: 'x',
            command: 'npx vitest run',
            exitCode: 0,
            stdout: '12 passed'
          }
        ]
      }
    ])
    const txt = container.textContent ?? ''
    expect(txt).toContain('npx vitest run')
    expect(txt).toContain('exit 0')
    expect(txt).toContain('12 passed')
  })

  it('affiche le chemin et le diff d’un file_change, avec lignes +/- classées', () => {
    render([
      {
        step: 'exec',
        evidence: [
          {
            type: 'file_change',
            kind: 'mutation',
            ok: true,
            summary: 'x',
            path: 'src/a.ts',
            diff: '+ ligne ajoutée\n- ligne retirée'
          }
        ]
      }
    ])
    const txt = container.textContent ?? ''
    expect(txt).toContain('src/a.ts')
    expect(txt).toContain('ligne ajoutée')
    // Les lignes + / - portent bien les classes de coloration diff.
    expect(container.querySelector('.diff-add')).not.toBeNull()
    expect(container.querySelector('.diff-del')).not.toBeNull()
  })

  it('un step sans evidence ne rend aucun bloc de preuve (rétrocompat)', () => {
    render([{ step: 'exec', text: 'juste du texte' }])
    expect(container.querySelector('.evidence-list')).toBeNull()
  })

  it('un step en ÉCHEC est rendu distinctement (classe failed + pill + cause)', () => {
    render([{ step: 'exec', status: 'failed', error: 'timeout du sous-agent' }])
    expect(container.querySelector('.subagent-step.failed')).not.toBeNull()
    expect(container.querySelector('.subagent-failed-pill')).not.toBeNull()
    expect((container.textContent ?? '')).toContain('timeout du sous-agent')
  })

  it('un step réussi n’a NI classe failed NI cause (rétrocompat)', () => {
    render([{ step: 'exec', status: 'completed', text: 'ok' }])
    expect(container.querySelector('.subagent-step.failed')).toBeNull()
    expect(container.querySelector('.subagent-error')).toBeNull()
  })

  it('le raisonnement (thinking) est consultable en details, pas jeté', () => {
    render([{ step: 'exec', thinking: 'je pèse A contre B', text: 'réponse' }])
    const details = container.querySelector('.subagent-thinking')
    expect(details).not.toBeNull()
    expect((container.textContent ?? '')).toContain('je pèse A contre B')
  })

  it('les membres d’un fan-out sont rendus en grille côte à côte (N colonnes)', () => {
    render([
      { step: 'exec', role: 'subagent', model: 'opus', detail: 'phase frame · modèle opus', text: 'idée A' },
      { step: 'exec', role: 'subagent', model: 'codex', detail: 'phase frame · modèle codex', text: 'idée B' }
    ])
    const grid = container.querySelector('.fanout-grid')
    expect(grid).not.toBeNull()
    expect(grid?.getAttribute('data-count')).toBe('2')
    expect(grid?.querySelectorAll('.subagent-step').length).toBe(2)
    const txt = container.textContent ?? ''
    expect(txt).toContain('idée A')
    expect(txt).toContain('idée B')
  })

  it('un step mono n’est PAS mis en grille (rétrocompat)', () => {
    render([{ step: 'exec', role: 'subagent', detail: 'phase build', text: 'seul' }])
    expect(container.querySelector('.fanout-grid')).toBeNull()
    expect(container.querySelector('.subagent-step')).not.toBeNull()
  })

  it('en-tête : le modèle prime sur le provider quand les deux sont présents (précédence figée)', () => {
    render([{ step: 'exec', role: 'subagent', model: 'claude-opus-4-8', provider: 'claude', text: 'x' }])
    const header = container.querySelector('.subagent-step .mono')
    expect(header?.textContent).toBe('claude-opus-4-8')
  })

  it('en-tête : sans modèle, on retombe sur le provider (mono inchangé)', () => {
    render([{ step: 'exec', role: 'subagent', provider: 'codex', text: 'x' }])
    const header = container.querySelector('.subagent-step .mono')
    expect(header?.textContent).toBe('codex')
  })
})
