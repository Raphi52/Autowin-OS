import { describe, expect, it } from 'vitest'
import { WorktreeManager, resoudreCheminWorker } from './worktree-manager'

/**
 * Le worker d'opérations Git : où on le cherche, et ce qui arrive quand une copie est cassée.
 *
 * Ces deux défauts ont été CONSTATÉS en mesurant le démarrage, pas imaginés :
 *  1. le chemin du worker était calculé depuis `__dirname`, qui vaut `out/main/chunks` pour ce module,
 *     alors que le worker vit dans `out/main`. L'isolation était donc silencieusement éteinte ;
 *  2. en l'activant, une seule copie au lien Git mort faisait échouer tout l'inventaire — 215 runs
 *     restaurés devenaient 1, sans erreur visible.
 */

describe('résolution du chemin du worker', () => {
  it('trouve le worker d’un cran au-dessus quand ce module est dans un morceau', () => {
    // C'est LE cas réel : `out/main/chunks/worktree-manager-*.js` lance `out/main/…worker.js`.
    const present = 'C:\\app\\out\\main\\worktree-operation-worker.js'
    const resolu = resoudreCheminWorker('C:\\app\\out\\main\\chunks', (c) => c === present)
    expect(resolu).toBe(present)
  })

  it('préfère le worker voisin quand il existe', () => {
    // En build packagé le worker est à côté ; remonter d'un cran alors serait un régression inverse.
    const voisin = 'C:\\app\\out\\main\\worktree-operation-worker.js'
    const resolu = resoudreCheminWorker('C:\\app\\out\\main', () => true)
    expect(resolu).toBe(voisin)
  })

  it('rend un chemin même quand rien n’existe, pour que l’appelant décide', () => {
    // `existsSync` sur ce chemin renverra faux et l'isolation restera coupée : c'est le comportement
    // voulu, pas une exception à gérer.
    const resolu = resoudreCheminWorker('C:\\vide', () => false)
    expect(resolu).toBe('C:\\vide\\worktree-operation-worker.js')
  })
})

describe('inventaire de récupération — une copie cassée n’emporte pas les autres', () => {
  const manager = (jets: { sur: string }): WorktreeManager =>
    new WorktreeManager({
      baseRepo: 'C:\\repo',
      worktreeRoot: 'C:\\copies',
      disableAsyncOperations: true,
      // Injecter `tryGitFn` suffit à rester hors du disque : aucune de ces méthodes ne doit lancer git.
      tryGitFn: () => ({ code: 0, stdout: '', stderr: '' }),
      git: () => ''
    }) as WorktreeManager & { jets: typeof jets }

  it('rapporte la copie illisible SANS ses détails, au lieu de tout perdre', () => {
    const m = manager({ sur: 'copie-cassee' })
    // On remplace les lectures par des doubles : deux copies, dont une dont le `git status` échoue.
    const brut = m as unknown as {
      listAgentIds: () => string[]
      describe: (id: string) => unknown
      hasActiveProcesses: (id: string) => boolean
      changedFiles: (id: string) => string[]
      reconcileResidues: () => unknown
    }
    brut.listAgentIds = () => ['copie-saine', 'copie-cassee']
    brut.describe = () => ({ worktreePath: 'C:\\copies\\x' })
    brut.hasActiveProcesses = () => false
    brut.changedFiles = (id) => {
      if (id === 'copie-cassee') throw new Error('fatal: not a git repository: (NULL)')
      return ['a.txt']
    }
    brut.reconcileResidues = () => ({ cleaned: 0, recovered: [], blocked: [] })

    const inventaire = m.recoveryInventory()

    // L'invariant qui compte : les DEUX copies sont là. Avant le correctif, l'exception traversait la
    // boucle et `recoveryInventory` ne rendait rien du tout.
    expect(inventaire.agents.map((a) => a.agentId)).toEqual(['copie-saine', 'copie-cassee'])
    expect(inventaire.agents[0].changedFiles).toEqual(['a.txt'])
    expect(inventaire.agents[1].changedFiles).toEqual([])
  })

  it('un `reconcileResidues` en échec laisse un inventaire de résidus VIDE, pas absent', () => {
    const m = manager({ sur: 'residus' })
    const brut = m as unknown as {
      listAgentIds: () => string[]
      reconcileResidues: () => unknown
    }
    brut.listAgentIds = () => []
    brut.reconcileResidues = () => {
      throw new Error('disque indisponible')
    }

    const inventaire = m.recoveryInventory()

    // `blocked` vide veut dire « rien à signaler » : aucun nettoyage ne sera proposé à tort.
    expect(inventaire.residues).toEqual({ cleaned: 0, recovered: [], blocked: [] })
    expect(inventaire.agents).toEqual([])
  })
})
