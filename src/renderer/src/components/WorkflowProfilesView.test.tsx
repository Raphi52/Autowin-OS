// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileSummary, WorkflowProfilesView } from './WorkflowProfilesView'

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

const rapide = {
  id: 'rapide',
  name: 'Rapide',
  roles: { subagent: { model: 'petit', reasoningEffort: 'low' } },
  phases: ['build'],
  allocation: { judgeMembers: 1 }
}

function api(overrides: Record<string, unknown> = {}): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null }),
      workflowProfileSelect: vi.fn(),
      workflowProfileRemove: vi.fn(),
      workflowProfileSave: vi.fn(),
      ...overrides
    }
  })
}

async function render(active = true): Promise<void> {
  await act(async () => {
    root.render(createElement(WorkflowProfilesView, { active }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Choisir une façon de travailler. Sans cette vue, modèles, phases et consignes vivent à trois
 * endroits et aucun nom ne les rassemble — donc rien n'est comparable.
 */
describe('vue Workflows — lister et sélectionner', () => {
  it('liste les workflows enregistrés avec ce qu’ils changent', async () => {
    api()
    await render()
    const ligne = container.querySelector('[data-testid="workflow-profile-rapide"]')
    // Le nom est un champ éditable depuis qu'on peut renommer sur place : sa valeur ne se lit donc
    // plus dans le texte de la ligne.
    const nom = container.querySelector<HTMLInputElement>('[data-testid="workflow-rename-rapide"]')
    expect(nom?.value).toBe('Rapide')
    expect(ligne?.textContent).toContain('petit') // le modèle imposé est visible sans ouvrir
  })

  // Défaut vu par l'utilisateur DANS L'APPLICATION, invisible aux tests d'alors : le badge « actif »
  // n'était rendu que sur les profils. Revenir à « Configuration courante » le faisait disparaître
  // partout — plus rien ne disait sous quel régime le chat allait tourner.
  it('quand aucun workflow n’est imposé, AUCUN n’est marqué actif', async () => {
    // La ligne « Configuration courante » a été retirée : l'absence de workflow ne se signale plus
    // par un badge à elle, elle se lit à ce qu'aucune ligne ne porte le badge. L'assertion suit le
    // même invariant qu'avant — savoir sous quel régime le chat tourne — par un autre repère.
    api({
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null })
    })
    await render()
    expect(container.querySelector('[data-testid="workflow-pick-rapide"]')!.getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toContain('actif')
  })

  it('… et il passe sur le profil dès qu’un workflow est activé', async () => {
    api({
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [rapide], activeId: rapide.id })
    })
    await render()
    expect(container.querySelector('[data-testid="workflow-active-none"]')).toBeNull()
    const ligne = container.querySelector('[data-testid="workflow-profile-rapide"]')
    expect(ligne?.textContent).toContain('actif')
  })

  it('permet TOUJOURS de revenir à « aucun workflow imposé »', async () => {
    // La capacité que gardait l'ancienne ligne « Configuration courante » : sans elle, sélectionner
    // un workflow serait irréversible depuis la vue. Le chemin a changé — re-cliquer le workflow
    // actif le désélectionne — mais l'invariant est le même, et c'est LUI qu'on teste.
    const select = vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null })
    api({
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [rapide], activeId: rapide.id }),
      workflowProfileSelect: select
    })
    await render()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-pick-rapide"]')!.click()
    )

    expect(select).toHaveBeenCalledWith(null)
  })

  it('décocher un workflow le retire du choix automatique sans le supprimer', async () => {
    const save = vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null })
    api({ workflowProfileSave: save })
    await render()

    const case_ = container.querySelector<HTMLInputElement>('[data-testid="workflow-enabled-rapide"]')!
    expect(case_.checked).toBe(true) // `enabled` absent vaut invocable
    // `.click()` et non `.checked = false` : React suit la valeur des cases par un tracker interne,
    // qu'une écriture directe contourne — l'évènement part, mais React le considère sans changement.
    await act(async () => case_.click())

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'rapide', enabled: false }))
  })

  it('sélectionner un workflow l’enregistre et le marque actif', async () => {
    const select = vi.fn().mockResolvedValue({ profiles: [rapide], activeId: 'rapide' })
    api({ workflowProfileSelect: select })
    await render()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-pick-rapide"]')!.click()
    )

    expect(select).toHaveBeenCalledWith('rapide')
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-pick-rapide"]')!
        .getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('ne charge RIEN tant que la vue n’est pas ouverte', async () => {
    const lecture = vi.fn().mockResolvedValue({ profiles: [], activeId: null })
    api({ workflowProfiles: lecture })
    await render(false)
    expect(lecture).not.toHaveBeenCalled()
  })

  it('aucun workflow : on explique quoi faire au lieu d’afficher une liste vide', async () => {
    api({ workflowProfiles: vi.fn().mockResolvedValue({ profiles: [], activeId: null }) })
    await render()
    expect(container.querySelector('[data-testid="workflow-empty"]')?.textContent).toContain(
      'Crée-en un'
    )
  })

  it('une lecture en échec est DITE, pas silencieuse', async () => {
    api({ workflowProfiles: vi.fn().mockRejectedValue(new Error('disque')) })
    await render()
    expect(container.textContent).toContain('Impossible de lire les workflows')
  })

  it('donne accès à la confrontation — le moteur ne sert à rien s’il n’est pas atteignable', async () => {
    // Cette vue annonçait « ne pilote pas encore l'exécution » ; elle le pilote maintenant, et c'est
    // par ce panneau. Un panneau non monté rendrait tout le banc injoignable.
    api()
    await render()
    expect(container.querySelector('[data-testid="workflow-bench"]')).not.toBeNull()
    expect(container.textContent).not.toContain('ne pilote pas encore')
  })
})

describe('résumé d’un workflow', () => {
  it('dit ce qu’il change, pas ce qu’il contient', () => {
    expect(profileSummary(rapide)).toContain('subagent petit low')
    expect(profileSummary(rapide)).toContain('1 juge(s)')
  })

  it('un workflow sans écart est légitime et le dit — c’est la référence de comparaison', () => {
    expect(profileSummary({ id: 'ref', name: 'Référence' })).toBe(
      'aucun écart — configuration courante'
    )
  })

  it('distingue une consigne ajoutée d’un remplacement des skills', () => {
    expect(
      profileSummary({ id: 'a', name: 'A', instructions: { mode: 'append', text: 'court' } })
    ).toContain('consigne ajoutée')
    expect(
      profileSummary({ id: 'b', name: 'B', instructions: { mode: 'replace', text: 'ma méthode' } })
    ).toContain('consignes remplacées')
  })
})
