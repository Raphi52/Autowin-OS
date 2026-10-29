import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * LES DATES DES RUN.md SE LISENT ENSEMBLE, PAS L'UNE APRÈS L'AUTRE (conv-1248, 2026-10-29).
 *
 * `scanRunsBounded` attendait chaque `stat` avant de lancer le suivant : ~1 150 allers-retours
 * disque d'affilée sur le poste (1 127 runs hors fenêtre). Mesuré sur la vraie racine : 55 à 90 ms
 * par scan, contre 16 à 39 ms en les lançant ensemble, résultat identique au caractère près. Dans
 * l'app, chaque attente repasse derrière le reste du processus principal : 111 ms en médiane
 * (`snapshot:runs`, 300 tours) — à chaque tour de chat ET à chaque ouverture du Board.
 */
const enVol = vi.hoisted(() => ({ stat: 0, statMax: 0, lecture: 0, lectureMax: 0 }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:fs/promises')>()
  const pause = (): Promise<void> => new Promise((r) => setTimeout(r, 2))
  return {
    ...reel,
    stat: async (...args: Parameters<typeof reel.stat>) => {
      enVol.stat += 1
      enVol.statMax = Math.max(enVol.statMax, enVol.stat)
      try {
        await pause()
        return await reel.stat(...args)
      } finally {
        enVol.stat -= 1
      }
    },
    readFile: async (...args: Parameters<typeof reel.readFile>) => {
      enVol.lecture += 1
      enVol.lectureMax = Math.max(enVol.lectureMax, enVol.lecture)
      try {
        await pause()
        return await reel.readFile(...args)
      } finally {
        enVol.lecture -= 1
      }
    }
  }
})

const { scanRunsBounded } = await import('./runs-scan')

/** Deux sessions de cinq runs, le plus récent en dernier. */
function racine(): string {
  const root = mkdtempSync(join(tmpdir(), 'runs-concurrence-'))
  let rang = 0
  for (const session of ['conv-1', 'conv-2'])
    for (let i = 0; i < 5; i += 1) {
      const dir = join(root, session, `run-${session}-${i}-workspace`)
      mkdirSync(dir, { recursive: true })
      const p = join(dir, 'RUN.md')
      writeFileSync(p, `status: red\nsession: ${session}\n\n## Besoin\nx\n`, 'utf8')
      const t = new Date(Date.now() - (100 - rang++) * 60_000)
      utimesSync(p, t, t)
    }
  return root
}

describe('scan des runs — lectures concurrentes', () => {
  it('lance les dix dates de RUN.md ensemble, et les lectures des retenus aussi', async () => {
    const root = racine()
    const { entries, remaining } = await scanRunsBounded(root, { limit: 4 })
    expect(enVol.statMax).toBe(10)
    expect(enVol.lectureMax).toBe(4)
    // Même résultat qu'une lecture une par une : les plus récents d'abord, le reste compté.
    expect(entries.map((e) => e.subject)).toEqual([
      'run-conv-2-4',
      'run-conv-2-3',
      'run-conv-2-2',
      'run-conv-2-1'
    ])
    expect(remaining).toBe(6)
  })
})
