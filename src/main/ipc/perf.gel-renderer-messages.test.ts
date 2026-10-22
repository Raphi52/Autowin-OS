/**
 * conv-1077 (2026-10-22) : le gel du fil (`renderer:vue-chat-fil`) arrive avec les messages qui ont
 * rendu pendant lui. Le main les VALIDE avant de les écrire dans gels.jsonl : clé bornée, rôle connu,
 * nombres entiers, 5 au plus — jamais un texte de message, jamais un champ inattendu.
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

describe('perf:gelRenderer — messages du fil joints au gel (conv-1077)', () => {
  beforeEach(() => {
    ecrits.length = 0
    canaux.clear()
    registerPerfIpc({ appDataRoot: 'inutilise' })
  })
  const signaler = (...a: unknown[]): unknown => canaux.get('perf:gelRenderer')!({}, ...a)

  it('écrit les messages valides avec le gel, et seulement eux, 5 au plus', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si le détail n'était pas relayé ou pas filtré : six
    // messages dont un portant du TEXTE dans sa clé et un rôle inconnu.
    const bon = (i: number): Record<string, unknown> => ({
      cle: `m-${i}`,
      role: 'assistant',
      taille: 1000 + i,
      ms: 100 - i,
      rendus: 1
    })
    expect(
      signaler(3000, 'vue-chat-fil', {
        messages: [
          { cle: 'du texte avec espaces', role: 'user', taille: 1, ms: 1, rendus: 1 },
          { cle: 'm-x', role: 'systeme', taille: 1, ms: 1, rendus: 1 },
          bon(1),
          bon(2),
          bon(3),
          bon(4),
          bon(5),
          bon(6)
        ]
      })
    ).toBe(true)
    expect(ecrits).toHaveLength(1)
    expect(ecrits[0]).toMatchObject({ blocageMs: 3000, operation: 'renderer:vue-chat-fil' })
    expect((ecrits[0]!.messages as Array<{ cle: string }>).map((m) => m.cle)).toEqual([
      'm-1',
      'm-2',
      'm-3',
      'm-4',
      'm-5'
    ])
  })

  it('jumeau : sans détail (ou détail illisible), le gel s’écrit comme avant, sans champ messages', () => {
    expect(signaler(1500, 'vue-chat-saisie')).toBe(true)
    expect(signaler(1500, 'vue-chat-fil', { messages: 'pas une liste' })).toBe(true)
    expect(ecrits).toHaveLength(2)
    for (const gel of ecrits) expect('messages' in gel).toBe(false)
  })
})
