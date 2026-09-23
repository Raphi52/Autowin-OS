import { describe, expect, it } from 'vitest'
import {
  libelleCoutDuTour,
  reduceAssistantPilotEvent,
  type HydratedAssistantMessage
} from './chat-view-model'

const enCours = (): HydratedAssistantMessage => ({
  role: 'assistant',
  turnId: 't1',
  parts: [],
  status: 'streaming',
  done: false
})

describe('coût par tour', () => {
  it("recopie le coût rendu par l'événement done, sans le recalculer", () => {
    const fini = reduceAssistantPilotEvent(enCours(), {
      kind: 'done',
      turnId: 't1',
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.4321 }
    } as never)
    expect(fini.done).toBe(true)
    expect(fini.coutUsd).toBe(0.4321)
    expect(libelleCoutDuTour(fini.coutUsd)).toBe('coût du tour : 0.43 $')
  })
  it("n'invente rien quand le fournisseur ne chiffre pas", () => {
    const fini = reduceAssistantPilotEvent(enCours(), { kind: 'done', turnId: 't1' } as never)
    expect(fini.coutUsd).toBeUndefined()
    expect(libelleCoutDuTour(undefined)).toBeUndefined()
    expect(libelleCoutDuTour(0)).toBeUndefined()
  })
  it('garde la précision pour un petit tour', () => {
    expect(libelleCoutDuTour(0.0042)).toBe('coût du tour : 0.0042 $')
  })
})
