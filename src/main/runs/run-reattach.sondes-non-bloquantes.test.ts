import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Gels mesurés (gels.jsonl 2026-10-11 15:23-15:24, disque D: à 261 %) : la boucle de rattachement
// relisait chaque seconde la date du journal (`statSync`, 1,0 / 3,6 / 6,6 s) et le reçu
// `.exit.json` (`readFileSync`, 2,3 s) d'un run rattaché.
vi.mock('node:fs', async (orig) => {
  const reel = await orig<typeof import('node:fs')>()
  return { ...reel, statSync: vi.fn(reel.statSync), readFileSync: vi.fn(reel.readFileSync) }
})

import { writeSurvivableExit } from './stdout-journal'
import {
  releverDatesDesJournaux,
  resumeActionFor,
  sonderJournauxDuRun,
  waitUntilRunCanResume,
  type ResumeAction
} from './run-reattach'

const lecturesBloquantesDe = (chemins: string[]): unknown[][] =>
  [...vi.mocked(fs.statSync).mock.calls, ...vi.mocked(fs.readFileSync).mock.calls].filter(
    ([chemin]) => chemins.some((c) => String(chemin).startsWith(c))
  )

describe('sonderJournauxDuRun — faits disque relevés sans bloquer', () => {
  it('rend la date et le reçu de chaque journal sans statSync ni readFileSync', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'sonde-journaux-'))
    try {
      const fini = join(root, 'fini.stdout.jsonl')
      const enCours = join(root, 'en-cours.stdout.jsonl')
      const disparu = join(root, 'disparu.stdout.jsonl')
      fs.writeFileSync(fini, '{}\n', 'utf8')
      fs.writeFileSync(enCours, '{}\n', 'utf8')
      writeSurvivableExit(fini, 0)
      const state = {
        agents: [
          { token: 'a', journalPath: fini },
          { token: 'b', journalPath: enCours },
          { token: 'c', journalPath: disparu },
          { token: 'd', journalPath: fini }, // même journal : relevé une seule fois
          { token: 'e' } // pas de journal
        ]
      }
      vi.mocked(fs.statSync).mockClear()
      vi.mocked(fs.readFileSync).mockClear()

      const sonde = await sonderJournauxDuRun(state)

      expect(lecturesBloquantesDe([root])).toEqual([])
      expect(sonde.lastWriteMs(fini)).toBe(fs.statSync(fini).mtimeMs)
      expect(sonde.lastWriteMs(enCours)).toBe(fs.statSync(enCours).mtimeMs)
      expect(sonde.lastWriteMs(disparu)).toBeUndefined()
      expect(sonde.exitCodeOf(fini)).toBe(0)
      expect(sonde.exitCodeOf(enCours)).toBeUndefined()
      expect(sonde.exitCodeOf(disparu)).toBeUndefined()
      // Un chemin hors du relevé n'est jamais une preuve.
      expect(sonde.lastWriteMs(join(root, 'inconnu'))).toBeUndefined()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('une sonde qui échoue rend « on ne sait pas », sans faire échouer le relevé', async () => {
    const dates = await releverDatesDesJournaux(
      {
        agents: [
          { token: 'a', journalPath: 'X:/a.jsonl' },
          { token: 'b', journalPath: 'X:/b.jsonl' }
        ]
      },
      async (chemin) => {
        if (chemin.endsWith('a.jsonl')) throw new Error('disque indisponible')
        return 42
      }
    )
    expect(dates('X:/a.jsonl')).toBeUndefined()
    expect(dates('X:/b.jsonl')).toBe(42)
  })
})

describe('resumeActionFor — le reçu de sortie peut venir d’un relevé', () => {
  const mort = (): undefined => undefined
  const state = {
    agents: [
      {
        token: 'a',
        pid: 1,
        identity: 'sig',
        active: true,
        journalPath: 'X:/jamais-sur-disque.jsonl'
      }
    ],
    phaseOutputs: []
  }

  it('sans reçu, un appel terminé reste bloqué (comportement inchangé)', () => {
    expect(resumeActionFor(state, mort, Date.now(), undefined, () => undefined)).toBe('bloquer')
  })

  it('le reçu RELEVÉ est celui qui décide, sans relire le disque', () => {
    const exitCodeOf = vi.fn((chemin: string) =>
      chemin === 'X:/jamais-sur-disque.jsonl' ? 0 : undefined
    )
    vi.mocked(fs.readFileSync).mockClear()
    expect(resumeActionFor(state, mort, Date.now(), undefined, exitCodeOf)).toBe('relancer')
    expect(exitCodeOf).toHaveBeenCalledWith('X:/jamais-sur-disque.jsonl')
    expect(lecturesBloquantesDe(['X:/'])).toEqual([])
  })
})

describe('waitUntilRunCanResume — sondes asynchrones ATTENDUES', () => {
  it('suit une date de journal rendue par une promesse : le silence repart de zéro', async () => {
    // Le journal avance 5 sondes de suite, avec un plafond de 2 sondes muettes. Si la promesse
    // n'était pas attendue, aucune avancée ne serait vue et l'attente expirerait en « ignorer ».
    let tour = 0
    const action = await waitUntilRunCanResume(
      async (): Promise<ResumeAction> => (tour >= 5 ? 'relancer' : 'rattacher'),
      async () => {
        tour += 1
      },
      2,
      async () => tour * 1_000
    )
    expect(action).toBe('relancer')
  })

  it('un journal muet expire toujours au plafond, même avec des sondes asynchrones', async () => {
    const action = await waitUntilRunCanResume(
      async (): Promise<ResumeAction> => 'rattacher',
      async () => undefined,
      3,
      async () => 1_000
    )
    expect(action).toBe('ignorer')
  })
})

describe('câblage : les boucles de rattachement d’index.ts relèvent le disque sans bloquer', () => {
  const source = fs.readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const appels = source
    .split('waitUntilRunCanResume(')
    .slice(1)
    .map((appel) => appel.slice(0, appel.indexOf('.then(')))

  it('les deux boucles (run rattaché et doublon) sont trouvées', () => {
    expect(appels.length).toBe(2)
  })

  it.each([0, 1])('boucle %i : relevés asynchrones, aucune sonde synchrone', (i) => {
    const corps = appels[i]!.replace(/\/\/.*$/gm, '')
    expect(corps).toContain('await sonderJournauxDuRun(latest)')
    expect(corps).toContain('sonde.exitCodeOf')
    expect(corps).toContain('runJournalProgressMark(latest, await releverDatesDesJournaux(latest))')
    expect(corps).not.toContain('persistedJournalLastWriteMs')
  })
})
