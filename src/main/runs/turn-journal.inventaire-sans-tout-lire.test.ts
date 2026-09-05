/**
 * L'INVENTAIRE DES TOURS INACHEVÉS NE DOIT PAS RELIRE TOUT LE DISQUE.
 *
 * Mesure du 2026-09-05 sur l'application réelle (`gels.jsonl`) : deux blocages simultanés de plus de
 * deux secondes, `ipc:runs:unfinishedTurns (sync)` à 2124 ms et 2105 ms dont **1730 ms passés dans
 * 946 `readFileSync`**. La pile du gel désigne `listUnfinishedTurns` → `readTurnJournal`.
 *
 * Le gaspillage est structurel, pas une lenteur de disque : pour savoir si un tour est TERMINÉ, on
 * ouvrait, lisait ENTIÈREMENT et analysait ligne à ligne le journal de CHAQUE tour de CHAQUE
 * conversation — alors qu'un événement terminal déclenche un vidage immédiat du tampon et se trouve
 * donc en FIN de fichier. Le voisin `pruneFinishedTurnJournals` avait déjà tiré la leçon (« l'âge
 * d'abord, c'est un statSync, alors que la lecture coûte tout le fichier ») ; cet inventaire-ci ne
 * l'avait pas.
 *
 * Ce que ces tests exigent, et l'entrée qui les ferait échouer si la correction était fausse :
 *  (a) le RÉSULTAT ne bouge pas — un tour inachevé reste trouvé, avec son compte d'événements exact ;
 *      une correction qui devinerait la fin sans la vérifier échouerait ici ;
 *  (b) un journal TERMINÉ n'est plus lu intégralement : `readFileSync` n'est pas appelé sur lui ;
 *  (c) un journal dont la fin est ILLISIBLE (crash en cours d'écriture) reste jugé par une lecture
 *      complète — on ne déclare jamais « terminé » sur une queue qu'on n'a pas su lire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync as reelMkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return { ...real, default: real, readFileSync: vi.fn(real.readFileSync) }
})

const fs = await import('node:fs')
const { listUnfinishedTurns } = await import('./turn-journal')

let root = ''

function ecrireJournal(conversationId: string, turnId: string, lignes: string[]): string {
  const dir = join(root, conversationId)
  reelMkdirSync(dir, { recursive: true })
  const chemin = join(dir, `${turnId}.jsonl`)
  writeFileSync(chemin, lignes.join('\n') + '\n', 'utf8')
  return chemin
}

const delta = (i: number): string => JSON.stringify({ kind: 'delta', text: `t${i}`, at: i })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnjournal-inventaire-'))
  vi.mocked(fs.readFileSync).mockClear()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('inventaire des tours inacheves', () => {
  it('trouve le tour inacheve et compte ses evenements, malgre des tours termines autour', () => {
    ecrireJournal('conv-1', 'fini', [delta(1), delta(2), JSON.stringify({ kind: 'done', at: 3 })])
    ecrireJournal('conv-2', 'en-vol', [delta(1), delta(2), delta(3)])

    const trouves = listUnfinishedTurns(root)

    expect(trouves.map((t) => t.turnId)).toEqual(['en-vol'])
    expect(trouves[0].events).toBe(3)
  })

  it('ne lit PAS integralement un journal termine', () => {
    const chemin = ecrireJournal('conv-1', 'gros-fini', [
      ...Array.from({ length: 500 }, (_, i) => delta(i)),
      JSON.stringify({ kind: 'done', at: 999 })
    ])

    listUnfinishedTurns(root)

    const lus = vi.mocked(fs.readFileSync).mock.calls.map((appel) => String(appel[0]))
    expect(lus).not.toContain(chemin)
  })

  it('retombe sur la lecture complete quand la fin du journal est illisible', () => {
    const dir = join(root, 'conv-3')
    reelMkdirSync(dir, { recursive: true })
    // Dernière ligne tronquée par un crash : la queue ne permet aucune conclusion.
    writeFileSync(join(dir, 'tronque.jsonl'), `${delta(1)}\n{"kind":"de`, 'utf8')

    const trouves = listUnfinishedTurns(root)

    expect(trouves.map((t) => t.turnId)).toEqual(['tronque'])
    expect(trouves[0].events).toBe(1)
  })
})
