// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { completerChoixDePipeline, texteDuPrompt } from './chat-view-model'
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

/*
 * CAPSULE 2 (conv-194, 2026-10-10, choix de l'utilisateur sur maquettes) : une orchestration seule
 * n'a plus d'etage « Orchestration » avec sa cible. L'exigence reste la meme — la tache n'est pas
 * ecrite deux fois cote a cote — et se verifie sur la capsule : une fois dans l'en-tete plie (ligne
 * de lancement) ; ouverte, le corps montre les prompts des phases, pas une seconde fois la tache.
 */
const occurrences = (texte: string, motif: string): number => texte.split(motif).length - 1

describe('defaut 1 — la cible n est plus ecrite deux fois', () => {
  it('pliee, l en-tete ne nomme la tache qu UNE fois', () => {
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [enCours()] })))
    expect(occurrences(container.textContent ?? '', 'ma tache')).toBe(1)
  })

  it('des qu une phase a parle, le corps montre ses prompts, pas une seconde fois la tache', () => {
    const action = enCours({ pipeline: [{ phase: 'scout', model: 'opus-4' }] })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    act(() => container.querySelector<HTMLElement>('[data-testid="activity-group"]')!.click())
    const corps = container.querySelector('[data-testid="activity-steps"]')!
    expect(corps.textContent).not.toContain('ma tache')
    expect(corps.textContent).toContain('scout')
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
          prompt: texteDuPrompt(enveloppe('BUILD'))
        }
      ]
    })
    act(() => root.render(createElement(AssistantActivityGroup, { actions: [action] })))
    // Replie par defaut : le prompt ne doit pas noyer le fil tant qu'on ne l'ouvre pas.
    expect(container.querySelector('[data-testid="activity-pipeline-prompt"]')).toBeNull()
    // Capsule 2 (conv-194) : UN clic sur l'en-tete montre chaque phase avec son prompt.
    act(() => container.querySelector<HTMLElement>('[data-testid="activity-group"]')!.click())
    const lignes = container.querySelectorAll('[data-testid="activity-pipeline-line"]')
    // UNE seule ligne porte un prompt : la phase `scout` n'en a pas recu, elle ne promet donc rien.
    expect(lignes[0].querySelector('[data-testid="activity-pipeline-prompt"]')).toBeNull()
    const prompt = lignes[1].querySelector('[data-testid="activity-pipeline-prompt"]')!
    expect(prompt.textContent).toContain('SYSTEME BUILD')
    expect(prompt.textContent).toContain('MESSAGE BUILD')
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
    const suite = completerChoixDePipeline(parts, {
      step: 'exec',
      detail: 'phase build',
      model: 'sonnet-4',
      prompt: enveloppe('SONNET')
    })
    const action = suite[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline).toHaveLength(2)
    expect(action.pipeline![0].prompt).toBeUndefined()
    expect(action.pipeline![1].prompt).toContain('SYSTEME SONNET')
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
    const suite = completerChoixDePipeline(parts, {
      step: 'judge',
      detail: 'phase judge',
      model: 'gpt-5',
      prompt: enveloppe('JUGE')
    })
    expect(suite).toBe(parts)
    // Un step SANS prompt ne touche a rien non plus.
    expect(completerChoixDePipeline(parts, { step: 'exec', detail: 'phase build' })).toBe(parts)
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
      completerChoixDePipeline(close, { step: 'exec', detail: 'phase build', prompt: enveloppe('X') })
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
    const premier = completerChoixDePipeline(parts, {
      step: 'exec',
      execution: { phase: 'build' },
      model: 'opus-4',
      prompt: enveloppe('UN')
    })
    const second = completerChoixDePipeline(premier, {
      step: 'exec',
      execution: { phase: 'build' },
      model: 'opus-4',
      prompt: enveloppe('DEUX')
    })
    const action = second[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline).toHaveLength(1)
    expect(action.pipeline![0].prompt).toContain('SYSTEME DEUX')
    // Rien de nouveau a dire => meme reference, pas de re-rendu du fil.
    expect(
      completerChoixDePipeline(second, {
        step: 'exec',
        execution: { phase: 'build' },
        model: 'opus-4',
        prompt: enveloppe('DEUX')
      })
    ).toBe(second)
  })

  it('rapproche par le MODELE quand la phase du step ne designe aucune ligne (run de skill)', () => {
    // Constate a l'ecran (2026-09-03) : la ligne est annoncee sous le nom du SKILL (`kaizen`)
    // alors que le step rend la phase du PIPELINE (`build`). Les deux noms ne se rencontrent
    // jamais ; seule la regle du modele peut trancher, et elle exige deja l unicite.
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [{ phase: 'kaizen', role: 'subagent', provider: 'claude', model: 'opus' }]
      } as ChatPart
    ]
    const suite = completerChoixDePipeline(parts, {
      step: 'exec',
      detail: 'phase build',
      model: 'opus',
      prompt: enveloppe('KAIZEN')
    })
    const action = suite[0] as Extract<ChatPart, { kind: 'action' }>
    expect(action.pipeline![0].prompt).toContain('SYSTEME KAIZEN')
  })

  it('refuse encore quand des lignes portent la phase mais sont indiscernables', () => {
    const parts: ChatPart[] = [
      {
        kind: 'action',
        name: 'orchestrate',
        args: { task: 't' },
        pipeline: [{ phase: 'build' }, { phase: 'build' }]
      } as ChatPart
    ]
    expect(
      completerChoixDePipeline(parts, {
        step: 'exec',
        detail: 'phase build',
        model: 'opus',
        prompt: enveloppe('AMBIGU')
      })
    ).toBe(parts)
  })
})
