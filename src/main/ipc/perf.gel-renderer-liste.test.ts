/**
 * conv-1115 (2026-10-23) : le gel de la liste des conversations (`renderer:vue-chat-liste`) arrive
 * avec ce qu'elle a redessiné et ce qui l'a déclenché. Le main le VALIDE avant de l'écrire dans
 * gels.jsonl : entiers positifs, déclencheurs pris dans une liste connue — jamais un texte libre.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ecrits = vi.hoisted(() => [] as Array<Record<string, unknown>>)
const canaux = vi.hoisted(() => new Map<string, (...a: unknown[]) => unknown>())

vi.mock('electron', () => ({
  app: {},
  ipcMain: { handle: (canal: string, f: (...a: unknown[]) => unknown) => canaux.set(canal, f) }
}))
vi.mock('../ipc-senders', () => ({ assertTrustedRendererSender: () => undefined }))
vi.mock('../gel-main', () => ({
  journaliserGel: (gel: Record<string, unknown>) => ecrits.push(gel),
  lireGels: () => ({})
}))

import { registerPerfIpc } from './perf'

describe('perf:gelRenderer — détail de la liste joint au gel (conv-1115)', () => {
  beforeEach(() => {
    ecrits.length = 0
    canaux.clear()
    registerPerfIpc({ appDataRoot: 'inutilise' })
  })
  const signaler = (...a: unknown[]): unknown => canaux.get('perf:gelRenderer')!({}, ...a)

  it('écrit lignes, rendus, passages et déclencheurs connus ; écarte un déclencheur inconnu', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si le détail n'était pas relayé ou pas filtré : un
    // déclencheur qui porte du texte libre.
    expect(
      signaler(12_800, 'vue-chat-liste', {
        liste: {
          lignes: 986.4,
          rendus: 1972,
          passages: 3,
          declencheurs: ['conversations', 'du texte libre', 'fil-ouvert', 'conversations']
        }
      })
    ).toBe(true)
    expect(ecrits).toHaveLength(1)
    expect(ecrits[0]).toMatchObject({ blocageMs: 12_800, operation: 'renderer:vue-chat-liste' })
    expect(ecrits[0]!.liste).toEqual({
      lignes: 986,
      rendus: 1972,
      passages: 3,
      declencheurs: ['conversations', 'fil-ouvert']
    })
  })

  it('jumeau : sans détail, ou avec un détail illisible, le gel s’écrit sans champ liste', () => {
    expect(signaler(1500, 'vue-chat-liste')).toBe(true)
    expect(signaler(1500, 'vue-chat-liste', { liste: 'pas un objet' })).toBe(true)
    expect(
      signaler(1500, 'vue-chat-liste', {
        liste: { lignes: -1, rendus: 2, passages: 1, declencheurs: [] }
      })
    ).toBe(true)
    expect(ecrits).toHaveLength(3)
    for (const gel of ecrits) expect('liste' in gel).toBe(false)
  })

  it('le détail des messages du fil reste écrit à côté (conv-1077)', () => {
    signaler(3000, 'vue-chat-fil', {
      messages: [{ cle: 'm-1', role: 'user', taille: 4, ms: 9, rendus: 1 }]
    })
    expect(ecrits[0]!.messages).toHaveLength(1)
    expect('liste' in ecrits[0]!).toBe(false)
  })
})
