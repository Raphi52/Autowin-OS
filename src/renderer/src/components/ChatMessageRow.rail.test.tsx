// @vitest-environment happy-dom
/**
 * RAIL DU TOUR (conv-338, « Implémenter 1 + 5 » du /draft « mêler le texte du chat et mes blocs »).
 * Chaque élément d'un tour assistant est un point d'un rail : colonne d'heures à gauche (la 1),
 * verdict des juges puis réponse en bleu au bout (la 5).
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - les juges rendus SOUS la réponse (l'ancien bandeau) au lieu de l'avant-dernier point ;
 *  - une heure inventée sur un tour enregistré avant le rail (aucune part n'y porte `at`) ;
 *  - la dernière phrase d'un tour EN COURS marquée comme réponse ;
 *  - l'heure d'une part qui bouge quand le texte continue d'arriver dans la même part ;
 *  - le début du tour perdu en direct : sans lui, aucune heure ne s'affiche pendant le tour.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import { heureSurLeRail, placeDeLaReponse } from './rail-du-tour'
import {
  reduceAssistantPilotEvent,
  type HydratedAssistantMessage,
  type ScopedLiveRun
} from './chat-view-model'
import { reduceChatTurn, sansHeureInutile, type ChatTurnState } from '../../../shared/chat-turn'
import type { Msg } from './chat-view-types'
import type { StepDeRun } from './juges-votes'
import { RunsEnDirect } from './runs-en-direct'
import type { ChatArtifact } from '../../../shared/artifacts'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEBUT = 1_790_000_000_000

const capture: ChatArtifact = {
  id: 'img-1',
  name: 'gauche-1300.png',
  mimeType: 'image/png',
  kind: 'image',
  size: 171_520,
  createdAt: DEBUT + 19_400,
  source: { provider: 'claude', model: 'opus-test', tool: 'Read' }
}

async function rendre(
  message: Record<string, unknown>,
  runsEnDirect: Record<string, ScopedLiveRun<StepDeRun>> = {}
): Promise<Element> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(
        RunsEnDirect.Provider,
        { value: runsEnDirect },
        createElement(ChatMessageRow, {
          message: message as unknown as Msg,
          conversationId: 'conv-test'
        } as never)
      )
    )
  })
  const copie = host.querySelector('.msg.assistant')!.cloneNode(true) as Element
  await act(async () => root.unmount())
  host.remove()
  return copie
}

/** `visibles` : sans les points VIDES, que `.rail-noeud:empty` masque (ChatView.css). */
const natures = (el: Element, options: { visibles?: boolean } = {}): string[] =>
  [...el.querySelectorAll('.rail-noeud')]
    .filter((n) => !options.visibles || n.innerHTML !== '')
    .map((n) => n.getAttribute('data-nature') ?? '')
const heures = (el: Element): (string | null)[] =>
  [...el.querySelectorAll('.rail-noeud')].map(
    (n) => n.querySelector(':scope > .rail-heure')?.textContent ?? null
  )

const tourFini = {
  role: 'assistant',
  content: '',
  turnId: 't1',
  done: true,
  status: 'completed',
  debutDuTour: DEBUT,
  providerStatusLog: ['Read · src/renderer/src/components/ChatView.css'],
  parts: [
    { kind: 'text', text: 'J’édite la disposition.', at: DEBUT + 12_100 },
    { kind: 'action', actionId: 'a1', name: 'orchestrate', ok: true, at: DEBUT + 13_000 },
    { kind: 'artifact', artifact: capture },
    { kind: 'text', text: 'Le cadre est calé à gauche.', at: DEBUT + 31_900 }
  ]
}

describe('rail du tour : rendu', () => {
  it('pose un point par élément, le verdict AVANT la réponse, la réponse en dernier', async () => {
    const tour = await rendre(tourFini)
    expect(tour.classList.contains('msg--rail')).toBe(true)
    expect(natures(tour)).toEqual(['tour', 'texte', 'actions', 'image', 'juge', 'reponse'])
    expect(tour.querySelector('[data-nature="reponse"]')?.textContent).toContain('calé à gauche')
  })

  it('affiche le temps écoulé depuis le début du tour, sans en inventer pour le verdict', async () => {
    const tour = await rendre(tourFini)
    expect(tour.classList.contains('avec-heures')).toBe(true)
    expect(heures(tour)).toEqual(['0:00', '0:12', '0:13', '0:19', null, '0:31'])
  })

  // Les IMAGES ont toujours eu leur heure (`createdAt`) : un tour d'avant le rail en garde. Mesuré
  // sur conv-338 le 2026-10-19 : seules ses images étaient datées, et la colonne s'affichait trouée
  // (heure sur 4 images, rien sur 9 autres points). Sans texte ni action datés : aucune colonne.
  it('un tour enregistré avant le rail garde ses points mais aucune heure, même ses images', async () => {
    const ancien = {
      ...tourFini,
      debutDuTour: DEBUT,
      parts: tourFini.parts.map((part) =>
        part.kind === 'artifact' ? part : { ...part, at: undefined }
      )
    }
    const tour = await rendre(ancien)
    expect(tour.classList.contains('avec-heures')).toBe(false)
    expect(tour.querySelectorAll('.rail-heure')).toHaveLength(0)
    expect(natures(tour)).toEqual(['tour', 'texte', 'actions', 'image', 'juge', 'reponse'])
  })

  it('pendant le tour, la dernière phrase n’est pas encore la réponse', async () => {
    const tour = await rendre({ ...tourFini, done: false, status: 'streaming' })
    expect(natures(tour)).not.toContain('reponse')
    // Le point des juges est posé dès le tour en cours (conv-1021). Sans run reçu, il reste VIDE,
    // donc masqué (`.rail-noeud:empty`, ChatView.css) : la dernière phrase reste le dernier point vu.
    expect(tour.querySelector('[data-nature="juge"]')?.innerHTML).toBe('')
    expect(natures(tour, { visibles: true }).at(-1)).toBe('texte')
  })

  it('pendant le tour, le bloc des juges se remplit avec le run reçu en direct (conv-1021)', async () => {
    const run: ScopedLiveRun<StepDeRun> = {
      convId: 'conv-test',
      task: 't',
      status: 'running',
      steps: [],
      phase: { step: 'judge', model: 'juge-test' },
      liveText: 'DEFAUT: x\nOBJECTIONS:\n- MAJEUR: le test `a.test.ts` est rouge'
    }
    const tour = await rendre(
      { ...tourFini, done: false, status: 'streaming' },
      { 'conv-test': run }
    )
    expect(natures(tour, { visibles: true }).at(-1)).toBe('juge')
    const bloc = tour.querySelector('[data-nature="juge"] [data-testid="juges-panel"]')
    expect(bloc?.getAttribute('data-verdict')).toBe('encours')
    // Le bloc est PLIÉ par défaut (conv-1081, « je veux que ce bloc soit plié par défaut et
    // dépliable ») : le bandeau porte le COMPTE des objections lues dans le texte en direct, le
    // détail n'apparaît qu'au dépliage (couvert par JugesPanel.test.tsx, aide `deplier`). `rendre`
    // rend une copie figée du DOM : on y lit le bandeau, on ne peut pas y cliquer.
    const bandeau = bloc?.querySelector('[data-testid="jpan-bandeau"]')
    expect(bandeau?.getAttribute('aria-expanded')).toBe('false')
    expect(bandeau?.textContent).toContain('1 objection à corriger')
    expect(bloc?.querySelectorAll('[data-testid="jpan-objection"]')).toHaveLength(0)
  })
})

describe('rail du tour : calculs', () => {
  it('écrit le temps écoulé en m:ss, puis h:mm:ss', () => {
    expect(heureSurLeRail(DEBUT + 12_999, DEBUT)).toBe('0:12')
    expect(heureSurLeRail(DEBUT + 605_000, DEBUT)).toBe('10:05')
    expect(heureSurLeRail(DEBUT + 3_725_000, DEBUT)).toBe('1:02:05')
    expect(heureSurLeRail(DEBUT - 800, DEBUT)).toBe('0:00')
    expect(heureSurLeRail(undefined, DEBUT)).toBeUndefined()
    expect(heureSurLeRail(DEBUT, undefined)).toBeUndefined()
  })

  it('ne désigne aucune réponse tant que le tour n’est pas fini', () => {
    const blocs = [[{ kind: 'text' as const, text: 'a' }]]
    expect(placeDeLaReponse(blocs, false)).toBeUndefined()
    expect(placeDeLaReponse(blocs, true)).toEqual([0, 0])
  })
})

describe('rail du tour : heure des parts', () => {
  const vide: ChatTurnState = { turnId: 't1', status: 'streaming', parts: [] }

  it('date une part à son premier fragment, sans la redater ensuite', () => {
    const un = reduceChatTurn(vide, { kind: 'delta', streamId: 's', text: 'Bon', at: DEBUT + 5 })
    const deux = reduceChatTurn(un, { kind: 'delta', streamId: 's', text: 'jour', at: DEBUT + 9 })
    expect(deux.parts).toEqual([{ kind: 'text', streamId: 's', text: 'Bonjour', at: DEBUT + 5 }])
  })

  it('date une commande, et garde l’heure d’origine si elle est ré-émise', () => {
    const un = reduceChatTurn(vide, { kind: 'command', actionId: 'a', name: 'run', at: DEBUT + 7 })
    const deux = reduceChatTurn(un, { kind: 'command', actionId: 'a', name: 'run', at: DEBUT + 70 })
    expect(deux.parts).toEqual([{ kind: 'action', actionId: 'a', name: 'run', at: DEBUT + 7 }])
  })

  it('n’écrit l’heure au journal que sur l’événement qui ouvre une part', () => {
    const parts = [{ kind: 'text' as const, streamId: 's', text: 'Bon', at: DEBUT }]
    expect(sansHeureInutile(parts, { kind: 'delta', streamId: 's', text: 'x', at: 9 })).toEqual({
      kind: 'delta',
      streamId: 's',
      text: 'x'
    })
    expect(sansHeureInutile(parts, { kind: 'delta', streamId: 'u', text: 'x', at: 9 })).toEqual({
      kind: 'delta',
      streamId: 'u',
      text: 'x',
      at: 9
    })
  })

  it('en direct, le premier événement daté donne le début du tour, qui ne bouge plus', () => {
    const amorce = {
      role: 'assistant',
      parts: [],
      status: 'streaming',
      done: false
    } as HydratedAssistantMessage
    const un = reduceAssistantPilotEvent(amorce, {
      kind: 'provider-status',
      text: 'Démarrage',
      turnId: 't1',
      at: DEBUT
    })
    const deux = reduceAssistantPilotEvent(un, {
      kind: 'delta',
      streamId: 's',
      text: 'Bonjour',
      turnId: 't1',
      at: DEBUT + 4_000
    })
    expect(un.debutDuTour).toBe(DEBUT)
    expect(deux.debutDuTour).toBe(DEBUT)
    expect(deux.parts).toEqual([
      { kind: 'text', streamId: 's', text: 'Bonjour', at: DEBUT + 4_000 }
    ])
  })
})
