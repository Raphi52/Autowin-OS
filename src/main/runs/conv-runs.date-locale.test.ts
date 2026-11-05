/**
 * LE RUN.md PORTE LE JOUR DU POSTE, PAS CELUI DE LONDRES (scout du 05/11, piste 18, conv-1602).
 *
 * Les deux dates du RUN.md — la ligne de création (`createConvRun`) et celle de clôture
 * (`texteClos`, via `closeConvRun`) — venaient de `toISOString().slice(0, 10)`, le jour UTC. Entre
 * minuit et 1 h à Paris (2 h l'été), la fiche portait donc la date de la veille.
 *
 * POURQUOI UN PROCESSUS ENFANT : la suite tourne en fils d'exécution qui partagent `process.env`
 * (`vitest.config.ts`, pool `threads`). Y poser `TZ` ne change pas le fuseau du fil (mesuré : le cas
 * New York restait à l'heure de Paris) et toucherait les tests voisins. Un `node` lancé avec
 * `TZ=<fuseau>` prend ce fuseau (mesuré : `getTimezoneOffset()` = 300 sous America/New_York).
 *
 * Entrée qui rend ces tests rouges : `toISOString().slice(0, 10)` remis à l'un des deux sites. Le
 * jumeau new-yorkais refuse le correctif inverse, un fuseau de Paris écrit en dur ; le cas d'été
 * refuse un décalage fixe d'une heure.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'aos-convruns-date-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 00 h 30 le 06/11 à Paris (heure d'hiver, UTC+1) = 23 h 30 le 05/11 en UTC. */
const MINUIT_TRENTE_PARIS_HIVER = Date.parse('2026-11-06T00:30:00+01:00')
/** 01 h 30 le 15/07 à Paris (heure d'été, UTC+2) = 23 h 30 le 14/07 en UTC. */
const UNE_HEURE_TRENTE_PARIS_ETE = Date.parse('2026-07-15T01:30:00+02:00')

/**
 * Dans un `node` au fuseau donné, horloge arrêtée sur `instant` : crée puis clôt un RUN.md et rend
 * ses lignes de journal datées. L'horloge est figée AVANT d'importer le module, comme
 * `vi.setSystemTime` : la clôture lit `new Date()`.
 */
const SCRIPT = `
const instant = Number(process.env.AOS_INSTANT)
const Reel = Date
globalThis.Date = class extends Reel {
  constructor(...a) { super(...(a.length ? a : [instant])) }
  static now() { return instant }
}
const m = await import(process.env.AOS_MODULE)
const p = m.createConvRun('conv-1602', 'tâche lancée la nuit', process.env.AOS_RACINE, () => instant)
m.closeConvRun(p, 'green', 'clos la nuit')
const { readFileSync } = await import('node:fs')
process.stdout.write(JSON.stringify(readFileSync(p, 'utf8').match(/^\\[\\d{4}-\\d\\d-\\d\\d\\].*$/gm)))
`

function lignesDatees(fuseau: string, instant: number, racine: string): string[] {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', SCRIPT], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      TZ: fuseau,
      AOS_INSTANT: String(instant),
      AOS_RACINE: join(root, racine),
      AOS_MODULE: pathToFileURL(join(__dirname, 'conv-runs.ts')).href
    }
  })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as string[]
}

describe('date du RUN.md : le jour local du poste (conv-1602)', () => {
  it('00 h 30 à Paris : création et clôture datées du 06/11, pas du 05/11', () => {
    expect(lignesDatees('Europe/Paris', MINUIT_TRENTE_PARIS_HIVER, 'hiver')).toEqual([
      '[2026-11-06] clos la nuit',
      '[2026-11-06] Orchestration lancée depuis la conversation conv-1602.'
    ])
  })

  it("01 h 30 à Paris l'été : datées du 15/07, pas du 14/07", () => {
    expect(lignesDatees('Europe/Paris', UNE_HEURE_TRENTE_PARIS_ETE, 'ete')).toEqual([
      '[2026-07-15] clos la nuit',
      '[2026-07-15] Orchestration lancée depuis la conversation conv-1602.'
    ])
  })

  it('le même instant sur un poste à New York reste le 05/11 : le fuseau est celui du poste', () => {
    expect(lignesDatees('America/New_York', MINUIT_TRENTE_PARIS_HIVER, 'new-york')).toEqual([
      '[2026-11-05] clos la nuit',
      '[2026-11-05] Orchestration lancée depuis la conversation conv-1602.'
    ])
  })
})
