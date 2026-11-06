import { describe, expect, it, vi } from 'vitest'

const canaux = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: { handle: (canal: string, fn: (...args: unknown[]) => unknown) => canaux.set(canal, fn) }
}))
vi.mock('./ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))

import { registerConversationsIpc, resumesAvecReprise } from './conversations'
import type { Conversation, ConversationSummary } from '../store/conversations'

/**
 * LA LISTE PORTE L'ÉTAT DE REPRISE DES SEULS FILS COUPÉS (conv-1423). `os:conversations` se relit à
 * chaque tour, et ce calcul coûte une lecture : ce qui ferait échouer ce test, c'est de le payer
 * pour un fil qui n'a rien à reprendre.
 */
const resume = (id: string, partiel: Partial<ConversationSummary>): ConversationSummary =>
  ({ id, title: id, messageCount: 2, ...partiel }) as ConversationSummary
const MUR = "You've hit your session limit · resets 2am"

/*
 * Objection du contrôle final (conv-1423) : un fil réactivé passait à « repart seule » sans que rien
 * replanifie son réveil. C'est le seul changement de situation qu'une personne déclenche et regarde :
 * il ne peut pas attendre la relecture du quart d'heure.
 *
 * fix-ok: `setInactive` ne replanifiait rien : ce test était rouge sur 0 appel avant `relireLesFilsCoupes`.
 */
describe('os:conversations:setInactive — réactiver un fil coupé', () => {
  const brancher = (
    marquerInactive: (id: string, on: boolean) => unknown
  ): ReturnType<typeof vi.fn> => {
    const relireLesFilsCoupes = vi.fn()
    registerConversationsIpc({
      os: { conversations: { marquerInactive } },
      broadcast: () => undefined,
      relireLesFilsCoupes
    } as never)
    return relireLesFilsCoupes
  }
  const appeler = (id: string, on: boolean): unknown =>
    canaux.get('os:conversations:setInactive')!({}, id, on)

  it('relit les fils coupés, dans les deux sens', () => {
    const relire = brancher((id, on) => ({ id, inactive: on }))
    expect(appeler('conv-1', false)).toBe(false)
    expect(relire).toHaveBeenCalledTimes(1)
    expect(appeler('conv-1', true)).toBe(true)
    expect(relire).toHaveBeenCalledTimes(2)
  })

  it('JUMEAU : un fil inconnu ne relit rien', () => {
    const relire = brancher(() => undefined)
    appeler('conv-absent', false)
    expect(relire).not.toHaveBeenCalled()
  })
})

describe('resumesAvecReprise', () => {
  const lire = (id: string): Conversation => ({ id }) as Conversation

  it('n’ajoute l’état qu’aux fils coupés par le quota', () => {
    const etat = vi.fn(() => ({ etat: 'essai-rate' as const }))
    const lus = resumesAvecReprise(
      [
        resume('coupe', { lastAssistantStatus: 'failed', lastAssistantError: MUR }),
        resume('erreur', { lastAssistantStatus: 'failed', lastAssistantError: 'ENOENT' }),
        resume('fini', { lastAssistantStatus: 'completed' }),
        resume('vide', {})
      ],
      lire,
      etat
    )
    expect(etat).toHaveBeenCalledTimes(1)
    expect(lus.map((fil) => fil.repriseQuota)).toEqual([
      { etat: 'essai-rate' },
      undefined,
      undefined,
      undefined
    ])
  })

  it('un fil coupé sans état (déjà repris) reste tel quel', () => {
    const fil = resume('coupe', { lastAssistantStatus: 'failed', lastAssistantError: MUR })
    expect(resumesAvecReprise([fil], lire, () => undefined)[0]).toBe(fil)
  })

  it('un fil disparu entre-temps ne fait pas tomber la liste', () => {
    const fil = resume('coupe', { lastAssistantStatus: 'failed', lastAssistantError: MUR })
    const etat = vi.fn()
    expect(resumesAvecReprise([fil], () => undefined, etat)).toEqual([fil])
    expect(etat).not.toHaveBeenCalled()
  })
})
