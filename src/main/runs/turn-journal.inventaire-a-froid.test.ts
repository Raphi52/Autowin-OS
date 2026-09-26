/**
 * L'INVENTAIRE À FROID (premier appel après démarrage) NE DOIT PAS BLOQUER LE FIL PRINCIPAL.
 *
 * Mesure du 2026-09-17 18:59 (gels.jsonl) : `ipc:runs:unfinishedTurns` 1,48 s à l'ouverture de
 * l'app, dont 986 `openSync`. La mémoire des journaux terminés est vide au démarrage : seule une
 * lecture NON bloquante supprime ce gel-là. Ce test échoue si l'inventaire async retombe sur
 * `openSync` / `readFileSync` / `readdirSync` / `statSync`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync as reelMkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    readFileSync: vi.fn(real.readFileSync),
    openSync: vi.fn(real.openSync),
    readdirSync: vi.fn(real.readdirSync),
    statSync: vi.fn(real.statSync)
  }
})

const fs = await import('node:fs')
const { listUnfinishedTurnsAsync, listUnfinishedTurns } = await import('./turn-journal')

let root = ''
const delta = (i: number): string => JSON.stringify({ kind: 'delta', text: `t${i}`, at: i })
function ecrire(conv: string, turn: string, lignes: string[]): void {
  reelMkdirSync(join(root, conv), { recursive: true })
  writeFileSync(join(root, conv, `${turn}.jsonl`), lignes.join('\n') + '\n', 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnjournal-froid-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('inventaire a froid non bloquant', () => {
  it('rend le meme resultat que la version synchrone, sans aucune E/S synchrone', async () => {
    ecrire('conv-1', 'fini', [delta(1), JSON.stringify({ kind: 'done', at: 2 })])
    ecrire('conv-2', 'en-vol', [delta(1), delta(2), delta(3)])
    ecrire('conv-3', 'tronque', [delta(1), '{"kind":"del'])
    for (const f of [fs.readFileSync, fs.openSync, fs.readdirSync, fs.statSync])
      vi.mocked(f).mockClear()

    const asynchrone = await listUnfinishedTurnsAsync(root)

    for (const f of [fs.readFileSync, fs.openSync, fs.readdirSync, fs.statSync]) {
      expect(vi.mocked(f)).not.toHaveBeenCalled()
    }
    expect(asynchrone).toEqual(listUnfinishedTurns(root))
    expect(asynchrone.map((t) => t.turnId).sort()).toEqual(['en-vol', 'tronque'])
  })

  it('racine absente : liste vide', async () => {
    expect(await listUnfinishedTurnsAsync(join(root, 'absent'))).toEqual([])
  })
})
