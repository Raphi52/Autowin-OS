import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { donneesDuWorker, optionsDuGestionnaireDuWorker } from './worktree-operation-protocol'

/*
 * Le worker ne relit pas la racine lui-même : il bâtit son gestionnaire par la fonction testée ci-dessus.
 * Le texte est lu, pas importé : le worker s'exécute dans un Worker et exige `parentPort`.
 */
const sourceDuWorker = readFileSync(
  new URL('./worktree-operation-worker.ts', import.meta.url),
  'utf8'
)

describe('données transmises au worker d’opérations', () => {
  it('lui transmet la racine unique : c’est le worker qui crée la copie pendant la préparation', () => {
    const donnees = donneesDuWorker({
      baseRepo: 'C:/depot-temoin',
      worktreeRoot: 'C:/data/worktrees/depot',
      racineCopiesDeTaches: 'C:/data/copies-de-taches',
      requireCanonicalRemote: true
    })

    expect(donnees.racineCopiesDeTaches).toBe('C:/data/copies-de-taches')
  })

  it('le gestionnaire que le worker construit reçoit la racine unique de ses données', () => {
    const options = optionsDuGestionnaireDuWorker(
      donneesDuWorker({
        baseRepo: 'C:/depot-temoin',
        worktreeRoot: 'C:/data/worktrees/depot',
        racineCopiesDeTaches: 'C:/data/copies-de-taches',
        requireCanonicalRemote: true
      })
    )

    expect(options.racineCopiesDeTaches).toBe('C:/data/copies-de-taches')
    expect(options.disableAsyncOperations).toBe(true)
  })

  it('le worker bâtit son gestionnaire par cette fonction : la racine ne se perd pas en chemin', () => {
    // fix-ok: la fonction des options du worker est la seule voie vers le gestionnaire ; le worker qui assemblerait ses options à part pourrait oublier la racine unique.
    expect(sourceDuWorker).toContain('new WorktreeManager(optionsDuGestionnaireDuWorker(')
    expect(sourceDuWorker).not.toMatch(/new WorktreeManager\(\{/)
  })

  it('sans racine unique, refuse de fabriquer les données du worker : aucune copie sous l’ancien dossier', () => {
    expect(() =>
      donneesDuWorker({
        baseRepo: 'C:/depot-temoin',
        worktreeRoot: 'C:/data/worktrees/depot',
        requireCanonicalRemote: false
      } as never)
    ).toThrow(/racine unique/)
  })

  it('transmet aussi la branche de base et le contrôle du distant', () => {
    const donnees = donneesDuWorker({
      baseRepo: 'C:/depot-temoin',
      worktreeRoot: 'C:/data/worktrees/depot',
      racineCopiesDeTaches: 'C:/data/copies-de-taches',
      configuredBaseBranch: 'main',
      requireCanonicalRemote: true
    })

    expect(donnees.baseBranch).toBe('main')
    expect(donnees.requireCanonicalRemote).toBe(true)
  })
})
