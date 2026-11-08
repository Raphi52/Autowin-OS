import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre, supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { WorktreeManager } from './worktree-manager'
import { roots, tempRepo } from './worktree-manager.test-helpers'

/*
 * LA SUPPRESSION COUPÉE NE REPRENAIT JAMAIS. Constat du 08/11 : 22 copies d'agent sans `.git`,
 * absentes de `git worktree list`, restées sur le disque. La suppression retire d'abord le lien git
 * (c'est git qui le fait), puis le retrait du dossier s'arrête sous verrou Windows. Le dossier reste,
 * sans lien : `ownershipIssueAsync` le refuse à chaque passage, et rien ne le reprend jamais.
 *
 * Ces tests rejouent la panne avec un git simulé qui retire le lien `.git` puis échoue, et un disque
 * qui refuse le retrait tant que le verrou tient.
 */

// fix-ok: cause mesurée — avant correctif, les 3 tests de reprise échouent sur `existsSync` (le dossier sans `.git` reste, refusé par `ownershipIssueAsync`) ; les gardes sont vertes avant et après.

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      supprimerArbre(d)
    } catch {
      /* verrou Windows passager : le dossier temporaire sera purgé plus tard */
    }
  }
})

type Sortie = { code: number; stdout: string; stderr: string }
type Acces = {
  balayerLeCheminAsync(path: string): Promise<boolean>
  balayerLeChemin(path: string): boolean
}
const prive = (wm: WorktreeManager): Acces => wm as unknown as Acces

const UN_JOUR_MS = 86_400_000

function reussi(stdout: string): Sortie {
  return { code: 0, stdout, stderr: '' }
}

function depot(): { base: string; racine: string } {
  const base = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-suppression-reprise-'))
  roots.push(racine)
  return { base, racine }
}

/** Une copie d'agent telle que git la crée : un travail et un fichier `.git` qui la rattache au dépôt. */
function copie(racine: string, id: string): string {
  const chemin = join(racine, `agent__${id}`)
  mkdirSync(join(chemin, 'src'), { recursive: true })
  writeFileSync(join(chemin, 'src', 'travail.txt'), 'travail déjà publié')
  writeFileSync(join(chemin, '.git'), 'gitdir: simulé')
  return chemin
}

/**
 * Git simulé. `worktree remove` reproduit la panne mesurée : il retire le lien `.git` D'ABORD, puis
 * échoue. Le dossier reste, sans lien — l'état des 22 copies du 08/11.
 */
function gitFaux(base: string, inscrites: Set<string>): (repo: string, args: string[]) => Sortie {
  const commun = join(base, '.git')
  return (repo, args) => {
    if (args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
      // Une copie sans `.git` fait remonter git jusqu'au dépôt de base : c'est ce que l'appartenance refuse.
      const racine = repo !== base && existsSync(join(repo, '.git')) ? repo : base
      return reussi(`${commun}\n${racine}\n`)
    }
    if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) return reussi(`${commun}\n`)
    if (args[0] === 'worktree' && args[1] === 'list') {
      return reussi([...inscrites].map((c) => `worktree ${c}\n`).join(''))
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      rmSync(join(args[args.length - 1] ?? '', '.git'), { force: true })
      return { code: 1, stdout: '', stderr: 'Impossible de retirer : fichier verrouillé (simulé)' }
    }
    if (args[0] === 'worktree' && args[1] === 'prune') {
      for (const c of [...inscrites]) if (!existsSync(c)) inscrites.delete(c)
      return reussi('')
    }
    return reussi('')
  }
}

/** Un disque qui refuse le retrait tant que `verrouille.actif` : la panne, puis sa levée. */
function disque(verrouille: { actif: boolean }): {
  removeDirFn: (chemin: string) => void
  removeDirAsyncFn: (chemin: string) => Promise<void>
} {
  const refus = (): Error => new Error('EBUSY: verrou Windows simulé')
  return {
    removeDirFn: (chemin) => {
      if (verrouille.actif) throw refus()
      supprimerArbre(chemin)
    },
    removeDirAsyncFn: async (chemin) => {
      if (verrouille.actif) throw refus()
      await supprimerArbreAsync(chemin)
    }
  }
}

/** Le gestionnaire sur ce dépôt simulé. Les copies sont vues âgées de 30 jours, donc éligibles. */
function gestionnaire(
  base: string,
  racine: string,
  inscrites: Set<string>,
  verrou: { actif: boolean }
): WorktreeManager {
  const git = gitFaux(base, inscrites)
  return new WorktreeManager({
    baseRepo: base,
    worktreeRoot: racine,
    git: (repo, args) => git(repo, args).stdout,
    tryGitFn: git,
    tryGitAsyncFn: async (repo, args) => git(repo, args),
    ...disque(verrou),
    nowFn: () => Date.now() + 30 * UN_JOUR_MS,
    processIdentityFn: () => undefined,
    disableAsyncOperations: true
  })
}

/** La panne : le retrait s'arrête après avoir retiré le lien git. Vérifie que l'état est bien celui-là. */
async function provoquerLaPanne(wm: WorktreeManager, chemin: string): Promise<void> {
  expect(await prive(wm).balayerLeCheminAsync(chemin)).toBe(false)
  expect(existsSync(join(chemin, '.git'))).toBe(false)
  expect(existsSync(chemin)).toBe(true)
}

describe('suppression coupée : le passage suivant la reprend', () => {
  it('une copie dont le lien git est retiré avant la panne est supprimée au passage suivant', async () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-coupee')
    const inscrites = new Set<string>([chemin])
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, inscrites, verrou)
    await provoquerLaPanne(wm, chemin)

    verrou.actif = false
    const reprises = await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(chemin)).toBe(false)
    expect(reprises).toContain('run-coupee')
  })

  it('même reprise par la forme synchrone du balayage de démarrage', () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-coupee-sync')
    const inscrites = new Set<string>([chemin])
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, inscrites, verrou)
    expect(prive(wm).balayerLeChemin(chemin)).toBe(false)
    expect(existsSync(join(chemin, '.git'))).toBe(false)

    verrou.actif = false
    const reprises = wm.sweepAbandonedAgentCopies()

    expect(existsSync(chemin)).toBe(false)
    expect(reprises).toContain('run-coupee-sync')
  })

  it('jumeau accepté : la même copie, dont le bail tombe, est reprise au passage suivant', async () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-bail-leve')
    const inscrites = new Set<string>([chemin])
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, inscrites, verrou)
    await provoquerLaPanne(wm, chemin)
    wm.markProcess('run-bail-leve', process.pid, true)
    wm.markProcess('run-bail-leve', process.pid, false)

    verrou.actif = false
    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(chemin)).toBe(false)
  })
})

describe('suppression coupée : les garde-fous tiennent', () => {
  it('garde : une copie coupée encore tenue par un bail reste en place', async () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-bail-tenu')
    const inscrites = new Set<string>([chemin])
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, inscrites, verrou)
    await provoquerLaPanne(wm, chemin)
    wm.markProcess('run-bail-tenu', process.pid, true)

    verrou.actif = false
    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(chemin)).toBe(true)
  })

  it('garde : une note de retrait sur une copie qui garde son lien git ne la fait pas reprendre', async () => {
    // Un retrait noté puis refusé par git avant d'avoir touché au dossier : la copie est intacte, son lien
    // est là. La reprise ne la retire pas ; le balayage normal la jugera avec ses gardes.
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-note-seule')
    const inscrites = new Set<string>([chemin])
    const wm = gestionnaire(base, racine, inscrites, { actif: false })
    expect(wm.noterSuppressionCommencee(chemin)).toBe(true)

    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(join(chemin, 'src', 'travail.txt'))).toBe(true)
  })

  it('garde : un dossier sans .git et sans trace de suppression commencée n’est jamais retiré', async () => {
    // Le cas des copies du 08/11 dont la publication est restée bloquée : rien ne prouve qu'un retrait a commencé.
    const { base, racine } = depot()
    const chemin = join(racine, 'agent__run-sans-trace')
    mkdirSync(join(chemin, 'src'), { recursive: true })
    writeFileSync(join(chemin, 'src', 'travail.txt'), 'travail non publié possible')
    const wm = gestionnaire(base, racine, new Set<string>(), { actif: false })

    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(join(chemin, 'src', 'travail.txt'))).toBe(true)
  })

  it('garde : un dossier remplacé par une copie neuve après la panne n’est pas retiré', async () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-remplace')
    const inscrites = new Set<string>([chemin])
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, inscrites, verrou)
    await provoquerLaPanne(wm, chemin)

    // Un nouveau run recrée la même copie, et son dossier existe avant son lien git : c'est un travail
    // vivant, pas le dossier coupé. Sans lien, seule l'identité de création le distingue.
    rmSync(chemin, { recursive: true, force: true })
    await new Promise((resolve) => setTimeout(resolve, 30))
    mkdirSync(join(chemin, 'src'), { recursive: true })
    writeFileSync(join(chemin, 'src', 'travail.txt'), 'travail en cours de création')
    inscrites.add(chemin)
    verrou.actif = false
    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(join(chemin, 'src', 'travail.txt'))).toBe(true)
  })
})
