import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { lireMemoireScout, noterPistesScout } from './scout-memoire'
import { registerScoutMotifIpc } from './scout-motif-ipc'

/*
 * PISTE 2 (conv-1033) — « Pourquoi pas ? » sur une piste décochée du panneau du scout. Le panneau ne
 * connaît ni le dépôt ni le run : le processus principal retrouve la piste par son titre dans la
 * mémoire du dépôt de travail. Un motif inconnu est REFUSÉ, jamais corrigé.
 */
function harnais(
  chemin: string,
  refuser = false,
  depotDe: (conversationId?: string) => string = () => 'D:/w'
): (...args: unknown[]) => unknown {
  let handler: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | undefined
  registerScoutMotifIpc({
    ipc: { handle: (_canal, listener) => (handler = listener) },
    assertTrusted: () => {
      if (refuser) throw new Error('expéditeur refusé')
    },
    depotDe,
    chemin
  })
  return (...args) => handler!({} as IpcMainInvokeEvent, ...args)
}

const ENTETE = '| # | Score | Type | What | Why | How |\n|---|---|---|---|---|---|\n'

describe('scout:motif', () => {
  it('note le motif sur la piste du dépôt de travail, et rend vrai', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'autowin-motif-')), 'scout-pistes.json')
    noterPistesScout({
      depot: 'D:/w',
      texte: ENTETE + '| 1 | 70 | 🔧 fix | A | p | a.ts:1 |\n| 2 | 60 | 🔧 fix | B | p | a.ts:1 |',
      run: 'r1',
      maintenant: '2026-10-21T08:00:00Z',
      chemin
    })
    expect(harnais(chemin)('B', 'trop-petit')).toBe(true)
    expect(lireMemoireScout(chemin).entrees.map((e) => [e.titre, e.motif])).toEqual([
      ['A', undefined],
      ['B', 'trop-petit']
    ])
  })

  it('jumeau : un motif inconnu, un titre vide ou un expéditeur non fiable sont refusés', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'autowin-motif-')), 'scout-pistes.json')
    expect(() => harnais(chemin)('B', 'bof')).toThrow(/motif/)
    expect(() => harnais(chemin)('', 'faux')).toThrow(/motif/)
    expect(() => harnais(chemin, true)('B', 'faux')).toThrow(/refusé/)
    // Une piste inconnue de la mémoire : rien n'est écrit, et l'interface le sait.
    expect(harnais(chemin)('Inconnue', 'faux')).toBe(false)
  })

  /*
   * Objection du juge indépendant (reprise de conv-1033) : le canal figeait le dépôt du DÉMARRAGE,
   * alors que le scout note ses pistes dans le dossier de SA conversation (`os.ts`,
   * `workspace ?? this.executionWorkspace`). Une conversation rangée sur un autre dépôt voyait
   * « Non noté », ou posait le motif sur la piste homonyme du mauvais dépôt.
   * Entrée qui tue une correction fausse : la même piste « B » dans les DEUX dépôts.
   */
  it('le motif va dans la mémoire du dossier de la conversation, pas dans celle du démarrage', () => {
    const chemin = join(mkdtempSync(join(tmpdir(), 'autowin-motif-')), 'scout-pistes.json')
    const tableau = ENTETE + '| 1 | 70 | 🔧 fix | B | p | a.ts:1 |'
    for (const depot of ['D:/demarrage', 'D:/autre-projet']) {
      noterPistesScout({
        depot,
        texte: tableau,
        run: depot,
        maintenant: '2026-10-21T08:00:00Z',
        chemin
      })
    }
    const depotDe = (conversationId?: string): string =>
      conversationId === 'conv-autre' ? 'D:/autre-projet' : 'D:/demarrage'
    expect(harnais(chemin, false, depotDe)('B', 'hors-sujet', 'conv-autre')).toBe(true)
    expect(lireMemoireScout(chemin).entrees.map((e) => [e.depot, e.motif])).toEqual([
      ['d:/demarrage', undefined],
      ['d:/autre-projet', 'hors-sujet']
    ])
    // Sans conversation, ou avec un identifiant qui n'en est pas un : le dossier du démarrage.
    expect(harnais(chemin, false, depotDe)('B', 'faux')).toBe(true)
    expect(harnais(chemin, false, depotDe)('B', 'faux', { pas: 'un id' })).toBe(true)
    expect(lireMemoireScout(chemin).entrees[0]?.motif).toBe('faux')
  })
})
