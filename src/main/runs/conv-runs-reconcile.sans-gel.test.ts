import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * LA RÉCONCILIATION NE DOIT PLUS GELER LE DÉMARRAGE.
 *
 * Mesure (`gels.jsonl`) : « démarrage : construction de la fenêtre » bloquée 1 034 ms le
 * 2026-09-22 07:03, dont 779 ms d'`openSync` en 705 appels ; encore 1 216 ms dont 900 ms
 * d'`openSync` en 826 appels le 2026-10-13 14:10. L'appelant est `commencePar` <
 * `reconcileAbandonedConvRuns` : l'appel était lancé par `setImmediate` (« le démarrage ne doit rien
 * attendre »), mais son corps restait synchrone, donc sur le même fil que la fenêtre qui se charge.
 *
 * Deux exigences : aucune entrée-sortie synchrone, et ne plus relire à chaque démarrage les
 * centaines de RUN.md déjà examinés et clos.
 */
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    openSync: vi.fn(original.openSync),
    readSync: vi.fn(original.readSync),
    closeSync: vi.fn(original.closeSync),
    statSync: vi.fn(original.statSync),
    readdirSync: vi.fn(original.readdirSync),
    readFileSync: vi.fn(original.readFileSync),
    writeFileSync: vi.fn(original.writeFileSync)
  }
})

const HEURE = 3_600_000
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) {
    rmSync(r, { recursive: true, force: true })
  }
})

function racine(): { root: string; memoPath: string } {
  const dossier = mkdtempSync(join(tmpdir(), 'autowin-reconcile-sans-gel-'))
  racines.push(dossier)
  return { root: join(dossier, 'runs'), memoPath: join(dossier, 'runs-reconciliation.json') }
}

function vieillirDe(path: string, heures: number): void {
  const quand = new Date(Date.now() - heures * HEURE)
  utimesSync(path, quand, quand)
}

function statutDe(path: string): string {
  return readFileSync(path, 'utf8').split(/\r?\n/)[0]
}

const SYNCHRONES = [
  'openSync',
  'readSync',
  'closeSync',
  'statSync',
  'readdirSync',
  'readFileSync',
  'writeFileSync'
] as const

describe('reconcileAbandonedConvRuns — sans gel du démarrage', () => {
  it('parcourt, lit et clôt sans une seule entrée-sortie synchrone', async () => {
    const { createConvRun, reconcileAbandonedConvRuns } = await import('./conv-runs')
    const { root, memoPath } = racine()
    const abandonne = createConvRun('conv-1', 'une tache abandonnee', root)
    vieillirDe(abandonne, 72)
    const fini = createConvRun('conv-2', 'une tache finie', root)
    writeFileSync(fini, readFileSync(fini, 'utf8').replace(/^status: open/m, 'status: green'))
    vieillirDe(fini, 72)
    for (const nom of SYNCHRONES) vi.mocked(fs[nom]).mockClear()

    const bilan = await reconcileAbandonedConvRuns({ root, memoPath })

    for (const nom of SYNCHRONES) {
      expect(vi.mocked(fs[nom]), `${nom} tient le fil principal`).not.toHaveBeenCalled()
    }
    expect(bilan.closed).toBe(1)
    expect(statutDe(abandonne)).toBe('status: interrupted')
    expect(statutDe(fini)).toBe('status: green')
  })

  it('ne relit pas au démarrage suivant un RUN.md déjà examiné et inchangé', async () => {
    const { createConvRun, reconcileAbandonedConvRuns } = await import('./conv-runs')
    const { root, memoPath } = racine()
    const fini = createConvRun('conv-3', 'une tache finie', root)
    writeFileSync(fini, readFileSync(fini, 'utf8').replace(/^status: open/m, 'status: green'))
    vieillirDe(fini, 72)
    const premier = await reconcileAbandonedConvRuns({ root, memoPath })
    expect(premier.closed).toBe(0)

    // Discriminant : on rouvre le fichier SANS changer son mtime. Une passe qui relit encore le
    // contenu le verrait `open` et le clôturerait ; une passe qui saute les fichiers déjà examinés
    // n'y touche pas.
    writeFileSync(fini, readFileSync(fini, 'utf8').replace(/^status: green/m, 'status: open'))
    vieillirDe(fini, 72)

    const second = await reconcileAbandonedConvRuns({ root, memoPath })

    expect(second.closed).toBe(0)
    expect(second.dejaVerifies).toBe(1)
    expect(statutDe(fini)).toBe('status: open')
  })

  it('un run trop récent à la passe précédente est examiné dès qu’il a vieilli', async () => {
    const { createConvRun, reconcileAbandonedConvRuns } = await import('./conv-runs')
    const { root, memoPath } = racine()
    const enVol = createConvRun('conv-4', 'une tache en vol', root)
    vieillirDe(enVol, 1)
    const premier = await reconcileAbandonedConvRuns({ root, memoPath })
    expect(premier.closed).toBe(0)
    expect(statutDe(enVol)).toBe('status: open')

    // Un jour plus tard, il n'a toujours pas été clos : c'est un abandon. Le mémo ne doit pas
    // l'avoir rangé parmi les « déjà vérifiés » — il était trop jeune pour être examiné.
    const second = await reconcileAbandonedConvRuns({
      root,
      memoPath,
      now: Date.now() + 25 * HEURE
    })

    expect(second.closed).toBe(1)
    expect(statutDe(enVol)).toBe('status: interrupted')
  })

  it('une passe tronquée par le plafond n’avance pas le mémo — le reste est repris', async () => {
    const { createConvRun, reconcileAbandonedConvRuns } = await import('./conv-runs')
    const { root, memoPath } = racine()
    const chemins: string[] = []
    for (let n = 0; n < 5; n++) {
      const path = createConvRun('conv-5', `tache ${n}`, root, () => Date.now() + n)
      vieillirDe(path, 72)
      chemins.push(path)
    }

    const premier = await reconcileAbandonedConvRuns({ root, memoPath, max: 2 })
    expect(premier).toMatchObject({ closed: 2, remaining: 3 })
    const second = await reconcileAbandonedConvRuns({ root, memoPath, max: 2 })
    expect(second).toMatchObject({ closed: 2, remaining: 1 })
    const troisieme = await reconcileAbandonedConvRuns({ root, memoPath, max: 2 })
    expect(troisieme).toMatchObject({ closed: 1, remaining: 0 })

    expect(chemins.map(statutDe)).toEqual(Array(5).fill('status: interrupted'))
  })

  it('un mémo illisible fait tout réexaminer, sans faire échouer la passe', async () => {
    const { createConvRun, reconcileAbandonedConvRuns } = await import('./conv-runs')
    const { root, memoPath } = racine()
    const abandonne = createConvRun('conv-6', 'une tache abandonnee', root)
    vieillirDe(abandonne, 72)
    writeFileSync(memoPath, '{ pas du json', 'utf8')

    const bilan = await reconcileAbandonedConvRuns({ root, memoPath })

    expect(bilan.closed).toBe(1)
    expect(statutDe(abandonne)).toBe('status: interrupted')
  })
})
