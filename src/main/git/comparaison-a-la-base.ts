import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { delierLesDependances, lierLesDependances } from '../store/dependances-copie-agent'
import { echecsDuRapport, verdictDifferentiel } from '../commands/verify-command'

/**
 * UN ROUGE DÉJÀ PRÉSENT NE BLOQUE PLUS LA PUBLICATION D'UN TOUR (2026-10-11).
 *
 * LE DÉFAUT, mesuré ce jour-là : l'interrupteur « Enchaînement auto » était sur ON, mais plus aucun
 * tour de chat ne publiait depuis 08:40 — 84 fichiers en attente. Le contrôle d'avant publication
 * rejoue les tests dans l'arbre PARTAGÉ et impute au tour TOUT rouge de sa portée. Les 7 suites qui
 * bloquaient : 3 déjà rouges sur main, 2 cassées par le travail non publié d'autres fils, 2 cassées
 * par un descripteur de trace jamais refermé. Aucune n'était due au tour refusé — et tant qu'un seul
 * de ces rouges durait, plus rien ne partait.
 *
 * LA CORRECTION : juger le tour sur ce qui PART. Dans une copie propre du dernier commit (avec les
 * modules du dépôt reliés par jonction), on rejoue les suites restées rouges deux fois : sur le
 * commit seul (AVANT), puis avec les fichiers du tour posés dessus (APRÈS). Le différentiel est celui
 * d'`edit_file` (`verdictDifferentiel`) : seul un échec qui n'existait pas AVANT est imputé au tour.
 * Une suite rouge dans l'arbre partagé mais verte dans la copie vient d'un travail qui ne part pas.
 *
 * Ce que cela NE prouve PAS, et le rapport le dit : la base n'est pas verte ; un rouge déjà présent
 * peut masquer une régression au même endroit (même test, même raison) ; et une suite rouge
 * seulement dans l'arbre partagé n'est rejouée qu'à l'identique du commit.
 */

const executer = promisify(execFile)

export interface MesureDeBase {
  /** Faux = la mesure n'a pas pu être lancée (`raison` dit pourquoi). */
  lancee: boolean
  ok: boolean
  /** `null` = coupée au plafond de temps : aucun rapport complet. */
  exitCode: number | null
  rapport?: string
  raison?: string
}

/** Rejoue `suites` (chemins relatifs) dans `racine` ; voir `AppCommandBus.mesurerParLots`. */
export type Mesureur = (racine: string, suites: readonly string[]) => Promise<MesureDeBase>

export interface CopieDeBase {
  chemin: string
  fermer: () => Promise<void>
}

export type ComparaisonALaBase =
  | {
      issue: 'aucun-rouge-du-tour'
      /** Suites déjà rouges au dernier commit, et toujours rouges avec le tour. */
      dejaRouges: string[]
      /** Suites rouges dans l'arbre partagé, mais pas dans ce qui part (travail d'autres fils). */
      rougesDAilleurs: string[]
    }
  | { issue: 'rouges-du-tour'; suites: string[]; detail: string }
  | { issue: 'indeterminee'; raison: string }

const versSlash = (chemin: string): string => chemin.split(sep).join('/')

/** Le préfixe des copies de base dans `%TEMP%` : le balayage ne regarde que lui. */
export const PREFIXE_COPIE_DE_BASE = 'aw-base-'

async function git(repo: string, args: readonly string[]): Promise<string> {
  const { stdout } = await executer('git', [...args], { cwd: repo, windowsHide: true })
  return String(stdout).trim()
}

/**
 * Copie propre du DERNIER COMMIT de `repo`, hors du dépôt et hors de `%TEMP%/autowin*` (le ménage
 * de fin de suite des tests vide ces dossiers-là, y compris ceux des AUTRES suites).
 *
 * La suppression passe par `supprimerArbreAsync`, qui ne suit JAMAIS une jonction : jamais par
 * `git worktree remove`, qui efface le `node_modules` du dépôt à travers la jonction encore posée
 * (vécu, voir la note « publier un commit isolé »). `git worktree prune` retire ensuite l'inscription.
 *
 * Elle est ASYNCHRONE depuis /gel (2026-10-23) : la forme synchrone effaçait les ~3 970
 * fichiers de la copie sur le fil de la fenêtre, à chaque publication de tour — 320 s de fenêtre
 * figée du 21 au 23/10 dans `gels.jsonl`, pire 153,8 s (`comparaison-a-la-base.sans-gel.test.ts`).
 */
export async function ouvrirCopieDeBase(
  repo: string,
  racine: string = tmpdir(),
  /** Le commit de la copie ; un autre que HEAD sert à juger des commits déjà faits. */
  commit = 'HEAD'
): Promise<CopieDeBase> {
  const parent = realpathSync.native(mkdtempSync(join(racine, PREFIXE_COPIE_DE_BASE)))
  const chemin = join(parent, 'copie')
  const fermer = async (): Promise<void> => {
    const retrait = delierLesDependances(chemin)
    if (retrait.fait === 'echec') {
      console.warn(`[comparaison a la base] jonction des modules non retiree (${retrait.raison})`)
    }
    try {
      await supprimerArbreAsync(parent)
    } catch (erreur) {
      console.warn(`[comparaison a la base] copie ${parent} non supprimee :`, erreur)
    }
    await git(repo, ['worktree', 'prune']).catch((erreur: unknown) =>
      console.warn('[comparaison a la base] git worktree prune :', erreur)
    )
  }
  try {
    await git(repo, ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', chemin, commit])
    const liaison = lierLesDependances(repo, chemin)
    if (liaison.fait === 'echec') throw new Error(`modules non reliés : ${liaison.raison}`)
  } catch (erreur) {
    await fermer()
    throw erreur
  }
  return { chemin, fermer }
}

/** Au-delà, la ligne de commande de `git checkout` approcherait la limite de Windows. */
const CHEMINS_PAR_CHECKOUT = 100

/**
 * COPIE POUR JUGER DES COMMITS DÉJÀ FAITS : son dernier commit est `base` (ce que le distant a), et
 * les fichiers de la plage y sont posés dans leur version de `tete`, comme les fichiers d'un tour.
 * Une copie de HEAD comparerait ces commits à eux-mêmes : tout rouge qu'ils causent passerait pour
 * « déjà présent ». Les fichiers sont lus dans les commits, jamais dans l'arbre partagé, où d'autres
 * fils écrivent encore. Un fichier supprimé par la plage est retiré de la copie.
 */
export async function ouvrirCopieDesCommitsLocaux(
  repo: string,
  plage: { base: string; tete: string; fichiers: readonly string[] },
  racine: string = tmpdir()
): Promise<CopieDeBase> {
  const copie = await ouvrirCopieDeBase(repo, racine, plage.base)
  try {
    const lots: string[][] = []
    for (let i = 0; i < plage.fichiers.length; i += CHEMINS_PAR_CHECKOUT)
      lots.push(plage.fichiers.slice(i, i + CHEMINS_PAR_CHECKOUT))
    const presents = new Set<string>()
    for (const lot of lots) {
      // `-z` : sans lui, git cite entre guillemets un chemin accentué, qui ne se retrouverait plus.
      const lus = await git(copie.chemin, [
        'ls-tree',
        '-r',
        '-z',
        '--name-only',
        plage.tete,
        '--',
        ...lot
      ])
      for (const chemin of lus.split('\0').filter(Boolean)) presents.add(chemin)
    }
    // Les disparus d'abord : un fichier `a` devenu le dossier de `a/b.ts` empêcherait sinon de le poser.
    for (const chemin of plage.fichiers) {
      const cible = join(copie.chemin, chemin)
      if (!presents.has(chemin) && existsSync(cible)) unlinkSync(cible)
    }
    for (const lot of lots) {
      const aPoser = lot.filter((chemin) => presents.has(chemin))
      if (aPoser.length) await git(copie.chemin, ['checkout', plage.tete, '--', ...aPoser])
    }
  } catch (erreur) {
    await copie.fermer()
    throw erreur
  }
  return copie
}

/**
 * 6 h. Une copie de base vit le temps d'un contrôle de publication : un typage plafonné à 5 min
 * (`typage-avant-publication.ts`), des lancements de tests plafonnés à 10 min (`VERIFY_TIMEOUT_MS`).
 * Relevé du 05/11 à 08:00 : `aw-base-XT5ZBB` ouverte à 08:00:58, déjà refermée à 08:01:25. Au-delà
 * de 6 h, plus aucune publication ne s'en sert — y compris celle d'une seconde instance de l'app.
 */
export const AGE_COPIE_DE_BASE_ORPHELINE_MS = 6 * 3_600_000

export interface BalayageDesCopiesDeBase {
  /** Les dossiers `aw-base-*` retirés (chemins complets). */
  supprimees: string[]
  /** Ceux qui sont restés, avec la cause lue : un ménage muet se lirait « tout est fait ». */
  echecs: Array<{ chemin: string; raison: string }>
}

/** Le dépôt commun d'une copie, lu dans son `.git` (`gitdir: <commun>/worktrees/<nom>`). */
async function depotCommunDe(copie: string): Promise<string | undefined> {
  const contenu = await readFile(join(copie, '.git'), 'utf8').catch(() => '')
  const gitdir = /^gitdir:\s*(.+?)\s*$/mu.exec(contenu)?.[1]
  if (!gitdir || basename(dirname(gitdir)) !== 'worktrees') return undefined
  return dirname(dirname(gitdir))
}

/**
 * COPIES DE BASE LAISSÉES PAR UN PROCESSUS MORT (2026-11-05).
 *
 * `fermer()` ne tourne que si le processus vit jusqu'au bout de la comparaison. Relevé du 05/11 :
 * quatre `%TEMP%\aw-base-*` du 04/11 toujours sur le disque et inscrites dans `git worktree list`,
 * dont `aw-base-92mlRA\copie\node_modules`, jonction vers `D:\AutoWinOS\node_modules`. Rien d'autre
 * ne les retirait — et un `git worktree remove --force` lancé à la main sur l'une d'elles efface les
 * modules du dépôt à travers la jonction.
 *
 * Même ordre que `fermer()` : la jonction d'abord (`delierLesDependances`), puis le dossier par
 * `supprimerArbreAsync` (qui ne suit jamais un lien), puis `git worktree prune` dans le dépôt de la
 * copie pour retirer l'inscription. Seuls les `aw-base-*` plus vieux que `ageMiniMs` partent : une
 * publication EN COURS n'est jamais touchée. Ne lève jamais : c'est un ménage de démarrage.
 */
export async function balayerCopiesDeBaseOrphelines(
  options: { racine?: string; ageMiniMs?: number; maintenant?: number } = {}
): Promise<BalayageDesCopiesDeBase> {
  const racine = options.racine ?? tmpdir()
  const ageMiniMs = options.ageMiniMs ?? AGE_COPIE_DE_BASE_ORPHELINE_MS
  const maintenant = options.maintenant ?? Date.now()
  const bilan: BalayageDesCopiesDeBase = { supprimees: [], echecs: [] }
  const entrees = await readdir(racine, { withFileTypes: true }).catch(() => [])
  const depots = new Set<string>()
  for (const entree of entrees) {
    if (!entree.isDirectory() || !entree.name.startsWith(PREFIXE_COPIE_DE_BASE)) continue
    const parent = join(racine, entree.name)
    const copie = join(parent, 'copie')
    try {
      // Le dossier parent n'est modifié qu'à la création de `copie` : sa date est celle de la copie.
      if (maintenant - (await stat(parent)).mtimeMs < ageMiniMs) continue
      const depot = await depotCommunDe(copie)
      const retrait = delierLesDependances(copie)
      if (retrait.fait === 'echec') {
        bilan.echecs.push({ chemin: parent, raison: `jonction des modules : ${retrait.raison}` })
        continue
      }
      await supprimerArbreAsync(parent)
      bilan.supprimees.push(parent)
      if (depot) depots.add(depot)
    } catch (erreur) {
      bilan.echecs.push({
        chemin: parent,
        raison: erreur instanceof Error ? erreur.message : String(erreur)
      })
    }
  }
  for (const depot of depots) {
    if (!existsSync(depot)) continue
    await git(depot, ['--git-dir', depot, 'worktree', 'prune']).catch((erreur: unknown) =>
      console.warn(`[comparaison a la base] git worktree prune dans ${depot} :`, erreur)
    )
  }
  return bilan
}

/** Pose sur la copie l'état des fichiers du tour tel qu'il sera commité (absent = supprimé). */
export function appliquerLeTour(repo: string, copie: string, fichiers: readonly string[]): void {
  for (const fichier of fichiers) {
    const source = join(repo, fichier)
    const cible = join(copie, fichier)
    if (existsSync(source)) {
      mkdirSync(dirname(cible), { recursive: true })
      copyFileSync(source, cible)
    } else if (existsSync(cible)) {
      unlinkSync(cible)
    }
  }
}

/** Les suites (relatives à la copie) qui portent ces identités d'échec `<fichier> > <nom> :: …`. */
function suitesDe(identites: readonly string[], copie: string): string[] {
  const suites = identites.map((id) => {
    const fichier = id.split(' > ')[0]
    return versSlash(isAbsolute(fichier) ? relative(copie, fichier) : fichier)
  })
  return [...new Set(suites)]
}

export async function comparerALaBase(entree: {
  repo: string
  /** Ce que le tour publie : chemins relatifs au dépôt. */
  fichiers: readonly string[]
  /** Suites restées rouges, même rejouées seules, dans l'arbre partagé. */
  suites: readonly string[]
  mesurer: Mesureur
  ouvrirCopie?: (repo: string) => Promise<CopieDeBase>
}): Promise<ComparaisonALaBase> {
  let copie: CopieDeBase
  try {
    copie = await (entree.ouvrirCopie ?? ouvrirCopieDeBase)(entree.repo)
  } catch (erreur) {
    return {
      issue: 'indeterminee',
      raison: `copie propre du dernier commit impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    }
  }
  try {
    const duTour = new Set(entree.fichiers.map(versSlash))
    const existeALaBase = (suite: string): boolean => existsSync(join(copie.chemin, suite))
    const existeApres = (suite: string): boolean =>
      duTour.has(suite) ? existsSync(join(entree.repo, suite)) : existeALaBase(suite)
    // Mêmes suites des deux côtés : `verdictDifferentiel` refuse deux périmètres différents.
    const communes = entree.suites.filter((s) => existeALaBase(s) && existeApres(s))
    // Ajoutées par le tour : aucun état d'avant, tout rouge y est le sien.
    const ajoutees = entree.suites.filter((s) => !existeALaBase(s) && existeApres(s))
    // Absentes de ce qui part (fichier de test d'un autre fil, ou retiré par le tour).
    const rougesDAilleurs = entree.suites.filter((s) => !existeApres(s))

    const avant = communes.length ? await entree.mesurer(copie.chemin, communes) : undefined
    appliquerLeTour(entree.repo, copie.chemin, entree.fichiers)

    const indeterminee = (mesure: MesureDeBase): ComparaisonALaBase => ({
      issue: 'indeterminee',
      raison:
        mesure.exitCode === null && mesure.lancee
          ? 'tests coupés au plafond de temps dans la copie du dernier commit'
          : (mesure.raison ?? 'mesure impossible dans la copie du dernier commit')
    })

    const rougesDuTour: string[] = []
    if (ajoutees.length) {
      const mesure = await entree.mesurer(copie.chemin, ajoutees)
      if (!mesure.lancee || mesure.exitCode === null) return indeterminee(mesure)
      if (!mesure.ok) rougesDuTour.push(...ajoutees)
    }
    const dejaRouges: string[] = []
    if (communes.length && avant) {
      if (!avant.lancee || avant.exitCode === null) return indeterminee(avant)
      const apres = await entree.mesurer(copie.chemin, communes)
      if (!apres.lancee || apres.exitCode === null) return indeterminee(apres)
      const verdict = verdictDifferentiel(
        apres.ok,
        echecsDuRapport(apres.rapport),
        echecsDuRapport(avant.rapport)
      )
      if (!verdict.concluant || (!verdict.publiable && verdict.nouvelles.length === 0)) {
        return { issue: 'indeterminee', raison: verdict.raison ?? 'différentiel non concluant' }
      }
      rougesDuTour.push(...suitesDe(verdict.nouvelles, copie.chemin))
      dejaRouges.push(
        ...suitesDe(verdict.preexistants, copie.chemin).filter((s) => !rougesDuTour.includes(s))
      )
      // Rouges dans l'arbre partagé, sans aucun échec dans ce qui part : le rouge vient d'ailleurs.
      for (const suite of communes) {
        if (!rougesDuTour.includes(suite) && !dejaRouges.includes(suite)) rougesDAilleurs.push(suite)
      }
    }
    if (rougesDuTour.length) {
      return {
        issue: 'rouges-du-tour',
        suites: rougesDuTour,
        detail:
          `${rougesDuTour.length} suite(s) rendue(s) rouge(s) par le tour ` +
          `(rejouées sur le dernier commit, puis avec les fichiers du tour)`
      }
    }
    return { issue: 'aucun-rouge-du-tour', dejaRouges, rougesDAilleurs }
  } finally {
    await copie.fermer()
  }
}
