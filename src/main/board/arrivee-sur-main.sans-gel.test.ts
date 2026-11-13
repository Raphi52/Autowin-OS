import { ChildProcess, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { arreterFilDExecution, type OptionsHorsFil } from '../gel/execution-hors-fil'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { creerLectureDesArrivees, lireLogDeMain } from './arrivee-sur-main'

/**
 * LE JOURNAL DE MAIN DU BOARD NE TIENT PLUS LE FIL PRINCIPAL.
 *
 * Mesure `gels.jsonl` du 2026-11-13 : `execFileSync git log` de `lireLogDeMain` a figé la fenêtre
 * 120 597 ms (deux appels, à l'ouverture du chat) puis 60 446 ms (un appel) ; d'habitude il dure
 * 0,1 à 0,4 s.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 *  - un `execFileSync` (le journal rendu tout de suite, en chaîne) : la lecture n'est pas une promesse ;
 *  - un `execFile` créé par le fil principal : `ChildProcess.prototype.spawn` est appelé ;
 *  - une lecture sans délai maximal : aucun `timeout` n'est passé à la commande ;
 *  - une carte qui attend git : un `lireLog` qui ne rend jamais la main bloque `lire()`.
 */
let depot = ''
beforeAll(() => {
  depot = mkdtempSync(join(tmpdir(), 'aos-arrivee-sans-gel-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: depot, windowsHide: true, stdio: 'ignore' })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Arrivee')
  git('config', 'user.email', 'a@a')
  git('commit', '-q', '--allow-empty', '-m', 'feat(board): travail du fil (conv-4242)')
  git('commit', '-q', '--allow-empty', '-m', 'chore: sans marqueur de fil')
})
afterAll(async () => {
  await arreterFilDExecution()
  await supprimerArbre(depot)
})

const DEPUIS_TOUJOURS = 0

describe('lireLogDeMain — git par défaut', () => {
  it('lit le journal de main sans créer un seul processus sur le fil principal', async () => {
    const creations = vi.spyOn(
      ChildProcess.prototype as unknown as { spawn: () => unknown },
      'spawn'
    )
    try {
      const lecture = lireLogDeMain(depot)
      // Une chaîne rendue tout de suite = une commande synchrone qui a tenu le fil.
      expect(lecture).toBeInstanceOf(Promise)
      const journal = await lecture
      expect(journal).toContain('feat(board): travail du fil (conv-4242)')
      expect(journal).not.toContain('sans marqueur de fil')
      expect(creations).not.toHaveBeenCalled()
    } finally {
      creations.mockRestore()
    }
  })

  it('borne la commande par un délai maximal', async () => {
    let options: OptionsHorsFil | undefined
    await lireLogDeMain(depot, async (_fichier, _args, recues) => {
      options = recues
      return { stdout: '', stderr: '' }
    })
    expect(options?.timeout).toBeGreaterThan(0)
    expect(Number.isFinite(options?.timeout)).toBe(true)
  })
})

describe('creerLectureDesArrivees — la carte n’attend jamais git', () => {
  it('un git qui ne rend jamais la main : la lecture répond tout de suite, journal inconnu, une seule commande en vol', () => {
    let maintenant = 0
    let lancements = 0
    const lire = creerLectureDesArrivees(join(depot, 'pas-de-worktrees'), {
      maintenant: () => maintenant,
      ttlMs: 30_000,
      lireLog: () => {
        lancements++
        return new Promise<string>(() => {})
      }
    })
    expect(lire().filApres?.('conv-4242', DEPUIS_TOUJOURS)).toBeUndefined()
    maintenant = 60_000
    expect(lire().filApres?.('conv-4242', DEPUIS_TOUJOURS)).toBeUndefined()
    // Un git figé ne s'empile pas : la relecture attend que le précédent ait fini.
    expect(lancements).toBe(1)
  })

  it('le dernier journal lu sert pendant que le suivant se lit, puis le nouveau le remplace', async () => {
    let maintenant = 0
    let rendre: ((journal: string) => void) | undefined
    const lire = creerLectureDesArrivees(join(depot, 'pas-de-worktrees'), {
      maintenant: () => maintenant,
      ttlMs: 30_000,
      lireLog: () => new Promise<string>((resolve) => (rendre = resolve))
    })
    expect(lire().filApres?.('conv-4242', DEPUIS_TOUJOURS)).toBeUndefined()
    rendre?.('2026-11-13T10:00:00+01:00\tfeat(board): x (conv-4242)')
    await Promise.resolve()
    // Le journal arrivé sert tout de suite, sans attendre l'échéance du cache.
    expect(lire().filApres?.('conv-4242', DEPUIS_TOUJOURS)).toBe(true)

    maintenant = 30_000
    const pendantLaRelecture = lire()
    expect(pendantLaRelecture.filApres?.('conv-4242', DEPUIS_TOUJOURS)).toBe(true)
    rendre?.('2026-11-13T10:00:00+01:00\tfeat(board): y (conv-4343)')
    await Promise.resolve()
    expect(lire().filApres?.('conv-4343', DEPUIS_TOUJOURS)).toBe(true)
  })
})
