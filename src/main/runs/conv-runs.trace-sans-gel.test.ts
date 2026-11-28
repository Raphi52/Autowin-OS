import * as fs from 'node:fs'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { attendreFichier } from '../gel/ecriture-hors-fil'
import { createConvRun, deleteConvRun, loadConvRunTrace, saveConvRunTrace } from './conv-runs'

/**
 * LE FIL DES SOUS-AGENTS D'UN RUN NE TIENT PLUS LE FIL PRINCIPAL.
 *
 * Mesure `gels.jsonl` du 21 au 28/11/2026 (`node scripts/gels-classement.mjs --jours 7 --json
 * --top 200`, cartes archivées) : `writeFileSync` de `saveConvRunTrace` (`conv-runs.ts`), appelé à
 * chaque étape par `commands/orchestration.ts` et par la reprise d'un run, a figé la fenêtre 3 fois,
 * 4,1 s en tout. `trace.json` porte jusqu'à 200 000 caractères par étape et se réécrit en entier.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 *  - `writeFileSync` remis dans `saveConvRunTrace` → le premier test voit l'écriture bloquante ;
 *  - `loadConvRunTrace` qui relit le disque seul → il rate l'étape déposée et pas encore posée ;
 *  - un run supprimé pendant qu'une trace est en route → son dossier renaît avec `trace.json`.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    writeFileSync: vi.fn(real.writeFileSync),
    appendFileSync: vi.fn(real.appendFileSync),
    openSync: vi.fn(real.openSync)
  }
})
// Toute écriture qui tient le fil, même cachée dans une fonction « async » de façade.
const ecrituresBloquantes = [
  vi.mocked(fs.writeFileSync),
  vi.mocked(fs.appendFileSync),
  vi.mocked(fs.openSync)
]

const root = mkdtempSync(join(tmpdir(), 'aos-trace-sans-gel-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const traceDe = (run: string): string => join(dirname(run), 'trace.json')
const ecrituresBloquantesDe = (chemin: string): unknown[] =>
  ecrituresBloquantes.flatMap((espion) =>
    espion.mock.calls.filter(([cible]) => String(cible) === chemin)
  )

// Corps en bloc : une fonction rendue par `beforeEach` est rappelée après le test, comme nettoyage.
beforeEach(() => {
  for (const espion of ecrituresBloquantes) espion.mockClear()
})

describe('saveConvRunTrace — la trace se pose hors du fil principal', () => {
  it('relit tout de suite sa propre étape, sans writeFileSync', async () => {
    const run = createConvRun('conv-trace', 'trace sans gel', root, () => 1)

    saveConvRunTrace(run, [{ step: 'exec', text: 'première étape' }])
    saveConvRunTrace(run, [
      { step: 'exec', text: 'première étape' },
      { step: 'judge', text: 'VALIDE' }
    ])

    expect(ecrituresBloquantesDe(traceDe(run))).toEqual([])
    // Ce que l'interface relit pendant le run (IPC `loadConvRunTrace`) : la dernière étape déposée.
    expect(loadConvRunTrace(run)?.map((s) => s.step)).toEqual(['exec', 'judge'])

    expect(await attendreFichier(traceDe(run))).toBe(true)
    expect(JSON.parse(readFileSync(traceDe(run), 'utf8'))).toHaveLength(2)
    expect(ecrituresBloquantesDe(traceDe(run))).toEqual([])
  })

  it('un run supprimé pendant qu’une trace est en route ne renaît pas', async () => {
    const run = createConvRun('conv-trace-retire', 'run retiré', root, () => 2)
    saveConvRunTrace(run, [{ step: 'exec', text: 'en route' }])

    await expect(deleteConvRun('conv-trace-retire', run, [], root)).resolves.toEqual({
      kind: 'deleted'
    })
    // Le run continuait : son étape suivante arrive après la suppression.
    saveConvRunTrace(run, [{ step: 'judge', text: 'trop tard' }])
    await attendreFichier()

    expect(existsSync(dirname(run))).toBe(false)
    expect(loadConvRunTrace(run)).toBeNull()
  })
})
