import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre, supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { encoderCheminCli, racinesHistoriqueCliPour } from './historique-cli-copie'
import { DOSSIER_DES_FICHES_DE_SUPPRESSION } from './worktree-manager-copies'
import { WorktreeManager } from './worktree-manager'
import { racineDe, roots, tempRepo } from './worktree-manager.test-helpers'

/* Le faux home des tests d'historique : `os.homedir` rend `faux.home` quand il est posé. */
const faux = vi.hoisted(() => ({ home: undefined as string | undefined }))
vi.mock('node:os', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:os')>()
  return { ...reel, homedir: () => faux.home ?? reel.homedir() }
})

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
function gitFaux(
  base: string,
  inscrites: Set<string>,
  retrait: 'echec' | 'reussiteQuiLaisseLeDossier' = 'echec'
): (repo: string, args: string[]) => Sortie {
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
      const chemin = args[args.length - 1] ?? ''
      rmSync(join(chemin, '.git'), { force: true })
      if (retrait === 'reussiteQuiLaisseLeDossier') {
        // git lit sa propre réussite : l'enregistrement part, les fichiers restent sur le disque.
        inscrites.delete(chemin)
        return reussi('')
      }
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
  verrou: { actif: boolean },
  retrait: 'echec' | 'reussiteQuiLaisseLeDossier' = 'echec'
): WorktreeManager {
  const git = gitFaux(base, inscrites, retrait)
  return new WorktreeManager({
    racineCopiesDeTaches: racineDe(racine),
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

/*
 * GIT RENVOIE 0, LE DOSSIER SURVIT. `git worktree remove` rend 0 dès que l'enregistrement est parti,
 * même si des fichiers restent sur le disque. Ce cas ne doit JAMAIS être conclu `ok` : la copie est
 * encore là, son historique CLI aussi, et la fiche de suppression doit faire reprendre le dossier.
 */

// fix-ok: cause mesurée — le faux home n'était pas vérifié : sans le mock de `node:os`, les 2 tests d'historique rendent « expected 'C:\Users\<le vrai home>' » (mutation mesurée) ; le retrait d'une coquille verrouillée est gardé : sans la garde de worktree-manager-cycle.ts:190, 3 tests rouges (mutation mesurée).
/**
 * Un faux `~/.claude` : le CLI range l'historique d'une copie sous `projects/<chemin encodé>`.
 * Le faux home passe par le mock de `node:os` ci-dessus, pas par les variables d'environnement : sur ce
 * poste (win32, vitest 3.2.7, pool `threads`), modifier `USERPROFILE` ou `HOME` dans un test ne change
 * pas `os.homedir()` (sonde mesurée le 08/11, fichier jetable supprimé).
 * La garde ci-dessous vérifie que le faux home est bien LU, par le test et par le module testé ; sans
 * cela, le test lirait le VRAI `~/.claude` et passerait pour une mauvaise raison.
 */
function avecFauxHome<T>(corps: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'autowin-home-'))
  roots.push(home)
  faux.home = home
  try {
    expect(homedir()).toBe(home)
    expect(racinesHistoriqueCliPour(join(home, 'copie'))[0]).toBe(join(home, '.claude', 'projects'))
    return corps(home)
  } finally {
    faux.home = undefined
  }
}

/** Pose un historique CLI pour `chemin` sous le faux home, et rend le dossier posé. */
function poserHistorique(home: string, chemin: string): string {
  const dossier = join(home, '.claude', 'projects', encoderCheminCli(chemin))
  mkdirSync(dossier, { recursive: true })
  writeFileSync(join(dossier, 'session.jsonl'), '{}')
  return dossier
}

// fix-ok: cause mesurée — rouge avant correctif (3 échecs sur 4, le jumeau passe) : `conclureRetraitDeCopie` rendait ok sur le seul code 0 de git (src/main/store/worktree-manager-cycle.ts:153), range l'historique CLI d'une copie qui survit (cycle.ts:180), et `finirBalayageParLeDisque` (src/main/store/worktree-manager-copies.ts) ne range jamais l'historique après un retrait par le disque.
describe('retrait conclu seulement quand le dossier est parti', () => {
  it('git rend 0 mais le dossier garde des fichiers : pas de retrait conclu, la fiche reste, le passage suivant reprend', () => {
    const { base, racine } = depot()
    const chemin = copie(racine, 'run-git-zero')
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, new Set([chemin]), verrou, 'reussiteQuiLaisseLeDossier')

    const bilan = wm.cleanupWorktree(chemin, true)

    expect(bilan.ok).toBe(false)
    expect(existsSync(join(chemin, 'src', 'travail.txt'))).toBe(true)
    expect(existsSync(join(racine, DOSSIER_DES_FICHES_DE_SUPPRESSION, 'run-git-zero.json'))).toBe(
      true
    )

    verrou.actif = false
    const reprises = wm.sweepAbandonedAgentCopies()

    expect(existsSync(chemin)).toBe(false)
    expect(reprises).toContain('run-git-zero')
  })

  it('jumeau accepté : git rend 0 et le dossier ne garde qu’une coquille vide, il est retiré et conclu ok', () => {
    const { base, racine } = depot()
    const chemin = join(racine, 'agent__run-coquille')
    mkdirSync(chemin, { recursive: true })
    writeFileSync(join(chemin, '.git'), 'gitdir: simulé')
    const wm = gestionnaire(
      base,
      racine,
      new Set([chemin]),
      { actif: false },
      'reussiteQuiLaisseLeDossier'
    )

    expect(wm.cleanupWorktree(chemin, true).ok).toBe(true)
    expect(existsSync(chemin)).toBe(false)
  })

  it('coquille vide que le disque refuse de retirer : pas de retrait conclu, la fiche reste, le passage suivant la retire', () => {
    const { base, racine } = depot()
    const chemin = join(racine, 'agent__run-coquille-verrouillee')
    mkdirSync(chemin, { recursive: true })
    writeFileSync(join(chemin, '.git'), 'gitdir: simulé')
    const verrou = { actif: true }
    const wm = gestionnaire(base, racine, new Set([chemin]), verrou, 'reussiteQuiLaisseLeDossier')

    const bilan = wm.cleanupWorktree(chemin, true)

    expect(bilan.ok).toBe(false)
    expect(existsSync(chemin)).toBe(true)
    expect(
      existsSync(join(racine, DOSSIER_DES_FICHES_DE_SUPPRESSION, 'run-coquille-verrouillee.json'))
    ).toBe(true)

    verrou.actif = false
    const reprises = wm.sweepAbandonedAgentCopies()

    expect(existsSync(chemin)).toBe(false)
    expect(reprises).toContain('run-coquille-verrouillee')
  })

  it('git rend 0, le dossier survit : l’historique CLI de la copie n’est pas rangé avec elle', () => {
    avecFauxHome((home) => {
      const { base, racine } = depot()
      const chemin = copie(racine, 'run-garde-historique')
      const wm = gestionnaire(
        base,
        racine,
        new Set([chemin]),
        { actif: true },
        'reussiteQuiLaisseLeDossier'
      )
      const historique = poserHistorique(home, chemin)

      wm.cleanupWorktree(chemin, true)

      expect(existsSync(chemin)).toBe(true)
      expect(existsSync(historique)).toBe(true)
    })
  })

  it('copie que git ne connaît plus, retirée par le disque : son historique CLI part avec elle', () => {
    avecFauxHome((home) => {
      const { base, racine } = depot()
      const chemin = copie(racine, 'run-hors-git')
      const wm = gestionnaire(base, racine, new Set<string>(), { actif: false })
      const historique = poserHistorique(home, chemin)

      expect(prive(wm).balayerLeChemin(chemin)).toBe(true)

      expect(existsSync(chemin)).toBe(false)
      expect(existsSync(historique)).toBe(false)
    })
  })
})

/*
 * La préservation committe le travail d'une copie avant de la libérer. Ce commit passe par le crochet du
 * dépôt, comme tout commit : un nom d'entreprise y est refusé, la copie reste en place, et rien n'entre
 * dans la branche de récupération. Le dépôt est réel (git et son crochet) ; le profil est fictif et non
 * commité, comme sur le poste, où `entreprise/` est ignoré par git.
 */
const CROCHET_DU_DEPOT = join(__dirname, '../../../.githooks')
const PROFIL_FICTIF = JSON.stringify({
  nom: 'Acme',
  termesInterdits: [{ motif: 'zorglub', ignorerCasse: true }]
})

const gitVrai = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function depotAvecCrochet(): { base: string; worktreeRoot: string } {
  const base = tempRepo()
  gitVrai(base, 'config', 'core.hooksPath', CROCHET_DU_DEPOT)
  mkdirSync(join(base, 'entreprise', 'acme'), { recursive: true })
  writeFileSync(join(base, 'entreprise', 'acme', 'identite.json'), PROFIL_FICTIF)
  const racine = mkdtempSync(join(tmpdir(), 'autowin-preservation-crochet-'))
  roots.push(racine)
  const worktreeRoot = join(racine, 'copies')
  mkdirSync(worktreeRoot, { recursive: true })
  return { base, worktreeRoot }
}

/** Une copie d'agent avec un travail non committé, créée comme le fait git. */
function copieAvecTravail(base: string, worktreeRoot: string, id: string, contenu: string): string {
  const copie = join(worktreeRoot, `agent__${id}`)
  gitVrai(base, 'worktree', 'add', '-q', '--detach', copie, 'HEAD')
  mkdirSync(join(copie, 'src'), { recursive: true })
  writeFileSync(join(copie, 'src', 'travail.ts'), contenu)
  return copie
}

describe('préservation d’une copie : le crochet du dépôt contrôle son commit', () => {
  it('REFUSE de préserver un travail qui porte le nom d’un profil : rien n’est committé, la copie reste', () => {
    const { base, worktreeRoot } = depotAvecCrochet()
    const copie = copieAvecTravail(base, worktreeRoot, 'run-nom-1', '// ACME\nexport const n = 1\n')

    const issue = new WorktreeManager({
      racineCopiesDeTaches: racineDe(worktreeRoot),
      baseRepo: base,
      worktreeRoot
    } as never).preserverEtLiberer('run-nom-1')

    expect(issue).toEqual({ outcome: 'refuse', detail: 'le travail n’a pas pu être préservé' })
    expect(existsSync(join(copie, 'src', 'travail.ts'))).toBe(true)
    // La branche de récupération est restée sur HEAD : aucun commit n'a été créé.
    expect(gitVrai(base, 'rev-parse', 'autowin/recovery/run-nom-1')).toBe(
      gitVrai(base, 'rev-parse', 'HEAD')
    )
  })

  it('REFUSE de même par la forme asynchrone du balayage horaire', async () => {
    const { base, worktreeRoot } = depotAvecCrochet()
    const copie = copieAvecTravail(base, worktreeRoot, 'run-nom-2', '// ACME\nexport const n = 1\n')

    const issue = await new WorktreeManager({
      racineCopiesDeTaches: racineDe(worktreeRoot),
      baseRepo: base,
      worktreeRoot
    } as never).preserverEtLibererAsync('run-nom-2')

    expect(issue.outcome).toBe('refuse')
    expect(existsSync(join(copie, 'src', 'travail.ts'))).toBe(true)
    expect(gitVrai(base, 'rev-parse', 'autowin/recovery/run-nom-2')).toBe(
      gitVrai(base, 'rev-parse', 'HEAD')
    )
  })

  it('le balayage horaire garde une copie refusée et en note la cause au registre des blocages', async () => {
    const { base, worktreeRoot } = depotAvecCrochet()
    const copie = copieAvecTravail(base, worktreeRoot, 'run-nom-3', '// ACME\nexport const n = 1\n')
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(worktreeRoot),
      baseRepo: base,
      worktreeRoot,
      nowFn: () => Date.now() + 30 * UN_JOUR_MS
    } as never)

    await wm.sweepAbandonedAgentCopiesAsync()

    expect(existsSync(join(copie, 'src', 'travail.ts'))).toBe(true)
    expect(wm.blocagesDeBalayage()).toEqual([
      { path: resolve(copie), echecs: 1, detail: 'le travail n’a pas pu être préservé' }
    ])
  })

  it('jumeau accepté : le même travail sans nom passe le crochet, est committé, et la copie est libérée', () => {
    const { base, worktreeRoot } = depotAvecCrochet()
    const copie = copieAvecTravail(base, worktreeRoot, 'run-propre-1', 'export const n = 1\n')

    const issue = new WorktreeManager({
      racineCopiesDeTaches: racineDe(worktreeRoot),
      baseRepo: base,
      worktreeRoot
    } as never).preserverEtLiberer('run-propre-1')

    expect(issue.outcome).toBe('preserve-et-libere')
    expect(existsSync(copie)).toBe(false)
    expect(gitVrai(base, 'show', 'autowin/recovery/run-propre-1:src/travail.ts')).toBe(
      'export const n = 1'
    )
  })
})
