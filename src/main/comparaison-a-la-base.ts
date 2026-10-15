import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { supprimerArbre } from './fs-supprimer'
import { delierLesDependances, lierLesDependances } from './store/dependances-copie-agent'
import { echecsDuRapport, verdictDifferentiel } from './verify-command'

/**
 * UN ROUGE DÉJÀ PRÉSENT NE BLOQUE PLUS LA PUBLICATION D'UN TOUR (conv-246, 2026-10-11).
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

async function git(repo: string, args: readonly string[]): Promise<string> {
  const { stdout } = await executer('git', [...args], { cwd: repo, windowsHide: true })
  return String(stdout).trim()
}

/**
 * Copie propre du DERNIER COMMIT de `repo`, hors du dépôt et hors de `%TEMP%/autowin*` (le ménage
 * de fin de suite des tests vide ces dossiers-là, y compris ceux des AUTRES suites).
 *
 * La suppression passe par `supprimerArbre`, qui ne suit JAMAIS une jonction : jamais par
 * `git worktree remove`, qui efface le `node_modules` du dépôt à travers la jonction encore posée
 * (vécu, voir la note « publier un commit isolé »). `git worktree prune` retire ensuite l'inscription.
 */
export async function ouvrirCopieDeBase(repo: string): Promise<CopieDeBase> {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'aw-base-')))
  const chemin = join(parent, 'copie')
  const fermer = async (): Promise<void> => {
    const retrait = delierLesDependances(chemin)
    if (retrait.fait === 'echec') {
      console.warn(`[comparaison a la base] jonction des modules non retiree (${retrait.raison})`)
    }
    try {
      supprimerArbre(parent)
    } catch (erreur) {
      console.warn(`[comparaison a la base] copie ${parent} non supprimee :`, erreur)
    }
    await git(repo, ['worktree', 'prune']).catch((erreur: unknown) =>
      console.warn('[comparaison a la base] git worktree prune :', erreur)
    )
  }
  try {
    await git(repo, ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', chemin, 'HEAD'])
    const liaison = lierLesDependances(repo, chemin)
    if (liaison.fait === 'echec') throw new Error(`modules non reliés : ${liaison.raison}`)
  } catch (erreur) {
    await fermer()
    throw erreur
  }
  return { chemin, fermer }
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
