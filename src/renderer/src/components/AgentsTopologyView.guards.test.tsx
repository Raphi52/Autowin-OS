// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsTopologyView } from './AgentsTopologyView'

/**
 * Les garde-fous de la vue Models : ce qui empêche d'enregistrer, d'appliquer ou de rester bloqué
 * sur une configuration qui ne veut rien dire. Chaque test part d'un défaut réel constaté à la
 * lecture du code (slot fantôme, fan-out inerte, écrasement muet, vue morte).
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
    defaultReasoningEffort: 'medium'
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
    expect(
      container.querySelector<HTMLSelectElement>('[data-testid="topology-profile-select"]')!
        .disabled
    ).toBe(true)
  })

  it('une topologie entièrement résolue ne déclenche aucune alerte', async () => {
    api({})
    await monter()
    expect(container.querySelector('[data-testid="topology-unresolved"]')).toBeNull()
  })
})

describe('fan-out des sous-agents', () => {
  it('refuse le dépôt inerte au lieu de le persister puis de l’étiqueter « non actif »', async () => {
    // Défaut : un 2e sous-agent était ENREGISTRÉ puis marqué « non actif ». On écrivait donc une
    // configuration sans effet au runtime — la persistance mentait sur ce qui allait tourner.
    const setTopology = vi.fn(async (next: unknown) => next)
    api({ setTopology })
    await monter()

    const ajouter = container.querySelector<HTMLButtonElement>(
      '[data-testid="topology-add-subagents"]'
    )!
    expect(ajouter.disabled).toBe(true)
    expect(ajouter.textContent).toContain('Fan-out non branché')
    expect(setTopology).not.toHaveBeenCalled()
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

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="topology-profile-select"]'
    )!
    await act(async () => {
      select.value = 'p1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    expect(applyProfile).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="topology-apply-confirm"]')).not.toBeNull()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="topology-apply-yes"]')!.click()
    )
    await flush()

    expect(applyProfile).toHaveBeenCalledWith('p1')
    // Le select est CONTRÔLÉ et un badge dit ce qui est réellement en place : en `defaultValue`, il
    // retombait sur « Profils sauvegardés » et plus rien n'indiquait le profil appliqué.
    expect(select.value).toBe('p1')
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
