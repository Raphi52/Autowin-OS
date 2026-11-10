// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

/**
 * Les garde-fous de la vue Models : ce qui empêche d'enregistrer, d'appliquer ou de rester bloqué
 * sur une configuration qui ne veut rien dire. Chaque test part d'un défaut réel constaté à la
 * lecture du code (slot fantôme, doublon, écrasement muet, vue morte).
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const models = [
  {
    id: 'gpt',
    provider: 'openai',
    model: 'gpt',
    label: 'GPT',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    dynamicallyLoaded: true
  },
  {
    id: 'gpt-mini',
    provider: 'openai',
    model: 'gpt-mini',
    label: 'GPT mini',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    dynamicallyLoaded: true
  }
]

const topologie = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'openai',
    modelId: 'gpt',
    reasoningEffort: 'medium'
  },
  subagents: [{ slotId: 'subagent-1', provider: 'openai', modelId: 'gpt', reasoningEffort: 'low' }],
  panels: { scout: [], frame: [], terrain: [], judge: [] },
  ...over
})

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

function api(over: Record<string, unknown>): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    models: async () => models,
    topology: async () => topologie(),
    roles: async () => ({}),
    profiles: async () => [],
    onAppEvent: () => () => undefined,
    setTopology: vi.fn(async (next: unknown) => next),
    ...over
  }
}

const monter = async (): Promise<void> => {
  await act(async () => root.render(createElement(AgentsTopologyView)))
  await flush()
}

/** Le geste réel : ouvrir le menu de modèle d'un rôle, puis cliquer un point modèle × effort. */
async function choisirDansLeMenu(idBase: string, ligne: string, effort: string): Promise<void> {
  const menu = container.querySelector<HTMLDetailsElement>(`details[data-testid="${idBase}"]`)
  expect(menu).not.toBeNull()
  await act(async () => {
    menu!.open = true
    menu!.dispatchEvent(new Event('toggle'))
  })
  const cran = document.body.querySelector<HTMLButtonElement>(
    `[data-testid="effort-matrix"] [data-row="${ligne}"] [data-effort="${effort}"]`
  )
  expect(cran).not.toBeNull()
  await act(async () => cran!.click())
  // Le clic referme le menu : on rejoue l'événement que le navigateur émet alors.
  await act(async () => menu!.dispatchEvent(new Event('toggle')))
  await flush()
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

describe('slot pointant un modèle absent du catalogue', () => {
  it('le NOMME au lieu d’afficher son identifiant comme un libellé', async () => {
    // Défaut : `model?.label ?? slot.modelId` rendait « gpt-4-old » exactement comme un vrai
    // libellé. Rien ne disait que le modèle n'existait plus — et son sélecteur d'effort n'avait
    // plus qu'une option fantôme.
    api({
      topology: async () =>
        topologie({
          subagents: [
            {
              slotId: 'subagent-1',
              provider: 'openai',
              modelId: 'disparu',
              reasoningEffort: 'low'
            }
          ]
        })
    })
    await monter()

    expect(
      container.querySelector('[data-testid="slot-unresolved-subagent-1"]')?.textContent
    ).toContain('modèle introuvable')
    expect(container.querySelector('[data-testid="topology-unresolved"]')?.textContent).toContain(
      'subagent-1'
    )
  })

  it('gèle l’enregistrement et l’application d’un profil tant qu’il n’est pas résolu', async () => {
    api({
      topology: async () =>
        topologie({
          subagents: [
            {
              slotId: 'subagent-1',
              provider: 'openai',
              modelId: 'disparu',
              reasoningEffort: 'low'
            }
          ]
        }),
      profiles: async () => [
        { id: 'p1', name: 'Profil A', updatedAt: '2026-01-01', topology: topologie() }
      ]
    })
    await monter()

    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profile-new"]')!.disabled
    ).toBe(true)
    expect(container.querySelector<HTMLButtonElement>('[data-profile-id="p1"]')!.disabled).toBe(
      true
    )
  })

  it('une topologie entièrement résolue ne déclenche aucune alerte', async () => {
    api({})
    await monter()
    expect(container.querySelector('[data-testid="topology-unresolved"]')).toBeNull()
  })
})

describe('plusieurs modèles de sous-agents', () => {
  it('ajoute un second modèle par le menu, sans glisser-déposer, et l’enregistre', async () => {
    const setTopology = vi.fn(async (next: unknown) => next)
    api({ setTopology })
    await monter()

    // Aucune bibliothèque à gauche ni zone de dépôt : le rôle se règle par son menu.
    expect(container.querySelector('.topology-library')).toBeNull()
    expect(container.querySelector('[draggable="true"]')).toBeNull()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-add-subagents"]')!.click()
    )
    // Ouvrir la ligne n'écrit rien tant qu'aucun modèle n'est choisi.
    expect(setTopology).not.toHaveBeenCalled()
    await choisirDansLeMenu('topology-modele-nouveau', 'openai:gpt-mini', 'high')

    expect(setTopology).toHaveBeenCalledTimes(1)
    const enregistre = setTopology.mock.calls[0][0] as {
      subagents: Array<{ slotId: string; modelId: string; reasoningEffort: string }>
    }
    expect(enregistre.subagents).toEqual([
      { slotId: 'subagent-1', provider: 'openai', modelId: 'gpt', reasoningEffort: 'low' },
      { slotId: 'subagent-2', provider: 'openai', modelId: 'gpt-mini', reasoningEffort: 'high' }
    ])
    // Avec deux sous-agents, l'écran dit lequel écrit le code.
    expect(
      container.querySelector('[data-testid="topology-premier-sous-agent"]')?.textContent
    ).toBe('écrit le code')
    expect(container.querySelector('[data-testid="topology-modele-subagent-2"]')).not.toBeNull()
  })

  it('retire un sous-agent par sa croix', async () => {
    const setTopology = vi.fn(async (next: unknown) => next)
    api({
      setTopology,
      topology: async () =>
        topologie({
          subagents: [
            { slotId: 'subagent-1', provider: 'openai', modelId: 'gpt', reasoningEffort: 'low' },
            {
              slotId: 'subagent-2',
              provider: 'openai',
              modelId: 'gpt-mini',
              reasoningEffort: 'high'
            }
          ]
        })
    })
    await monter()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="topology-retirer-subagent-1"]')!
        .click()
    )
    await flush()

    expect(setTopology).toHaveBeenCalledTimes(1)
    expect(
      (setTopology.mock.calls[0][0] as { subagents: Array<{ slotId: string }> }).subagents.map(
        (slot) => slot.slotId
      )
    ).toEqual(['subagent-2'])
  })
})

describe('profils de topologie', () => {
  it('appliquer un profil se CONFIRME — le seul choix dans le select n’écrase rien', async () => {
    const applyProfile = vi.fn(async () => ({ id: 'p1', topology: topologie() }))
    api({
      profiles: async () => [
        { id: 'p1', name: 'Profil A', updatedAt: '2026-01-01', topology: topologie() }
      ],
      applyProfile
    })
    await monter()

    const pastille = (): HTMLButtonElement =>
      container.querySelector<HTMLButtonElement>('[data-profile-id="p1"]')!
    await act(async () => pastille().click())
    await flush()

    expect(applyProfile).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="topology-apply-confirm"]')).not.toBeNull()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-apply-yes"]')!.click()
    )
    await flush()

    expect(applyProfile).toHaveBeenCalledWith('p1')
    // La pastille du profil en place le DIT (enfoncée, en or) : sans cela, plus rien n'indiquait
    // quel profil venait d'être appliqué.
    expect(pastille().getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="topology-profile-applied"]')?.textContent).toBe(
      'Profil A'
    )
  })

  it('nommer un profil se fait DANS l’application, sans window.prompt', async () => {
    const saveProfile = vi.fn(async () => [])
    const prompt = vi.spyOn(window, 'prompt')
    api({ saveProfile })
    await monter()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profile-new"]')!.click()
    )
    const champ = container.querySelector<HTMLInputElement>(
      '[data-testid="topology-profile-name"]'
    )!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(champ, 'Nuit')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profile-save"]')!.click()
    )
    await flush()

    expect(prompt).not.toHaveBeenCalled()
    expect(saveProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nuit' }))
  })
})

describe('échecs qui doivent être VUS', () => {
  it('affiche l’échec du rafraîchissement de topologie déclenché par un événement roles', async () => {
    // Défaut : le `.catch` posait `setError` sans `setState('error')` — or le badge ne rend le
    // message que si `state === 'error'`. L'échec était donc 100 % muet.
    let listener: ((event: { type: string; scope?: string }) => void) | undefined
    let appels = 0
    api({
      topology: async () => {
        appels += 1
        if (appels > 1) throw new Error('topologie illisible')
        return topologie()
      },
      onAppEvent: (fn: (event: { type: string; scope?: string }) => void) => {
        listener = fn
        return () => undefined
      }
    })
    await monter()

    await act(async () => listener?.({ type: 'refresh', scope: 'roles' }))
    await flush()

    const alertes = Array.from(container.querySelectorAll('[role="alert"]')).map(
      (node) => node.textContent ?? ''
    )
    expect(alertes.join(' | ')).toContain('topologie illisible')
  })

  it('dit que la liste des profils n’a pas pu être lue, et offre de réessayer', async () => {
    // Défaut : `.catch(() => undefined)` laissait un sélecteur vide, indiscernable d'un « aucun
    // profil enregistré ».
    let tentative = 0
    api({
      profiles: async () => {
        tentative += 1
        if (tentative === 1) throw new Error('profiles.json verrouillé')
        return [{ id: 'p1', name: 'Profil A', updatedAt: '2026-01-01', topology: topologie() }]
      }
    })
    await monter()

    const erreur = container.querySelector('[data-testid="topology-profiles-error"]')
    expect(erreur).not.toBeNull()
    expect(erreur?.getAttribute('role')).toBe('alert')
    expect(erreur?.textContent).toContain('profiles.json verrouillé')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-profiles-retry"]')!.click()
    )
    await flush()

    expect(tentative).toBe(2)
    expect(container.querySelector('[data-testid="topology-profiles-error"]')).toBeNull()
    expect(
      container.querySelector<HTMLElement>('[data-testid="topology-profile-select"]')!.textContent
    ).toContain('Profil A')
  })

  it('un doublon REFUSÉ ne laisse pas le badge de persistance en erreur', async () => {
    // Le même modèle au même effort ferait deux fois le même passage. Ce refus de validation ne
    // doit pas maquiller le badge de PERSISTANCE en panne : rien n'a échoué à l'écriture.
    const setTopology = vi.fn(async (next: unknown) => next)
    api({ setTopology })
    await monter()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-add-subagents"]')!.click()
    )
    await choisirDansLeMenu('topology-modele-nouveau', 'openai:gpt', 'low')

    expect(setTopology).not.toHaveBeenCalled()
    const badge = container.querySelector('.topology-state')!
    expect(badge.textContent).toBe('Enregistré dans le profil Autowin')
    // Le refus est dit, mais dans son PROPRE canal.
    expect(
      container.querySelector('[data-testid="topology-validation-error"]')?.textContent
    ).toContain('déjà dans les sous-agents')
  })
})

describe('erreur de chargement', () => {
  it('propose de RÉESSAYER au lieu de laisser la vue morte', async () => {
    // Défaut : un échec de lecture affichait « ⛔ … » définitivement — seul un redémarrage de
    // l'application permettait de retenter.
    let tentative = 0
    api({
      topology: async () => {
        tentative += 1
        if (tentative === 1) throw new Error('roles.json illisible')
        return topologie()
      }
    })
    await monter()

    expect(container.textContent).toContain('roles.json illisible')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-retry"]')!.click()
    )
    await flush()

    expect(tentative).toBe(2)
    expect(container.querySelector('[data-testid="topology-retry"]')).toBeNull()
    expect(container.querySelector('.agents-topology')).not.toBeNull()
  })
})
