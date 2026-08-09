import { describe, expect, it } from 'vitest'
import {
  branchLabel,
  foldRepoScan,
  isWorktree,
  ownerOfWorktree,
  readRepoInventory,
  sortRepos,
  type ScannedGitDir
} from './repo-inventory'

/** La forme RÉELLE de cette machine : 5 dépôts et 6 worktreees, mesurée avant d'écrire ce test. */
const SCAN_REEL: ScannedGitDir[] = [
  {
    path: 'C:\\Code RIG\\RIG-TV',
    worktree: false,
    owner: 'RIG-TV',
    branch: 'rig-tv-fixes',
    commits: 59
  },
  { path: 'C:\\Code RIG\\RIG-TV-alertes', worktree: true, owner: 'RIG-TV', commits: 4 },
  { path: 'C:\\Code RIG\\RIG-TV-dcademat', worktree: true, owner: 'RIG-TV', commits: 4 },
  { path: 'C:\\Code RIG\\_ab\\nu', worktree: true, owner: 'RIG-TV', commits: 15 },
  { path: 'C:\\Code RIG\\_ab\\pipeline', worktree: true, owner: 'RIG-TV', commits: 15 },
  { path: 'C:\\Code RIG\\RIG-V3', worktree: false, owner: 'RIG-V3', branch: 'main', commits: 405 },
  {
    path: 'C:\\Code RIG\\RigApplication',
    worktree: false,
    owner: 'RigApplication',
    branch: 'Development',
    commits: 1589
  },
  { path: 'C:\\Code RIG\\wt-edilot3', worktree: true, owner: 'RigApplication', commits: 1095 },
  { path: 'C:\\Code RIG\\wt-NoComReg', worktree: true, owner: 'RigApplication', commits: 1654 },
  {
    path: 'C:\\Amitel\\Autowin OS',
    worktree: false,
    owner: 'Autowin OS',
    branch: 'main',
    commits: 536
  },
  {
    path: 'C:\\Amitel\\Fiche_Nouveau_Collaborateur',
    worktree: false,
    owner: 'Fiche_Nouveau_Collaborateur',
    branch: 'feat/next-migration',
    commits: 66
  }
]

describe('replier un balayage en dépôts — le cœur, sans git', () => {
  it('ne garde QUE les dépôts : 11 dossiers git → 5 dépôts', () => {
    // Le piège central : un worktree porte un `.git` lui aussi. Les compter annoncerait 11 dépôts.
    const repos = foldRepoScan(SCAN_REEL)
    expect(repos).toHaveLength(5)
    expect(repos.map((r) => r.name)).toEqual([
      'RigApplication',
      'Autowin OS',
      'RIG-V3',
      'Fiche_Nouveau_Collaborateur',
      'RIG-TV'
    ])
  })

  it('rattache chaque worktree à SON dépôt, sans en perdre aucun', () => {
    const repos = foldRepoScan(SCAN_REEL)
    const parNom = new Map(repos.map((r) => [r.name, r]))
    expect(parNom.get('RIG-TV')?.worktrees).toBe(4)
    expect(parNom.get('RigApplication')?.worktrees).toBe(2)
    expect(parNom.get('Autowin OS')?.worktrees).toBe(0)
    // Aucun worktree ne s'évapore : 4 + 2 = les 6 du balayage.
    const total = repos.reduce((s, r) => s + r.worktrees, 0)
    expect(total).toBe(SCAN_REEL.filter((s) => s.worktree).length)
  })

  it('ordonne du plus VIVANT au plus dormant', () => {
    const repos = foldRepoScan(SCAN_REEL)
    expect(repos.map((r) => r.commits)).toEqual([1589, 536, 405, 66, 59])
  })

  it('départage deux dépôts à égalité par leur nom, pour un ordre stable', () => {
    const egaux = sortRepos([
      { name: 'zebre', path: 'z', commits: 10, worktrees: 0 },
      { name: 'alpha', path: 'a', commits: 10, worktrees: 0 }
    ])
    expect(egaux.map((r) => r.name)).toEqual(['alpha', 'zebre'])
  })

  it('ne compte pas deux fois un dépôt atteint par deux racines', () => {
    const repos = foldRepoScan([
      { path: 'C:\\x\\Repo', worktree: false, owner: 'Repo', commits: 3 },
      { path: 'c:\\x\\repo', worktree: false, owner: 'Repo', commits: 3 }
    ])
    expect(repos).toHaveLength(1)
  })

  it('garde independants deux depots homonymes et leurs worktrees', () => {
    const repos = foldRepoScan([
      {
        path: 'C:\\A\\Repo',
        worktree: false,
        owner: 'Repo',
        ownerPath: 'C:\\A\\Repo',
        commits: 10
      },
      {
        path: 'C:\\A\\Repo-wt',
        worktree: true,
        owner: 'Repo',
        ownerPath: 'C:\\A\\Repo',
        commits: 2
      },
      {
        path: 'D:\\B\\Repo',
        worktree: false,
        owner: 'Repo',
        ownerPath: 'D:\\B\\Repo',
        commits: 20
      },
      {
        path: 'D:\\B\\Repo-wt-1',
        worktree: true,
        owner: 'Repo',
        ownerPath: 'D:\\B\\Repo',
        commits: 3
      },
      {
        path: 'D:\\B\\Repo-wt-2',
        worktree: true,
        owner: 'Repo',
        ownerPath: 'D:\\B\\Repo',
        commits: 4
      }
    ])

    expect(repos.find((repo) => repo.path === 'C:\\A\\Repo')?.worktrees).toBe(1)
    expect(repos.find((repo) => repo.path === 'D:\\B\\Repo')?.worktrees).toBe(2)
  })
})

describe('libellé de branche', () => {
  it('rend la branche nommée', () => {
    expect(branchLabel('Development')).toBe('Development')
  })

  it('ne présente PAS une tête détachée comme une branche nommée « HEAD »', () => {
    // C'est ce que git rend sur un worktree détaché : l'afficher serait un mensonge discret.
    expect(branchLabel('HEAD')).toBeUndefined()
    expect(branchLabel('  HEAD  ')).toBeUndefined()
    expect(branchLabel(undefined)).toBeUndefined()
    expect(branchLabel('')).toBeUndefined()
  })
})

describe('distinguer un dépôt d’un worktree', () => {
  it('reconnaît un DÉPÔT : ses deux répertoires git coïncident', () => {
    expect(isWorktree('C:\\Code RIG\\RIG-TV\\.git', 'C:\\Code RIG\\RIG-TV\\.git')).toBe(false)
  })

  it('reconnaît un WORKTREE : son répertoire git pointe ailleurs', () => {
    // La forme réelle : `RIG-TV-alertes` est un worktree de `RIG-TV`.
    expect(
      isWorktree('C:\\Code RIG\\RIG-TV\\.git\\worktrees\\alertes', 'C:\\Code RIG\\RIG-TV\\.git')
    ).toBe(true)
  })

  it('ne se laisse pas tromper par la casse, les séparateurs ou un / final', () => {
    // Sur Windows git rend volontiers des chemins en slashes avant, et parfois avec un / final :
    // comparer les chaînes brutes ferait passer un dépôt pour un worktree.
    expect(isWorktree('C:/Code RIG/RIG-TV/.git', 'C:\\Code RIG\\RIG-TV\\.git')).toBe(false)
    expect(isWorktree('c:\\code rig\\rig-tv\\.git\\', 'C:\\Code RIG\\RIG-TV\\.git')).toBe(false)
  })

  it('nomme le dépôt propriétaire d’un worktree', () => {
    expect(ownerOfWorktree('C:\\Code RIG\\RigApplication\\.git')).toBe('RigApplication')
    expect(ownerOfWorktree('C:/Code RIG/RIG-TV/.git')).toBe('RIG-TV')
  })
})

describe('inventaire sur le dépôt réel', () => {
  it('trouve ce dépôt, avec sa branche et un compte de commits plausible', async () => {
    const inventory = await readRepoInventory([process.cwd()])
    const self = inventory.repos.find((repo) => repo.name === 'Autowin OS')
    expect(self).toBeDefined()
    expect(self?.branch).toBeTruthy()
    expect(self?.commits ?? 0).toBeGreaterThan(100)
    expect(inventory.error).toBeUndefined()
  })

  it('n’annonce AUCUN worktree comme un dépôt', async () => {
    const inventory = await readRepoInventory([process.cwd()])
    // Le piège qui aurait annoncé « 11 repos » pour 5 : un worktree porte un `.git` lui aussi.
    for (const repo of inventory.repos) {
      expect(repo.name.startsWith('wt-')).toBe(false)
    }
  })

  it('dégrade proprement sur une racine inexistante au lieu de jeter', async () => {
    const inventory = await readRepoInventory(['Z:\\racine\\qui\\n\\existe\\pas'])
    expect(inventory.repos).toEqual([])
    expect(inventory.roots).toEqual([])
    expect(inventory.error).toBeUndefined()
  })

  it('ordonne du plus vivant au plus dormant', async () => {
    const inventory = await readRepoInventory([process.cwd()])
    const commits = inventory.repos.map((repo) => repo.commits ?? 0)
    expect([...commits].sort((a, b) => b - a)).toEqual(commits)
  })
})
