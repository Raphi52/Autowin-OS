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
})
