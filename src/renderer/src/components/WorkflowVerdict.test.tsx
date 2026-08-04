// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkflowVerdict, type WorkflowVerdictProps } from './WorkflowVerdict'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(props: Partial<WorkflowVerdictProps> = {}): void {
  act(() => {
    root.render(
      createElement(WorkflowVerdict, {
        objective: 'ranger la cuisine',
        rationale: 'vif aboutit pour 1.00 $',
        rows: [
          { profileId: 'vif', profileName: 'Vif', green: true, comparableCostUsd: 1, totalTokens: 12000 },
          { profileId: 'lent', profileName: 'Lent', green: true, comparableCostUsd: 3 }
        ],
        recommendedProfileId: 'vif',
        ...props
      })
    )
  })
}

const texte = (sel: string): string => container.querySelector(sel)?.textContent ?? ''

describe('tableau verdict', () => {
  it('affiche une ligne par workflow et signale le recommandé', () => {
    render()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(texte('[data-testid="verdict-row-vif"]')).toContain('recommandé')
    expect(texte('[data-testid="verdict-row-lent"]')).not.toContain('recommandé')
  })

  it('un coût inconnu s’affiche « — », JAMAIS 0,00 $', () => {
    render({
      rows: [{ profileId: 'a', profileName: 'A', green: true, comparableCostUsd: null }],
      recommendedProfileId: undefined
    })
    const ligne = texte('[data-testid="verdict-row-a"]')
    expect(ligne).toContain('—')
    expect(ligne).not.toContain('0.00')
  })

  it('la réserve est LISIBLE sur la ligne, pas enterrée en note', () => {
    render({
      rows: [
        {
          profileId: 'partiel',
          profileName: 'Partiel',
          green: true,
          comparableCostUsd: null,
          caveat: 'coût partiel — 3 appel(s) non tarifé(s)'
        }
      ]
    })
    expect(texte('[data-testid="verdict-row-partiel"]')).toContain('3 appel(s) non tarifé(s)')
  })

  it('dit qu’un run n’a pas abouti', () => {
    render({ rows: [{ profileId: 'ko', profileName: 'KO', green: false, comparableCostUsd: null }] })
    expect(texte('[data-testid="verdict-row-ko"] + td, [data-testid="verdict-row-ko"] td')).toContain(
      'non'
    )
  })

  it('annonce les workflows non lancés plutôt que de faire comme s’ils n’existaient pas', () => {
    render({ skipped: ['prudent'] })
    expect(texte('.workflow-verdict-skipped')).toContain('prudent')
  })

  it('sans interruption, aucune mention de non-lancés', () => {
    render({ skipped: [] })
    expect(container.querySelector('.workflow-verdict-skipped')).toBeNull()
  })

  it('affiche l’objectif et la raison du classement', () => {
    render()
    expect(texte('.workflow-verdict-title')).toContain('ranger la cuisine')
    expect(texte('.workflow-verdict-rationale')).toContain('1.00 $')
  })
})
