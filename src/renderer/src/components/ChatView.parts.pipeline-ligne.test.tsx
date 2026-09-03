// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { completerChoixDePipeline, noterChoixDePipeline } from './chat-view-model'
import type { ChatPart, OrchStep } from './chat-view-model'

/**
 * DEMANDE UTILISATEUR (2026-09-03, capture jointe) : « chacune des lignes dans orchestration
 * meriterait d'etre un autre truc depliable qui montre le prompt envoye, et pour la gate la decision
 * rendue et pourquoi ». Les lignes ne nommaient que la phase et le modele ; le prompt et le motif du
 * controle final existaient deja dans l'etape terminee, sans jamais etre montres.
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
const orchestration = (over: Partial<Action> = {}): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'ma tache' }, ...over }) as Action

describe('chaque ligne du pipeline se deplie sur son prompt et sa decision', () => {
  it('montre le prompt REELLEMENT envoye a la ligne, apres clic sur SON chevron', () => {
    const action = orchestration({
      pipeline: [
        {
          phase: 'build',
          role: 'subagent',
          model: 'opus-4',
          prompt: '[system]\nTu es un sous-agent\n\n[user]\nfais X'
        }
      ]
    })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="activity-step-toggle"]')!.click())
    const chevrons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="activity-pipeline-toggle"]'
    )
    expect(chevrons).toHaveLength(1)
    expect(container.querySelector('[data-testid="activity-pipeline-prompt"]')).toBeNull()
    act(() => chevrons[0].click())
    expect(container.querySelector('[data-testid="activity-pipeline-prompt"]')!.textContent).toContain(
      'fais X'
    )
  })

  it('la ligne du controle final rend sa DECISION et son motif', () => {
    const action = orchestration({
      pipeline: [{ phase: 'gate', role: 'gate', outcome: 'BLOQUE: tests rouges', ok: false }]
    })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="activity-step-toggle"]')!.click())
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="activity-pipeline-toggle"]')!.click()
    )
    const rendu = container.querySelector('[data-testid="activity-pipeline-outcome"]')!
    expect(rendu.textContent).toContain('BLOQUE: tests rouges')
    expect(rendu.className).toContain('failed')
    expect(container.textContent).toContain('décision et motif')
  })

  it('aucun chevron de ligne quand la ligne ne porte ni prompt ni resultat', () => {
    const action = orchestration({ pipeline: [{ phase: 'scout', role: 'subagent' }] })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="activity-step-toggle"]')!.click())
    expect(container.querySelector('[data-testid="activity-pipeline-toggle"]')).toBeNull()
  })
})

describe('completerChoixDePipeline — l etape terminee complete SA ligne', () => {
  const ligneEnCours = (): ChatPart[] =>
    noterChoixDePipeline([orchestration() as unknown as ChatPart], {
      phase: 'build',
      role: 'subagent',
      provider: 'claude',
      model: 'opus-4'
    })

  it('rattache prompt et texte rendu a la ligne de la MEME phase, sans creer de doublon', () => {
    const step: OrchStep = {
      step: 'exec',
      detail: 'phase build',
      model: 'opus-4',
      text: 'livrable',
      prompt: {
        provider: 'claude',
        transport: 'cli',
        system: 'consigne',
        messages: [{ role: 'user', content: 'fais X' }],
        options: {},
        limitation: ''
      }
    }
    const parts = completerChoixDePipeline(ligneEnCours(), step)
    const lignes = (parts[0] as { pipeline: Array<Record<string, unknown>> }).pipeline
    expect(lignes).toHaveLength(1)
    expect(lignes[0].prompt).toBe('[system]\nconsigne\n\n[user]\nfais X')
    expect(lignes[0].outcome).toBe('livrable')
    expect(lignes[0].ok).toBe(true)
  })

  it('le controle final porte sa decision motivee et son echec', () => {
    const base = noterChoixDePipeline(ligneEnCours(), { phase: 'gate', role: 'gate' })
    const parts = completerChoixDePipeline(base, {
      step: 'gate',
      role: 'gate',
      status: 'failed',
      detail: 'BLOQUÉ: preuve manquante — verdict du juge: pas de test'
    })
    const lignes = (parts[0] as { pipeline: Array<Record<string, unknown>> }).pipeline
    expect(lignes).toHaveLength(2)
    expect(lignes[1].outcome).toContain('verdict du juge')
    expect(lignes[1].ok).toBe(false)
  })

  it('n invente rien : une etape sans prompt ni texte laisse le tableau intact', () => {
    const base = ligneEnCours()
    expect(completerChoixDePipeline(base, { step: 'exec', detail: 'phase build' })).toBe(base)
  })
})
