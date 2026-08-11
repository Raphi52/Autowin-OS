// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProfilesView } from './WorkflowProfilesView'
import { workflowIssues } from './workflow-executability'
import { profileSummary } from './workflow-profile-summary'

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
    expect(
      container.querySelector('[data-testid="workflow-pick-rapide"]')!.getAttribute('aria-pressed')
    ).toBe('false')
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

    const case_ = container.querySelector<HTMLInputElement>(
      '[data-testid="workflow-enabled-rapide"]'
    )!
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
      container
        .querySelector<HTMLButtonElement>('[data-testid="workflow-pick-rapide"]')!
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

/** Écrire `input.value` contourne le tracker interne de React : on passe par le setter natif. */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(champ, valeur)
  champ.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('vue Workflows — renommer sans écrire à chaque frappe', () => {
  afterEach(() => vi.useRealTimers())

  it('cinq frappes ne produisent QU’UN enregistrement, avec le nom final', async () => {
    // Défaut : l'input était piloté par `profile.name` et appelait `workflowProfileSave` dans son
    // `onChange` — une écriture IPC PAR CARACTÈRE, donc cinq courses d'écriture pour « Rapid ».
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null })
    api({ workflowProfileSave: save })
    await render()

    const champ = container.querySelector<HTMLInputElement>(
      '[data-testid="workflow-rename-rapide"]'
    )!
    for (const valeur of ['R', 'Ra', 'Rap', 'Rapi', 'Rapid']) {
      await act(async () => saisir(champ, valeur))
    }
    // Avant la retombée du debounce : rien n'est encore parti.
    expect(save).not.toHaveBeenCalled()
    // La frappe reste à l'écran — c'est l'état local qui pilote le champ.
    expect(champ.value).toBe('Rapid')

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'rapide', name: 'Rapid' }))
  })

  it('un renommage rejeté le DIT et rend le nom persisté (rollback visible)', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValue(new Error('EACCES workflows.json'))
    api({ workflowProfileSave: save })
    await render()

    const champ = container.querySelector<HTMLInputElement>(
      '[data-testid="workflow-rename-rapide"]'
    )!
    await act(async () => saisir(champ, 'Foudre'))
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'EACCES workflows.json'
    )
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="workflow-rename-rapide"]')!.value
    ).toBe('Rapide')
  })
})

describe('vue Workflows — un échec dit POURQUOI', () => {
  it.each([
    ['workflowProfileSave', 'workflow-enabled-rapide'],
    ['workflowProfileSelect', 'workflow-pick-rapide']
  ])('%s : la raison IPC réelle atteint l’alerte', async (canal, testid) => {
    // Défaut : des `catch {}` remplaçaient la raison par « L'enregistrement a échoué ». Disque
    // plein, fichier verrouillé, schéma refusé — tout se lisait pareil, donc rien de diagnostiquable.
    api({ [canal]: vi.fn().mockRejectedValue(new Error('disque plein')) })
    await render()
    await act(async () =>
      container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click()
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('disque plein')
  })

  it('une lecture en échec nomme la raison au lieu d’une phrase passe-partout', async () => {
    api({ workflowProfiles: vi.fn().mockRejectedValue(new Error('EPERM roles.json')) })
    await render()
    expect(container.textContent).toContain('EPERM roles.json')
  })
})

describe('exécutabilité d’un workflow', () => {
  it('un workflow sain ne signale rien', () => {
    expect(workflowIssues(rapide)).toEqual([])
  })

  it('remonte une phase que rien ne sait jouer', () => {
    expect(workflowIssues({ id: 'x', name: 'X', phases: ['brainstorm'] })).toEqual([
      'phase inconnue : brainstorm'
    ])
  })

  it('remonte l’arête orpheline que la portée ignorait en silence', () => {
    // `WorkflowTrack` faisait `return null` sur une arête dont un bout n'existe pas : le graphe
    // paraissait sain alors qu'un retour ne menait nulle part.
    const issues = workflowIssues({
      id: 'x',
      name: 'X',
      graph: {
        nodes: [{ id: 'n1', phase: 'build', agents: [{ id: 'a' }] }],
        edges: [{ from: 'n1', to: 'disparu', when: 'fail' }]
      } as never
    })
    expect(issues).toEqual(['arête orpheline : n1 → disparu (cible inconnue)'])
  })

  it('un workflow sans phase ne peut rien jouer et le dit', () => {
    expect(workflowIssues({ id: 'x', name: 'X' })[0]).toContain('aucune phase')
  })

  it('l’activation est REFUSÉE tant qu’un workflow n’est pas exécutable', async () => {
    const casse = { id: 'casse', name: 'Cassé', phases: ['brainstorm'] }
    const select = vi.fn()
    api({
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [casse], activeId: null }),
      workflowProfileSelect: select
    })
    await render()

    const pick = container.querySelector<HTMLButtonElement>('[data-testid="workflow-pick-casse"]')!
    expect(pick.disabled).toBe(true)
    expect(container.querySelector('[data-testid="workflow-unrunnable-casse"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workflow-issues-casse"]')?.textContent).toContain(
      'brainstorm'
    )
    await act(async () => pick.click())
    expect(select).not.toHaveBeenCalled()
  })
})

describe('vue Workflows — gestes séparés et suppression confirmée', () => {
  it('l’éditeur s’ouvre SANS imposer le workflow au chat', async () => {
    const select = vi.fn()
    api({ workflowProfileSelect: select })
    await render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-edit-rapide"]')!.click()
    )
    expect(select).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-testid="workflow-edit-rapide"]')!.getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('supprimer demande confirmation — le premier clic n’efface rien', async () => {
    const remove = vi.fn().mockResolvedValue({ profiles: [], activeId: null })
    api({ workflowProfileRemove: remove })
    await render()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-remove-rapide"]')!.click()
    )
    expect(remove).not.toHaveBeenCalled()
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workflow-remove-confirm-rapide"]')!
        .click()
    )
    expect(remove).toHaveBeenCalledWith('rapide')
  })

  it('créer après suppression d’un workflow intermédiaire n’écrase aucun workflow existant', async () => {
    // Défaut : `id = workflow-${profiles.length + 1}`. Avec 3 workflows, supprimer le 2e ramène la
    // longueur à 2 → « Nouveau » régénère `workflow-3`, qui ÉCRASE le workflow existant.
    const profils = ['workflow-1', 'workflow-2', 'workflow-3'].map((id) => ({
      ...rapide,
      id,
      name: id
    }))
    let fichier = { profiles: profils, activeId: null as string | null }
    const save = vi.fn(async (profile: { id: string; name: string }) => {
      const index = fichier.profiles.findIndex((p) => p.id === profile.id)
      const suivant =
        index >= 0
          ? fichier.profiles.map((p, i) => (i === index ? { ...p, ...profile } : p))
          : [...fichier.profiles, { ...rapide, ...profile }]
      fichier = { ...fichier, profiles: suivant }
      return fichier
    })
    api({
      workflowProfiles: vi.fn(async () => fichier),
      workflowProfileRemove: vi.fn(async (id: string) => {
        fichier = { ...fichier, profiles: fichier.profiles.filter((p) => p.id !== id) }
        return fichier
      }),
      workflowProfileSave: save
    })
    await render()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workflow-remove-workflow-2"]')!
        .click()
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="workflow-remove-confirm-workflow-2"]')!
        .click()
    )
    expect(fichier.profiles).toHaveLength(2)

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="workflow-create"]')!.click()
    )

    const ids = fichier.profiles.map((p) => p.id)
    expect(fichier.profiles).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain('workflow-3')
  })

  it('annonce le chargement des workflows au lieu de ne rien rendre', async () => {
    let resoudre!: (value: unknown) => void
    const attente = new Promise((done) => {
      resoudre = done
    })
    api({ workflowProfiles: vi.fn(() => attente) })
    await render()

    const chargement = container.querySelector('[data-testid="workflow-loading"]')
    expect(chargement).not.toBeNull()
    expect(chargement?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('[data-testid="workflow-empty"]')).toBeNull()

    await act(async () => {
      resoudre({ profiles: [rapide], activeId: null })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="workflow-loading"]')).toBeNull()
    expect(container.querySelector('[data-testid="workflow-profile-rapide"]')).not.toBeNull()
  })

  it('le bouton destructif ne porte pas la même apparence qu’Exporter', async () => {
    api()
    await render()
    const exporter = container.querySelector('[data-testid="workflow-export-rapide"]')!
    const supprimer = container.querySelector('[data-testid="workflow-remove-rapide"]')!
    expect(exporter.className).not.toContain('is-danger')
    expect(supprimer.className).toContain('is-danger')
  })
})
