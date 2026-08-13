import { describe, expect, it } from 'vitest'
import { pickTurnToResume, type UnfinishedTurn } from './resume-unfinished'

const turn = (id: string, updatedAt: number, events = 3): UnfinishedTurn => ({
  conversationId: id,
  turnId: `t-${id}`,
  events,
  updatedAt
})

describe('pickTurnToResume — reprise AUTOMATIQUE, sans popup', () => {
  it('reprend le tour le PLUS RÉCEMMENT actif', () => {
    expect(
      pickTurnToResume([turn('vieux', 10), turn('recent', 99), turn('moyen', 50)])
    ).toMatchObject({ conversationId: 'recent' })
  })

  it('rien à reprendre → null (démarrage normal inchangé)', () => {
    expect(pickTurnToResume([])).toBeNull()
    expect(pickTurnToResume(null)).toBeNull()
    expect(pickTurnToResume(undefined)).toBeNull()
  })

  it('ignore un tour SANS événement récupéré (rien à montrer)', () => {
    expect(pickTurnToResume([turn('vide', 99, 0)])).toBeNull()
    expect(pickTurnToResume([turn('vide', 99, 0), turn('utile', 10)])).toMatchObject({
      conversationId: 'utile'
    })
  })

  it('ignore une entrée malformée sans planter', () => {
    const malformed = [{ conversationId: '', turnId: 't', events: 5, updatedAt: 99 }, turn('ok', 1)]
    expect(pickTurnToResume(malformed)).toMatchObject({ conversationId: 'ok' })
  })
})
