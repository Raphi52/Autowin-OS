import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import {
  detachedCommit,
  git,
  manager,
  nettoyerRacines,
  tempRepo
} from './worktree-manager.test-helpers'
import {
  changementTouchantLeRecensement,
  surveillerReferencesGit
} from './surveillance-references-git'

/**
 * LA LISTE DES TRAVAUX NON PUBLIÉS SUIT LES RÉFÉRENCES GIT, même modifiées HORS de l'app.
 *
 * Défaut constaté le 2026-10-19 (conv-360) : après un /salvage qui a supprimé treize références par
 * `git update-ref -d`, `get_state.travauxNonPublies` listait encore `a-trancher-visuel-permanent`.
 * Le relevé est en cache sans expiration et ne se refaisait que sur nos propres gestes (fin de run,
 * publication, tri) : une suppression faite dans git ne le refaisait jamais.
 *
 * Ces tests jouent le geste réel — `git update-ref` en ligne de commande, sur un vrai dépôt — et
 * lisent la liste servie aux agents (`travauxNonPubliesBornes`, celle de `get_state`).
 */

const coordinateursOuverts: RunWorktreeCoordinator[] = []

afterEach(() => {
  for (const c of coordinateursOuverts.splice(0)) {
    c.arreterLaSurveillanceDesReferences()
    c.arreterLeBalayageAutomatique()
  }
  nettoyerRacines()
})

const stateStore = { list: () => [], get: () => undefined, save: () => {}, remove: () => {} }

function monter(repo: string): RunWorktreeCoordinator {
  const c = new RunWorktreeCoordinator({
    manager: manager(repo),
    stateStore: stateStore as never,
    surveillerReferences: (siChange) => surveillerReferencesGit(repo, siChange, { delaiMs: 50 })
  })
  coordinateursOuverts.push(c)
  return c
}

const listes = (c: RunWorktreeCoordinator): string[] =>
  c.travauxNonPubliesBornes().map((entree) => entree.agentId)

describe('la liste des travaux non publiés suit les références git', () => {
  it('une référence de sauvetage SUPPRIMÉE hors de l’app sort de la liste', async () => {
    const repo = tempRepo()
    const sha = detachedCommit(repo, git(repo, 'rev-parse', 'HEAD'), 'b.txt', 'travail\n')
    git(repo, 'update-ref', 'refs/autowin/rescue/travail-sauve', sha)
    const c = monter(repo)

    await vi.waitFor(() => expect(listes(c)).toContain('travail-sauve'), { timeout: 15_000 })

    git(repo, 'update-ref', '-d', 'refs/autowin/rescue/travail-sauve', sha)

    await vi.waitFor(() => expect(listes(c)).not.toContain('travail-sauve'), {
      timeout: 15_000
    })
  }, 40_000)

  it('une référence de sauvetage CRÉÉE hors de l’app entre dans la liste', async () => {
    const repo = tempRepo()
    const c = monter(repo)
    await vi.waitFor(
      () => {
        listes(c)
        // Le premier relevé a eu lieu quand la lecture ne relance plus rien : on attend qu'il soit posé.
        expect((c as unknown as { cacheNonPublies?: unknown }).cacheNonPublies).toBeDefined()
      },
      { timeout: 15_000 }
    )
    expect(listes(c)).toEqual([])

    const sha = detachedCommit(repo, git(repo, 'rev-parse', 'HEAD'), 'c.txt', 'neuf\n')
    git(repo, 'update-ref', 'refs/autowin/rescue/sauve-dehors', sha)

    await vi.waitFor(() => expect(listes(c)).toContain('sauve-dehors'), { timeout: 15_000 })
  }, 40_000)
})

describe('le relevé périmé par un changement de références', () => {
  function avecRelevesManuels() {
    const releves: Array<{
      resoudre: (r: {
        ids: string[]
        apercu: Array<{ agentId: string; date: string; fichiers: string[] }>
      }) => void
    }> = []
    let siChange: () => void = () => {}
    const emissions: number[] = []
    const c = new RunWorktreeCoordinator({
      manager: {
        listAgentIds: () => [],
        hasActiveProcesses: () => false,
        reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
        changedFiles: () => [],
        recensementNonPubliesAsync: () =>
          new Promise((resoudre) => {
            releves.push({ resoudre })
          })
      } as never,
      stateStore: stateStore as never,
      onActivity: () => emissions.push(1),
      surveillerReferences: (rappel) => {
        siChange = rappel
        return () => {}
      }
    })
    coordinateursOuverts.push(c)
    const entree = (agentId: string) => ({ agentId, date: '2026-10-19', fichiers: ['a.ts'] })
    return { c, releves, changer: () => siChange(), emissions, entree }
  }

  const attendreMicrotaches = () => new Promise((r) => setTimeout(r, 0))

  it('rend l’ANCIEN relevé pendant le nouveau — jamais une liste vide qui ferait dire « rien à fusionner »', async () => {
    const { c, releves, changer, entree } = avecRelevesManuels()
    listes(c)
    releves[0].resoudre({ ids: ['vieux'], apercu: [entree('vieux')] })
    await attendreMicrotaches()
    expect(listes(c)).toEqual(['vieux'])

    changer()
    // Le changement relance le relevé de LUI-MÊME, sans attendre une lecture.
    expect(releves).toHaveLength(2)
    expect(listes(c)).toEqual(['vieux'])

    releves[1].resoudre({ ids: [], apercu: [] })
    await attendreMicrotaches()
    expect(listes(c)).toEqual([])
  })

  it('un relevé commencé AVANT le changement est refait, pas retenu comme frais', async () => {
    const { c, releves, changer, entree } = avecRelevesManuels()
    listes(c)
    expect(releves).toHaveLength(1)

    // Les références bougent pendant que le premier relevé est en vol : il a lu l'ancien état.
    changer()
    releves[0].resoudre({ ids: ['supprime'], apercu: [entree('supprime')] })
    await attendreMicrotaches()
    expect(releves).toHaveLength(2)

    releves[1].resoudre({ ids: [], apercu: [] })
    await attendreMicrotaches()
    expect(listes(c)).toEqual([])
    expect(releves).toHaveLength(2)
  })

  it('sans changement, la lecture ne relance AUCUN relevé (pas de retour du gel périodique)', async () => {
    const { c, releves, entree } = avecRelevesManuels()
    listes(c)
    releves[0].resoudre({ ids: ['x'], apercu: [entree('x')] })
    await attendreMicrotaches()
    for (let i = 0; i < 10; i++) listes(c)
    expect(releves).toHaveLength(1)
  })
})

describe('quels changements comptent', () => {
  it.each([
    ['racine', 'packed-refs', true],
    ['racine', 'HEAD', true],
    ['racine', 'index', false],
    ['racine', 'FETCH_HEAD', false],
    ['racine', 'packed-refs.lock', false],
    ['refs', 'heads\\main', true],
    ['refs', 'heads/autowin/recovery/run-1', true],
    ['refs', 'autowin\\rescue\\x', true],
    ['refs', 'autowin', true],
    ['refs', 'autowin/integration/y.lock', false],
    ['refs', 'remotes/origin/main', false],
    ['refs', 'tags/v1', false],
    ['refs', null, true]
  ] as const)('%s / %s → %s', (dossier, nom, attendu) => {
    expect(changementTouchantLeRecensement(dossier, nom)).toBe(attendu)
  })
})
