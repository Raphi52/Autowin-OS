// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { noterChoixDePipeline } from './chat-view-model'
import type { ChatPart } from './chat-view-model'

/**
 * SYMPTOME UTILISATEUR (2026-09-02, capture jointe) : « le bloc orchestration doit pouvoir etre
 * deplie et afficher les skill/agents choisis pour la task ». Sur une orchestration EN COURS, la
 * sous-ligne « Orchestration » n'offrait aucun chevron (pas de `data` tant que le run tourne, donc
 * aucun detail a montrer) et rien ne nommait la phase jouee ni le modele qui la joue — alors que
 * l'evenement `orchestrate-phase` porte deja phase + role + provider + model.
 */
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

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]
const enCours = (over: Partial<Action> = {}): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'ma tache' }, ...over }) as Action

describe('le bloc orchestration se deplie et nomme les skills/agents choisis', () => {
  it('affiche un chevron sur une orchestration EN COURS porteuse de choix', () => {
    const action = enCours({
      pipeline: [{ phase: 'scout', role: 'subagent', provider: 'claude', model: 'opus-4' }]
    })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-step-toggle"]'
    )
    expect(toggle).not.toBeNull()
    expect(container.querySelector('[data-testid="activity-step-pipeline"]')).toBeNull()
    act(() => toggle!.click())
    const liste = container.querySelector('[data-testid="activity-step-pipeline"]')
    expect(liste).not.toBeNull()
    expect(liste!.textContent).toContain('scout')
    expect(liste!.textContent).toContain('subagent')
    expect(liste!.textContent).toContain('opus-4')
  })

  it('ne fabrique aucune ligne quand aucun choix n a ete recu', () => {
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [enCours()] })))
    expect(container.querySelector('[data-testid="activity-step-pipeline"]')).toBeNull()
    expect(container.querySelector('[data-testid="activity-step-toggle"]')).toBeNull()
  })

  it('accumule les choix sur l orchestration en cours, sans doublon ni invention', () => {
    const parts: ChatPart[] = [
      { kind: 'text', text: 'bla' } as ChatPart,
      { kind: 'action', name: 'orchestrate', args: { task: 't' } } as ChatPart
    ]
    let suite = noterChoixDePipeline(parts, {
      phase: 'scout',
      role: 'subagent',
      provider: 'claude',
      model: 'opus-4'
    })
    suite = noterChoixDePipeline(suite, {
      phase: 'scout',
      role: 'subagent',
      provider: 'claude',
      model: 'opus-4'
    })
    suite = noterChoixDePipeline(suite, { phase: 'build', role: 'subagent', provider: 'codex' })
    const action = suite[1] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline).toEqual([
      { phase: 'scout', role: 'subagent', provider: 'claude', model: 'opus-4' },
      { phase: 'build', role: 'subagent', provider: 'codex' }
    ])
    // Un choix VIDE n'ajoute rien : une ligne sans phase ni agent ne dit rien a personne.
    expect(
      (noterChoixDePipeline(suite, {})[1] as Extract<ChatPart, { kind: 'action' }>).pipeline
    ).toHaveLength(2)
    // Une orchestration DEJA close ne recoit plus de choix (sinon un run fini se remet a bouger).
    const close: ChatPart[] = [
      { kind: 'action', name: 'orchestrate', ok: true, args: { task: 't' } } as ChatPart
    ]
    expect(noterChoixDePipeline(close, { phase: 'judge' })).toBe(close)
  })
})
