// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { noterPromptDePipeline } from './chat-view-model'
import type { ChatPart, OrchStep } from './chat-view-model'

/**
 * DEUX DEFAUTS constates a l'ecran sur le bloc « Orchestration » (demande du 2026-09-03) :
 *
 * 1. LA CIBLE EST RENDUE DEUX FOIS — une fois dans l'en-tete, une fois sous le nom de l'action,
 *    toutes deux sous `data-testid="activity-step-target"`. Les deux se superposent a la lecture :
 *    la meme tache est ecrite deux fois de suite. Celle a GARDER est celle du BAS, la seule qui
 *    porte le clic de depliage (decision du 2026-08-31, commentaire en place).
 *
 * 2. LE PROMPT ENVOYE N'EST NULLE PART — le deplie nomme la phase et le modele, mais pas ce qui
 *    leur a ete envoye. C'etait pourtant la demande d'origine : « voir les prompts envoyes a chaque
 *    skill ». Le prompt existe deja sur `OrchStep.prompt` ; il doit remonter jusqu'a la ligne de
 *    pipeline et s'ouvrir sous elle.
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

describe('defaut 1 — la cible n est plus ecrite deux fois', () => {
  it('rend UNE seule cible, et c est celle du bas (cliquable, hors en-tete)', () => {
    const action = enCours({ pipeline: [{ phase: 'scout', model: 'opus-4' }] })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    const cibles = container.querySelectorAll('[data-testid="activity-step-target"]')
    expect(cibles).toHaveLength(1)
    /*
     * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : supprimer l'occurrence du
     * BAS au lieu de celle de l'en-tete laisse bien UNE cible — le compte ci-dessus passerait. Les
     * deux assertions suivantes sont la pour ca : la survivante doit etre HORS de `.activity-step-head`
     * et etre le bouton de depliage, pas le `<span>` inerte de l'en-tete.
     */
    expect(
      container.querySelector('.activity-step-head [data-testid="activity-step-target"]')
    ).toBeNull()
    expect(cibles[0].tagName).toBe('BUTTON')
    expect(cibles[0].getAttribute('aria-expanded')).toBe('false')
    expect(cibles[0].textContent).toContain('ma tache')
  })

  it('rend encore UNE cible quand l etape n a rien a deplier (texte inerte)', () => {
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [enCours()] })))
    const cibles = container.querySelectorAll('[data-testid="activity-step-target"]')
    expect(cibles).toHaveLength(1)
    expect(cibles[0].tagName).toBe('SPAN')
    expect(cibles[0].textContent).toContain('ma tache')
  })
})

describe('defaut 2 — un niveau depliable sous chaque phase montre le prompt envoye', () => {
  const enveloppe = (marqueur: string): NonNullable<OrchStep['prompt']> => ({
    provider: 'claude',
    model: 'opus-4',
    transport: 'cli',
    system: `SYSTEME ${marqueur}`,
    messages: [{ role: 'user', content: `MESSAGE ${marqueur}` }],
    options: { temperature: 0 },
    limitation: 'aucune'
  })

  it('ouvre le prompt SOUS la ligne de phase qui le porte', () => {
    const action = enCours({
      pipeline: [
        { phase: 'scout', role: 'subagent', provider: 'claude', model: 'opus-4' },
        {
          phase: 'build',
          role: 'subagent',
          provider: 'claude',
          model: 'opus-4',
          prompt: enveloppe('BUILD')
        }
      ]
    })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    act(() =>
      container.querySelector<HTMLButtonElement>('[data-testid="activity-step-toggle"]')!.click()
    )
    const prompts = container.querySelectorAll('[data-testid="activity-step-prompt"]')
    // UNE seule ligne porte un prompt : la phase `scout` n'en a pas recu, elle ne promet donc rien.
    expect(prompts).toHaveLength(1)
    const lignes = container.querySelectorAll('[data-testid="activity-step-pipeline"] > li')
    expect(lignes[1].contains(prompts[0])).toBe(true)
    expect(prompts[0].textContent).toContain('Voir le prompt envoyé')
    // Replie par defaut : le prompt ne doit pas noyer le fil tant qu'on ne l'ouvre pas.
    expect((prompts[0] as HTMLDetailsElement).open).toBe(false)
    act(() => {
      ;(prompts[0] as HTMLDetailsElement).open = true
    })
    expect(prompts[0].textContent).toContain('SYSTEME BUILD')
    expect(prompts[0].textContent).toContain('MESSAGE BUILD')
  })

  it('range le prompt d un step sur LA ligne de sa phase ET de son modele', () => {
    // Fan-out : deux membres de la meme phase, deux modeles. Un rapprochement fait sur la seule
    // phase collerait le prompt d'opus sur la ligne de sonnet — c'est l'entree qui doit casser.
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [
          { phase: 'build', provider: 'claude', model: 'opus-4' },
          { phase: 'build', provider: 'claude', model: 'sonnet-4' }
        ]
      } as ChatPart
    ]
    const suite = noterPromptDePipeline(parts, {
      step: 'exec',
      detail: 'phase build',
      model: 'sonnet-4',
      prompt: enveloppe('SONNET')
    })
    const action = suite[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline).toHaveLength(2)
    expect(action.pipeline![0].prompt).toBeUndefined()
    expect(action.pipeline![1].prompt?.system).toBe('SYSTEME SONNET')
  })

  it('n invente aucune ligne pour un step dont la phase n a pas ete annoncee', () => {
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [{ phase: 'build', model: 'opus-4' }]
      } as ChatPart
    ]
    // Entree qui doit casser un rapprochement trop permissif : `judge` n'a jamais ete annonce.
    const suite = noterPromptDePipeline(parts, {
      step: 'judge',
      detail: 'phase judge',
      model: 'gpt-5',
      prompt: enveloppe('JUGE')
    })
    expect(suite).toBe(parts)
    // Un step SANS prompt ne touche a rien non plus.
    expect(noterPromptDePipeline(parts, { step: 'exec', detail: 'phase build' })).toBe(parts)
    // Une orchestration DEJA close ne bouge plus.
    const close: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        ok: true,
        args: { task: 't' },
        pipeline: [{ phase: 'build' }]
      } as ChatPart
    ]
    expect(
      noterPromptDePipeline(close, { step: 'exec', detail: 'phase build', prompt: enveloppe('X') })
    ).toBe(close)
  })

  it('garde le DERNIER prompt envoye a une phase, sans dupliquer la ligne', () => {
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [{ phase: 'build', model: 'opus-4' }]
      } as ChatPart
    ]
    const premier = noterPromptDePipeline(parts, {
      step: 'exec',
      execution: { phase: 'build' },
      model: 'opus-4',
      prompt: enveloppe('UN')
    })
    const second = noterPromptDePipeline(premier, {
      step: 'exec',
      execution: { phase: 'build' },
      model: 'opus-4',
      prompt: enveloppe('DEUX')
    })
    const action = second[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline).toHaveLength(1)
    expect(action.pipeline![0].prompt?.system).toBe('SYSTEME DEUX')
    // Rien de nouveau a dire => meme reference, pas de re-rendu du fil.
    expect(
      noterPromptDePipeline(second, {
        step: 'exec',
        execution: { phase: 'build' },
        model: 'opus-4',
        prompt: enveloppe('DEUX')
      })
    ).toBe(second)
  })
})
