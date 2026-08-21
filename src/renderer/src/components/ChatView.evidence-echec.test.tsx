// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SubAgentStep } from './ChatView.parts'
import type { OrchStep } from './chat-view-model'

let container: HTMLDivElement
let root: Root
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('SubAgentStep — un sous-agent en ÉCHEC montre ce qu il a fait', () => {
  it('rend les actions d une étape failed, pas seulement son message d erreur', () => {
    // Mesuré le 2026-08-21 : sur les 60 traces les plus récentes, un sous-agent `completed` affiche
    // ses actions 38 fois sur 39 et un sous-agent `failed` 0 fois sur 9. Le main les persiste
    // desormais (evidence portee par l'erreur) ; ce test epingle le fait que l'affichage ne les
    // filtre PAS sur le statut — sinon la boite reste noire exactement quand ca casse.
    const step: OrchStep = {
      step: 'exec',
      role: 'subagent',
      status: 'failed',
      error: 'le sous-agent est mort en route',
      evidence: [
        {
          type: 'Grep',
          kind: 'inspection',
          status: 'completed',
          ok: true,
          summary: 'Grep -rn cadrage src/'
        } as never
      ]
    }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(createElement(SubAgentStep, { step })))

    expect(container.textContent).toContain('mort en route')
    expect(container.textContent).toContain('Grep -rn cadrage')
  })
})
