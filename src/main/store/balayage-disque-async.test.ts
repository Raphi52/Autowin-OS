import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../fs-supprimer'
import { WorktreeManager } from './worktree-manager'
import { roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE BALAYAGE « NON BLOQUANT » SUPPRIMAIT LA COPIE EN SYNCHRONE — heal conv-1115, 2026-10-23.
 *
 * Mesuré dans `gels.jsonl` (2026-10-22, 15:27 → 15:32) : 273,7 s de fenêtre figée en 4 gels, dont
 * un de 153,8 s, sur 10 190 `unlinkSync` remontés à `fs-supprimer.ts:111 < :143` dans le bundle de
 * `worktree-manager`. Le balayage horaire passe par `sweepAbandonedAgentCopiesAsync`, écrit pour ne
 * pas tenir la boucle : seul l'appel à git était asynchrone. Quand git ne peut pas retirer la copie
 * (copie déjà oubliée par git, ou `worktree remove --force` en échec), l'escalade vers le disque
 * appelait `supprimerArbre` — un parcours SYNCHRONE de toute l'arborescence, sur le fil principal.
 *
 * Ces tests comptent les tours de boucle d'événements PENDANT le retrait : git est simulé par des
 * promesses déjà résolues (micro-tâches, aucun tour de boucle), donc tout tour compté vient du
 * retrait disque lui-même. Zéro tour = la fenêtre était figée pendant toute la suppression.
 */

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      supprimerArbre(d)
    } catch {
      /* verrou Windows passager : le dossier temporaire sera purgé plus tard */
    }
  }
})

type AccesPrive = { balayerLeCheminAsync(path: string): Promise<boolean> }
const prive = (wm: WorktreeManager): AccesPrive => wm as unknown as AccesPrive

type Sortie = { code: number; stdout: string; stderr: string }

/** Une copie d'agent assez lourde pour que son retrait se voie : `fichiers` fichiers en 20 dossiers. */
function copieLourde(racine: string, fichiers = 400): string {
  const chemin = join(racine, 'agent__run-oublie')
  for (let i = 0; i < fichiers; i++) {
    const dossier = join(chemin, `d${i % 20}`)
    mkdirSync(dossier, { recursive: true })
    writeFileSync(join(dossier, `f${i}.txt`), 'x')
  }
  return chemin
}

/** Git simulé : `worktree remove` échoue toujours ; la copie est enregistrée ou non. */
function gitSimule(chemin: string, enregistree: boolean): (repo: string, args: string[]) => Sortie {
  return (_repo, args) => {
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { code: 0, stdout: enregistree ? `worktree ${chemin}\n` : '', stderr: '' }
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      return { code: 1, stdout: '', stderr: 'contains modified or untracked files' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
}

/** Compte les tours de boucle d'événements (phase `setImmediate`) pendant `travail`. */
async function toursPendant<T>(travail: () => Promise<T>): Promise<{ resultat: T; tours: number }> {
  let tours = 0
  let actif = true
  const tourner = (): void => {
    if (!actif) return
    tours += 1
    setImmediate(tourner)
  }
  setImmediate(tourner)
  const resultat = await travail()
  actif = false
  return { resultat, tours }
}

function preparer(enregistree: boolean): { wm: WorktreeManager; chemin: string } {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-async-'))
  roots.push(racine)
  const chemin = copieLourde(racine)
  const git = gitSimule(chemin, enregistree)
  const wm = new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: racine,
    tryGitFn: git,
    tryGitAsyncFn: async (repo, args) => git(repo, args)
  })
  return { wm, chemin }
}

describe('balayage asynchrone : le retrait disque rend la main à la boucle', () => {
  it('copie oubliée de git (retrait par le disque seul) : supprimée sans figer la boucle', async () => {
    const { wm, chemin } = preparer(false)

    const { resultat, tours } = await toursPendant(() => prive(wm).balayerLeCheminAsync(chemin))

    expect(resultat).toBe(true)
    expect(existsSync(chemin)).toBe(false)
    expect(tours).toBeGreaterThan(20)
  })

  it('copie enregistrée dont `remove --force` échoue : l’escalade disque ne fige pas la boucle', async () => {
    const { wm, chemin } = preparer(true)

    const { resultat, tours } = await toursPendant(() => prive(wm).balayerLeCheminAsync(chemin))

    expect(resultat).toBe(true)
    expect(existsSync(chemin)).toBe(false)
    expect(tours).toBeGreaterThan(20)
  })

  it('un `removeDirFn` injecté seul répond aussi pour la forme asynchrone (un test qui simule le disque le simule partout)', async () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-async-'))
    roots.push(racine)
    const chemin = copieLourde(racine, 3)
    const git = gitSimule(chemin, false)
    const retires: string[] = []
    const wm = new WorktreeManager({
      baseRepo: repo,
      worktreeRoot: racine,
      tryGitFn: git,
      tryGitAsyncFn: async (r, args) => git(r, args),
      removeDirFn: (p) => {
        retires.push(p)
        throw new Error('EBUSY: verrou Windows simulé')
      }
    })

    expect(await prive(wm).balayerLeCheminAsync(chemin)).toBe(false)
    expect(retires).toEqual([chemin])
    expect(wm.blocagesDeBalayage()[0]?.detail).toMatch(/EBUSY/)
  })
})
