// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProfilesView } from './WorkflowProfilesView'

/**
 * PISTES 1 ET 3 (conv-1070) — la vue Workflows dit ce que chaque workflow a RÉELLEMENT donné, et
 * ce que veut dire « actif ».
 *
 * Piste 1 : la vue n'affichait que les bancs d'essai. L'entrée qui ferait échouer ce test si
 * l'affichage était faux : 3 runs INTERROMPUS (Stop, quota) — ils doivent rester hors du taux de
 * réussite (1 sur 2, pas 1 sur 5).
 *
 * Piste 3 : le workflow actif est imposé à TOUTES les demandes du chat et le choix automatique ne
 * joue pas tant qu'il l'est (`os.ts`, `poseConversationWorkflow`) ; la vue ne le disait que dans une
 * info-bulle. L'entrée qui ferait échouer ce test : aucun workflow actif — la phrase ne doit PAS
 * apparaître.
 */
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

const correctif = { id: 'correctif', name: 'Correctif', phases: ['build'] }

function api(reels: Record<string, unknown>, activeId: string | null = null): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [correctif], activeId }),
      workflowProfileSelect: vi.fn(),
      workflowProfileRemove: vi.fn(),
      workflowProfileSave: vi.fn(),
      arenaDuelsParWorkflow: vi.fn().mockResolvedValue({}),
      workflowResultatsReels: vi.fn().mockResolvedValue(reels)
    }
  })
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WorkflowProfilesView, { active: true }))
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('vue Workflows — résultats réels', () => {
  it('compte aboutis et échecs, met les interruptions HORS du taux', async () => {
    api({
      Correctif: {
        runs: 6,
        abouties: 1,
        echecs: 1,
        interrompues: 3,
        nonCloses: 1,
        dureeMedianeMs: 180_000,
        coutMedianUsd: 3
      }
    })
    await render()
    const ligne = container.querySelector('[data-testid="workflow-reels-correctif"]')
    expect(ligne).not.toBeNull()
    const texte = ligne?.textContent ?? ''
    expect(texte).toContain('6 runs')
    expect(texte).toContain('1 abouti')
    expect(texte).toContain('1 en échec')
    expect(texte).toContain('50 %')
    expect(texte).toMatch(/3 interrompus.*hors taux/)
    expect(texte).toContain('1 non clos')
    expect(texte).toMatch(/3\s?min médian/)
    expect(texte).toContain('3,00 $')
  })

  it('dit « aucun run » au lieu d’un zéro quand le workflow n’a jamais tourné', async () => {
    api({ Autre: { runs: 2, abouties: 2, echecs: 0, interrompues: 0, nonCloses: 0 } })
    await render()
    const texte =
      container.querySelector('[data-testid="workflow-reels-correctif"]')?.textContent ?? ''
    expect(texte).toMatch(/aucun run/i)
    expect(texte).not.toContain('%')
  })

  it('un workflow actif est dit IMPOSÉ à toutes les demandes, à la place du choix automatique', async () => {
    api({}, 'correctif')
    await render()
    const phrase = container.querySelector('[data-testid="workflow-active-imposed"]')
    expect(phrase?.textContent ?? '').toMatch(/Correctif.*imposé à toutes les demandes/)
    expect(phrase?.textContent ?? '').toMatch(/choix automatique/)
  })

  it('aucun workflow actif : aucune phrase d’imposition', async () => {
    api({}, null)
    await render()
    expect(container.querySelector('[data-testid="workflow-active-imposed"]')).toBeNull()
  })
})
