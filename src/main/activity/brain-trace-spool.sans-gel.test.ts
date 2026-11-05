import * as fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * L'AJOUT D'UNE TRACE BRAIN NE TIENT PLUS LE FIL PRINCIPAL (conv-1598, 2026-11-05).
 *
 * `gels.jsonl`, matinée du 05/11 (05:00 → 09:10 UTC) : `appendFileSync` de `brain-trace-spool.ts:192`
 * a figé la fenêtre 29 s, une ligne de quelques Ko à chaque fois, appelé depuis `orchestration.ts:595`
 * (17,3 s), `brain-titres-du-tour.ts:273` (5,7 s), `commands.ts:1135` (4,5 s), `memoire.ts:132`. Le SSD
 * était inactif à 93 % : le mur est au-dessus du disque (`scripts/trace-blocage-disque.ps1`).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un `appendBrainTrace` qui touche le disque en bloquant (même
 * un `existsSync`) ; une trace déposée et pas encore posée que `readBrainTraces` ne voit pas ; une
 * trace en attente perdue à la fermeture ; une écriture refusée qui n'est pas comptée.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    appendFileSync: vi.fn(real.appendFileSync),
    existsSync: vi.fn(real.existsSync),
    statSync: vi.fn(real.statSync),
    mkdirSync: vi.fn(real.mkdirSync),
    renameSync: vi.fn(real.renameSync)
  }
})

const {
  appendBrainTrace,
  attendreEcrituresTracesBrain,
  brainTraceSpoolHealth,
  flushBrainTraces,
  readBrainTraces
} = await import('./brain-trace-spool')

const espions = [fs.appendFileSync, fs.existsSync, fs.statSync, fs.mkdirSync, fs.renameSync].map(
  (fonction) => vi.mocked(fonction)
)
const appelsBloquants = (): number =>
  espions.reduce((total, espion) => total + espion.mock.calls.length, 0)

const trace = (query: string): Parameters<typeof appendBrainTrace>[0] => ({
  timestamp: '2026-11-05T09:00:00.000Z',
  conversationId: 'conv-gel',
  turnId: 'tour-1',
  query,
  injectedChars: 1
})

let base = ''
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'brain-spool-sans-gel-'))
  for (const espion of espions) espion.mockClear()
})
afterEach(async () => {
  await attendreEcrituresTracesBrain()
  rmSync(base, { recursive: true, force: true })
})

describe('appendBrainTrace — hors du fil principal', () => {
  it('ne fait aucun appel disque bloquant, et la trace se relit avant d’être posée', async () => {
    const rendu = appendBrainTrace(trace('avant le disque'), base)

    expect(appelsBloquants()).toBe(0)
    expect(rendu?.id).toBeTruthy()
    expect(readBrainTraces('conv-gel', base).map((t) => t.query)).toEqual(['avant le disque'])

    await attendreEcrituresTracesBrain()
    const fichier = join(base, 'brain-trace-spool', 'events.jsonl')
    expect(fs.readFileSync(fichier, 'utf8')).toContain('avant le disque')
    // Posée : relue une fois, pas deux (disque + mémoire).
    expect(readBrainTraces('conv-gel', base)).toHaveLength(1)
  })

  it('une rafale garde l’ordre et ne perd rien', async () => {
    for (let i = 0; i < 20; i++) appendBrainTrace(trace(`q${i}`), base)
    expect(appelsBloquants()).toBe(0)
    await attendreEcrituresTracesBrain()
    const lignes = fs
      .readFileSync(join(base, 'brain-trace-spool', 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((ligne) => (JSON.parse(ligne) as { query: string }).query)
    expect(lignes).toEqual(Array.from({ length: 20 }, (_, i) => `q${i}`))
  })

  it('la fermeture pose sur place ce qui attend encore', () => {
    appendBrainTrace(trace('à la fermeture'), base)

    flushBrainTraces()

    const fichier = join(base, 'brain-trace-spool', 'events.jsonl')
    expect(fs.readFileSync(fichier, 'utf8')).toContain('à la fermeture')
  })

  it('une écriture refusée est comptée comme perdue, et nommée', async () => {
    const fauxBase = join(base, 'un-fichier')
    fs.writeFileSync(fauxBase, 'pas un dossier', 'utf8')
    const avant = brainTraceSpoolHealth().tracesPerdues

    appendBrainTrace(trace('condamnée'), fauxBase)
    await attendreEcrituresTracesBrain()

    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant + 1)
    expect(brainTraceSpoolHealth().derniereErreur).toBeTruthy()
  })
})
