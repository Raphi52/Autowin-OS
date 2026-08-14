import { describe, expect, it } from 'vitest'
import type { PilotEventKind } from './pilot-events'
import type { AssistantPilotEvent } from '../renderer/src/components/chat-view-model'

const PILOT_EVENT_KINDS = [
  'delta',
  'stream-reset',
  'think',
  'reasoning',
  'command',
  'result',
  'done',
  'error',
  'retry',
  'cancellation',
  'prompt-call',
  'artifact'
] as const satisfies readonly PilotEventKind[]

/**
 * GARDE ANTI-DÉRIVE du vocabulaire d'évènements du pilote.
 *
 * Constaté le 2026-08-04 : la liste des `kind` était recopiée à la main dans TROIS fichiers, avec
 * trois contenus différents — 12 kinds dans `src/main/agent-pilot.ts`, 11 dans `AssistantPilotEvent`
 * (`prompt-call` manquant), 10 dans `ChatView.tsx` (`reasoning` et `prompt-call` manquants). Rien ne
 * le signalait : la frontière IPC reçoit `raw as PilotEvent`, un cast non vérifié, donc un kind absent
 * d'une liste se traduisait par un évènement silencieusement ignoré, jamais par une erreur.
 *
 * Ces tests existent pour que la prochaine dérive soit une ERREUR et non un silence.
 */
describe('vocabulaire des évènements du pilote — une seule source', () => {
  it('PILOT_EVENT_KINDS couvre EXHAUSTIVEMENT le type (ajouter un kind sans l’y mettre ne compile pas)', () => {
    // Ce Record est le garde COMPILE-TIME : ajouter un membre à `PilotEventKind` sans l'ajouter ici
    // provoque « Property '<kind>' is missing », avant tout run.
    const exhaustive: Record<PilotEventKind, true> = {
      delta: true,
      'stream-reset': true,
      think: true,
      reasoning: true,
      command: true,
      result: true,
      done: true,
      error: true,
      retry: true,
      cancellation: true,
      'prompt-call': true,
      artifact: true
    }
    // Et le garde RUNTIME : la constante ne doit ni en oublier, ni en inventer.
    expect([...PILOT_EVENT_KINDS].sort()).toEqual(Object.keys(exhaustive).sort())
  })

  it('n’a ni doublon ni trou', () => {
    expect(new Set(PILOT_EVENT_KINDS).size).toBe(PILOT_EVENT_KINDS.length)
    expect(PILOT_EVENT_KINDS).toHaveLength(12)
  })

  it('le renderer accepte TOUS les kinds que le main peut émettre', () => {
    // C'est la régression exacte qui s'était produite : `AssistantPilotEvent` refusait `prompt-call`.
    // Si un jour son `kind` cesse d'être `PilotEventKind`, cette affectation ne compilera plus.
    const received: Array<AssistantPilotEvent['kind']> = [...PILOT_EVENT_KINDS]
    expect(received).toHaveLength(PILOT_EVENT_KINDS.length)
  })
})
