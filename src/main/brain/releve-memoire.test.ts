/**
 * conv-1077 (2026-10-22) : trois `electron.exe` pesaient ~872, 433 et 307 Mo, sans que rien dans
 * l'app ne dise LEQUEL est quoi (fenêtre, GPU, service). `app.getAppMetrics()` n'était appelé nulle
 * part. Ces tests fixent le relevé : rôle de chaque processus, Mo, CPU, une fois par minute.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  demarrerReleveMemoire,
  releveMemoire,
  releveMemoireFrais,
  resumerMetriques,
  type MetriqueBrute
} from './releve-memoire'

const metrique = (
  pid: number,
  type: string,
  ko: number,
  cpu: number,
  nom?: string
): MetriqueBrute => ({
  pid,
  type,
  ...(nom ? { name: nom } : {}),
  cpu: { percentCPUUsage: cpu },
  memory: { workingSetSize: ko }
})

// Les trois processus mesurés le 2026-10-22, dans un ordre qui n'est PAS celui des poids.
const TROIS = [
  metrique(10, 'GPU', 433 * 1024, 2.5),
  metrique(11, 'Browser', 307 * 1024, 1),
  metrique(12, 'Tab', 872 * 1024, 14.25)
]

describe('relevé mémoire et processeur (conv-1077)', () => {
  afterEach(() => vi.useRealTimers())

  it('chaque processus avec son rôle, en Mo, du plus lourd au plus léger, et le total', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si les Ko d'Electron passaient tels quels ou sans tri :
    // 433 Mo, 307 Mo, 872 Mo dans cet ordre.
    const r = resumerMetriques(TROIS, '2026-10-22T12:00:00.000Z')
    expect(r.processus.map((p) => [p.type, p.memoireMo, p.cpuPct])).toEqual([
      ['Tab', 872, 14.3],
      ['GPU', 433, 2.5],
      ['Browser', 307, 1]
    ])
    expect(r.totalMo).toBe(1612)
    expect(r.ts).toBe('2026-10-22T12:00:00.000Z')
  })

  it('jumeau : une métrique sans mémoire ni CPU lisible compte pour zéro, sans casser le relevé', () => {
    const r = resumerMetriques(
      [{ pid: 1, type: 'Utility', name: 'Network Service' } as MetriqueBrute],
      '2026-10-22T12:00:00.000Z'
    )
    expect(r.processus).toEqual([
      { pid: 1, type: 'Utility', nom: 'Network Service', memoireMo: 0, cpuPct: 0 }
    ])
  })

  it('un relevé au démarrage, puis un par période ; sur disque le 1er puis un tous les 10', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'releve-memoire-'))
    let appels = 0
    const arreter = demarrerReleveMemoire({
      dossier: dir,
      lire: () => {
        appels++
        return TROIS
      },
      periodeMs: 60_000
    })
    try {
      expect(appels).toBe(1)
      expect(releveMemoire().dernier?.totalMo).toBe(1612)
      await vi.advanceTimersByTimeAsync(60_000 * 10)
      expect(appels).toBe(11)
      expect(releveMemoire().echantillons).toBe(11)
      expect(releveMemoire().picTotalMo).toBe(1612)
      vi.useRealTimers()
      const fichier = join(dir, 'memoire.jsonl')
      await vi.waitFor(() => {
        expect(existsSync(fichier)).toBe(true)
        expect(readFileSync(fichier, 'utf8').trim().split(/\r?\n/)).toHaveLength(2)
      })
    } finally {
      arreter()
      rmSync(dir, { recursive: true, force: true })
    }
    // Arrêté : plus aucun relevé.
    const avant = appels
    await new Promise((r) => setTimeout(r, 20))
    expect(appels).toBe(avant)
  })

  it('demandé par l’écran 6 s après, le relevé est refait : la fenêtre ouverte depuis apparaît', () => {
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si l'écran recevait le relevé du démarrage : premier
    // relevé pris AVANT la fenêtre (processus principal seul, constaté le 2026-10-22 sur une
    // instance cachée : « Processus principal 232 Mo » et rien d'autre pendant une minute).
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'releve-memoire-frais-'))
    let processus = [metrique(11, 'Browser', 232 * 1024, 0)]
    let appels = 0
    const arreter = demarrerReleveMemoire({
      dossier: dir,
      lire: () => {
        appels++
        return processus
      },
      periodeMs: 60_000
    })
    try {
      processus = TROIS
      vi.advanceTimersByTime(6_000)
      expect(releveMemoireFrais().dernier?.processus.map((p) => p.type)).toEqual([
        'Tab',
        'GPU',
        'Browser'
      ])
      // Redemandé 4 s plus tard, il est refait aussi : plus aucun seuil d'âge (conv-1077, voir le
      // test « 1 s après »). Le relevé de cadence, lui, ne s'ajoute pas : un seul appel de plus.
      const avant = appels
      vi.advanceTimersByTime(4_000)
      releveMemoireFrais()
      expect(appels).toBe(avant + 1)
    } finally {
      arreter()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('demandé par l’écran 1 s après le relevé d’avant la fenêtre, il est refait : la fenêtre apparaît', () => {
    // fix-ok: cause mesurée 2026-10-22 (conv-1077, capture ui-capture code-construit 16:07:40) — onglet
    // ouvert moins de 5 s après le premier relevé : seuil de 5 s → l'écran recevait [Browser] seul.
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si un seuil d'âge revenait : la demande à 1 s.
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'releve-memoire-1s-'))
    let processus = [metrique(11, 'Browser', 201 * 1024, 0)]
    const arreter = demarrerReleveMemoire({
      dossier: dir,
      lire: () => processus,
      periodeMs: 60_000
    })
    try {
      processus = TROIS
      vi.advanceTimersByTime(1_000)
      expect(releveMemoireFrais().dernier?.processus.map((p) => p.type)).toEqual([
        'Tab',
        'GPU',
        'Browser'
      ])
    } finally {
      arreter()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('une source qui lève ne casse rien : le relevé précédent reste affiché', () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'releve-memoire-erreur-'))
    let casse = false
    const arreter = demarrerReleveMemoire({
      dossier: dir,
      lire: () => {
        if (casse) throw new Error('getAppMetrics indisponible')
        return TROIS
      },
      periodeMs: 1000
    })
    try {
      casse = true
      vi.advanceTimersByTime(1000)
      expect(releveMemoire().dernier?.totalMo).toBe(1612)
    } finally {
      arreter()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
