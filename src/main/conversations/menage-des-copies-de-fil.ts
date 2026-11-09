import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { ancienNomDeCopieDeFil, nomDeCopieDeFil } from '../../shared/copie-du-fil'
import { supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { lireLaBaseDuFil } from '../git/photo-du-code'
import { arbreDeLaCopie } from '../orchestration/garder-un-essai'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import { delierLesDependances } from '../store/dependances-copie-agent'
import {
  racinesHistoriqueCliPour,
  rangerHistoriqueCliDUneCopie,
  ramenerLesSessionsDUneCopie
} from '../store/historique-cli-copie'
import { raisonDeLErreur as message } from '../../shared/raison-de-l-erreur'
import {
  copieDUnAutreDepot,
  entrerLeTravailDeLaCopie,
  PREFIXE_EN_CREATION,
  PREFIXE_ENTREE_EN_ATTENTE,
  reprendreLesSuppressionsCoupees,
  retirerLaCopieDeTache,
  uneEntreeEstEnAttente
} from '../copies/copie-de-tache'
import {
  dossierDeCopieDeTache,
  NOM_RACINE_COPIES_DE_TACHES,
  racineDesCopiesDeTaches
} from '../copies/chemins-de-copies'

/*
 * DEUX PASSES. Les copies d'avant (`copies-de-fil/<fil>`, `retours-de-tour/essai__…`) sont celles de
 * `menageDesCopiesDeFil` ci-dessous, jusqu'à leur retrait. Les nouvelles vivent sous la racine unique
 * (`copies-de-taches/<fil>`) : `menageDesCopiesDeTaches`, qui passe par la primitive (`copie-de-tache.ts`).
 * Même décision pour les deux : fil fini, calme, aucun tour.
 *
 * LE MÉNAGE DES COPIES DE FIL. Chaque fil du dépôt d'Autowin reçoit sa copie
 * (`copies-de-fil/<fil>` ; avant elle, `retours-de-tour/essai__<fil>-<instant>-1`, voir
 * `bascule-dossier-conversation.ts`) et rien ne la retirait : 11 copies complètes du dépôt sur le disque le 07/11, une par fil ouvert depuis la veille.
 * L'utilisateur a demandé qu'elles soient supprimées quand leur fil est fini.
 *
 * UNE COPIE PART SEULEMENT SI RIEN N'Y SERAIT PERDU : son arbre (fichiers non suivis compris, ignorés
 * exclus) est celui de la base du fil, c'est-à-dire exactement ce que la porte de fin de tour a déjà
 * publié. Une copie qui porte un écart reste, quelle que soit l'ancienneté du fil : c'est là que peut
 * dormir un travail non publié.
 *
 * « FINI » = aucun tour en cours, et le fil est resté calme `CALME_AVANT_MENAGE_MS` (1 h, voir plus
 * bas). Après le retrait, la session du fil est posée sous son dossier d'avant, là où le CLI la cherchera,
 * puis l'historique CLI de la copie (`~/.claude`) part dans une corbeille datée (`historique-cli-copie.ts`).
 * Une session qui ne peut pas être posée garde l'historique en place.
 *
 * LE FIL EST DÉCROCHÉ AVANT LA SUPPRESSION : son dossier rangé redevient celui d'avant la copie.
 * Sans quoi son tour suivant serait refusé (« dossier rangé disparu »). La copie est d'abord RENOMMÉE
 * (`a-supprimer__…`) dans le même geste synchrone que la dernière vérification : un tour qui démarre
 * ensuite ne la voit plus et en ouvre une neuve ; un renommage refusé par Windows (un fichier ouvert
 * dedans) laisse la copie en place. La suppression suit l'ordre de `balayerCopiesDeBaseOrphelines` :
 * la jonction `node_modules` d'abord (elle mène aux modules du dépôt), puis l'arbre par
 * `supprimerArbreAsync` qui ne suit jamais un lien, puis `git worktree prune` dans le dépôt.
 */

/*
 * LE DÉLAI DE CALME : 1 h, choix de l'utilisateur (08/11/2026) entre 8 s, 1 h et 12 h. Rouvrir une copie
 * coûte 8 s à chaud et 18 s à froid sur ce dépôt (4 781 fichiers suivis, mesuré le même jour : photo du
 * code 3,0 à 10,4 s, `worktree add` 4,9 à 7,3 s, jonction des modules 0,1 s), plus l'annonce de la copie
 * dans le fil. Avec 8 s, presque chaque demande après une pause payait ce coût ; 1 h couvre une pause
 * ordinaire. Une copie garde environ 98 Mo tant qu'elle est là.
 */
// fix-ok: décision de l'utilisateur (08/11) — 8 s faisait rouvrir la copie à presque chaque demande après une pause (8 à 18 s d'attente).
export const CALME_AVANT_MENAGE_MS = 60 * 60_000

/**
 * Une copie SANS fil peut être celle qu'un tour est en train d'ouvrir (8 à 18 s) : son âge seul la
 * retire, et seulement après 12 h.
 */
export const AGE_MIN_COPIE_SANS_FIL_MS = 12 * 3_600_000

/** Le préfixe d'une copie décrochée et en cours de suppression : un ménage coupé la reprend. */
export const PREFIXE_A_SUPPRIMER = 'a-supprimer__'

/** Ce que le ménage lit d'un fil. */
export interface FilDuMenage {
  id: string
  projectPath?: string
  copieDuFil?: { chemin?: unknown; dossierAvant?: unknown }
  inactive?: boolean
  updatedAt: number
}

/**
 * Le fil d'une copie de fil et, quand son nom le porte, l'instant de son ouverture : `copies-de-fil/<fil>`,
 * ou l'ancien nom `essai__<fil>-<instant>-<rang>`. `null` pour tout autre dossier.
 */
// la racine unique doit être reconnue ici, sinon le ménage ne voit aucune de ses copies.
function identiteDeLaCopie(copie: string): { fil: string; quand?: number } | null {
  const ancienne = ancienNomDeCopieDeFil(copie)
  if (ancienne) return { fil: ancienne.fil, quand: ancienne.quand }
  const nouvelle = nomDeCopieDeFil(copie)
  if (nouvelle) return nouvelle
  // La racine unique ne porte pas l'instant dans son nom : l'ouverture se lit sur le disque.
  const parent = dirname(copie)
  if (
    basename(parent) === NOM_RACINE_COPIES_DE_TACHES &&
    dossierDeCopieDeTache(parent, basename(copie)) !== null
  )
    return { fil: basename(copie) }
  return null
}

export type DecisionPourLaCopie =
  { supprimer: true; filDuNom: string; aDecrocher: string[] } | { supprimer: false; raison: string }

function cle(chemin: string | undefined): string {
  return chemin
    ? resolve(chemin)
        .replace(/[\\/]+$/u, '')
        .toLowerCase()
    : ''
}

/** Le fil se sert-il de cette copie (dossier courant, ou copie notée) ? */
function usageDeLaCopie(fil: FilDuMenage, copie: string): boolean {
  const ici = cle(copie)
  return (
    cle(fil.projectPath) === ici ||
    (typeof fil.copieDuFil?.chemin === 'string' && cle(fil.copieDuFil.chemin) === ici)
  )
}

/**
 * La décision sur une copie, sans git ni disque : qui s'en sert, et chacun a-t-il fini ? L'écart à la
 * base se mesure APRÈS, seulement pour les copies retenues ici.
 */
export function decisionPourLaCopie(entree: {
  copie: string
  fils: readonly FilDuMenage[]
  tourEnCours: (id: string) => boolean
  maintenant: number
  calmeMs?: number
  /** L'instant d'ouverture lu sur le disque, pour une copie dont le nom ne le porte pas. */
  ouverteA?: number
}): DecisionPourLaCopie {
  const nom = identiteDeLaCopie(entree.copie)
  if (!nom) return { supprimer: false, raison: 'ce n’est pas une copie de fil' }
  const ouverteA = nom.quand ?? entree.ouverteA
  const calmeMs = entree.calmeMs ?? CALME_AVANT_MENAGE_MS
  const ici = cle(entree.copie)
  const utilisateurs = entree.fils.filter((fil) => usageDeLaCopie(fil, entree.copie))
  // Sans fil (supprimé, ou archivé pas encore relu) : seule l'heure de la copie dit son âge. Une copie
  // toute neuve peut être celle qu'un tour est en train d'ouvrir, avant de la noter sur son fil : son
  // âge ne suffit qu'au-delà de `AGE_MIN_COPIE_SANS_FIL_MS`, jamais au délai de calme d'un fil.
  if (utilisateurs.length === 0)
    return ouverteA !== undefined && entree.maintenant - ouverteA >= AGE_MIN_COPIE_SANS_FIL_MS
      ? { supprimer: true, filDuNom: nom.fil, aDecrocher: [] }
      : { supprimer: false, raison: 'copie récente sans fil : peut-être en cours d’ouverture' }
  const aDecrocher: string[] = []
  for (const fil of utilisateurs) {
    if (entree.tourEnCours(fil.id))
      return { supprimer: false, raison: `${fil.id} a un tour en cours` }
    const calme = entree.maintenant - fil.updatedAt
    const fini = calme >= calmeMs
    if (!fini) return { supprimer: false, raison: `${fil.id} n’est pas fini` }
    if (cle(fil.projectPath) !== ici) continue
    // Un fil rangé dans ce dossier sans que ce soit SA copie (une façon d'« Essaie 3 façons ») ne
    // saurait pas où revenir : son tour suivant serait refusé. La copie reste.
    if (typeof fil.copieDuFil?.chemin !== 'string' || cle(fil.copieDuFil.chemin) !== ici)
      return { supprimer: false, raison: `${fil.id} y est rangé sans que ce soit sa copie` }
    aDecrocher.push(fil.id)
  }
  return { supprimer: true, filDuNom: nom.fil, aDecrocher }
}

export interface BilanDuMenage {
  /** Les copies retirées du disque (chemin d'origine). */
  supprimees: string[]
  /** Les copies gardées et pourquoi : un ménage muet se lirait « tout est fait ». */
  gardees: Array<{ chemin: string; raison: string }>
  /** Les copies que le ménage n'a pas pu finir de retirer ; la passe suivante les reprend. */
  echecs: Array<{ chemin: string; raison: string }>
}

/** Retire une copie déjà décrochée : la jonction des modules d'abord, puis l'arbre. */
async function retirerLaCopie(chemin: string): Promise<void> {
  const retrait = delierLesDependances(chemin)
  if (retrait.fait === 'echec') throw new Error(`jonction des modules : ${retrait.raison}`)
  await supprimerArbreAsync(chemin)
}

/**
 * Le dossier où le fil revient quand sa copie est retirée : celui d'avant, noté sur le fil, ou le dépôt quand la
 * note ne le donne pas (comme la reprise de session du tour, qui lit le même choix). `undefined` si aucun fil ne se
 * sert de cette copie : rien ne dit alors où reprendre la session.
 */
function dossierAvantDeLaCopie(
  fils: readonly FilDuMenage[],
  copie: string,
  depot: string
): string | undefined {
  const ici = cle(copie)
  const notee = fils.find(
    (fil) => typeof fil.copieDuFil?.chemin === 'string' && cle(fil.copieDuFil.chemin) === ici
  )?.copieDuFil
  if (!notee) return undefined
  return typeof notee.dossierAvant === 'string' && notee.dossierAvant ? notee.dossierAvant : depot
}

/**
 * L'historique CLI d'une copie qu'on vient de retirer : sa session est d'abord posée sous le dossier d'avant du fil
 * (là où le CLI la cherchera), puis le dossier de la copie part en corbeille datée. Sans dossier d'avant, ou si une
 * session ne peut pas être posée, rien ne part : l'historique reste en place, et la raison remonte au bilan.
 */
function rangerHistoriqueDeLaCopieRetiree(entree: {
  copie: string
  dossierAvant: string | undefined
  racines: readonly string[]
  jour: string
}): Array<{ chemin: string; raison: string }> {
  if (entree.dossierAvant === undefined) return []
  const ramenees = ramenerLesSessionsDUneCopie({
    copie: entree.copie,
    dossierAvant: entree.dossierAvant,
    racines: entree.racines
  })
  if (ramenees.echecs.length > 0)
    return ramenees.echecs.map((chemin) => ({
      chemin,
      raison: 'session non posée sous le dossier d’avant : son historique reste en place'
    }))
  rangerHistoriqueCliDUneCopie({ copie: entree.copie, racines: entree.racines, jour: entree.jour })
  return []
}

/** Le jour (AAAA-MM-JJ) qui nomme la corbeille de l'historique CLI rangé ce jour-là. */
const jourDe = (instant: number): string => new Date(instant).toISOString().slice(0, 10)

/** L'instant de création du dossier ; `undefined` si le disque ne le dit pas. */
function ouvertureSurLeDisque(chemin: string): number | undefined {
  try {
    const info = statSync(chemin)
    return info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs
  } catch {
    return undefined
  }
}

/**
 * Une passe de ménage sur `dossierDesCopiesDeFil` et sur `dossierDesRetours` (les copies d'avant). `lireFils` est relu juste avant chaque suppression :
 * entre la décision et le geste, la mesure de l'écart a pris du temps, et un fil a pu repartir.
 * Ne lève jamais : c'est un ménage de fond.
 */
export async function menageDesCopiesDeFil(entree: {
  dossierDesRetours: string
  dossierDesCopiesDeFil?: string
  depot: string
  lireFils: () => readonly FilDuMenage[]
  tourEnCours: (id: string) => boolean
  decrocher: (id: string) => void
  maintenant?: () => number
  calmeMs?: number
  runGit?: GitRunner
  retirer?: (chemin: string) => Promise<void>
  /** Les racines `projects` du CLI où l'historique d'une copie peut vivre (par défaut : les comptes d'Autowin). */
  racinesHistoriqueCli?: (copie: string) => readonly string[]
}): Promise<BilanDuMenage> {
  const bilan: BilanDuMenage = { supprimees: [], gardees: [], echecs: [] }
  const maintenant = entree.maintenant ?? Date.now
  const retirer = entree.retirer ?? retirerLaCopie
  let git: GitRunner | undefined = entree.runGit
  const entrees: Array<{ dossier: string; nom: string }> = []
  for (const dossier of [entree.dossierDesCopiesDeFil, entree.dossierDesRetours]) {
    if (!dossier || !existsSync(dossier)) continue
    try {
      for (const nom of readdirSync(dossier)) entrees.push({ dossier, nom })
    } catch (erreur) {
      bilan.echecs.push({ chemin: dossier, raison: message(erreur) })
    }
  }
  let aPrune = false
  for (const { dossier, nom } of entrees) {
    const chemin = join(dossier, nom)
    // Un ménage coupé (app fermée pendant la suppression) a laissé une copie déjà décrochée.
    if (nom.startsWith(PREFIXE_A_SUPPRIMER)) {
      try {
        await retirer(chemin)
        aPrune = true
      } catch (erreur) {
        bilan.echecs.push({ chemin, raison: message(erreur) })
      }
      continue
    }
    if (!identiteDeLaCopie(chemin)) continue
    const ouverteA = ouvertureSurLeDisque(chemin)
    const avant = decisionPourLaCopie({
      copie: chemin,
      fils: entree.lireFils(),
      tourEnCours: entree.tourEnCours,
      maintenant: maintenant(),
      calmeMs: entree.calmeMs,
      ouverteA
    })
    if (!avant.supprimer) {
      bilan.gardees.push({ chemin, raison: avant.raison })
      continue
    }
    try {
      git ??= await defaultGitRunner()
      const base = await lireLaBaseDuFil({
        dossier: chemin,
        conversationId: avant.filDuNom,
        runGit: git
      })
      if (!base) {
        bilan.gardees.push({
          chemin,
          raison: 'aucune base publiée : impossible de prouver que rien ne serait perdu'
        })
        continue
      }
      const [arbreBase, arbreCopie] = await Promise.all([
        git(['rev-parse', `${base}^{tree}`], chemin).then((sortie) => sortie.trim()),
        arbreDeLaCopie(chemin, git)
      ])
      if (!arbreBase || arbreBase !== arbreCopie) {
        bilan.gardees.push({ chemin, raison: 'elle porte du travail non publié' })
        continue
      }
    } catch (erreur) {
      bilan.gardees.push({ chemin, raison: `écart non mesurable : ${message(erreur)}` })
      continue
    }
    // Dernière vérification, renommage et décrochage dans le MÊME geste synchrone : aucun tour ne
    // peut s'intercaler entre le constat « fini » et la disparition du dossier.
    const juste = decisionPourLaCopie({
      copie: chemin,
      fils: entree.lireFils(),
      tourEnCours: entree.tourEnCours,
      maintenant: maintenant(),
      calmeMs: entree.calmeMs,
      ouverteA
    })
    if (!juste.supprimer) {
      bilan.gardees.push({ chemin, raison: juste.raison })
      continue
    }
    const decroche = join(dossier, `${PREFIXE_A_SUPPRIMER}${nom}`)
    try {
      renameSync(chemin, decroche)
    } catch (erreur) {
      bilan.gardees.push({ chemin, raison: `encore utilisée (${message(erreur)})` })
      continue
    }
    for (const id of juste.aDecrocher) entree.decrocher(id)
    try {
      await retirer(decroche)
      bilan.supprimees.push(chemin)
      aPrune = true
      bilan.echecs.push(
        ...rangerHistoriqueDeLaCopieRetiree({
          copie: chemin,
          dossierAvant: dossierAvantDeLaCopie(entree.lireFils(), chemin, entree.depot),
          racines: (entree.racinesHistoriqueCli ?? racinesHistoriqueCliPour)(chemin),
          jour: jourDe(maintenant())
        })
      )
    } catch (erreur) {
      bilan.echecs.push({ chemin: decroche, raison: message(erreur) })
    }
  }
  if (aPrune) {
    try {
      git ??= await defaultGitRunner()
      await git(['worktree', 'prune'], entree.depot)
    } catch (erreur) {
      bilan.echecs.push({ chemin: entree.depot, raison: `git worktree prune : ${message(erreur)}` })
    }
  }
  return bilan
}

export interface EntreeDuMenageDesCopiesDeTaches {
  dossierDeDonnees: string
  depot: string
  lireFils: () => readonly FilDuMenage[]
  tourEnCours: (id: string) => boolean
  decrocher: (id: string) => void
  maintenant?: () => number
  calmeMs?: number
  runGit?: GitRunner
  /** Les racines `projects` du CLI où l'historique d'une copie peut vivre (par défaut : les comptes d'Autowin). */
  racinesHistoriqueCli?: (copie: string) => readonly string[]
  /** Le titre d'une entrée refaite par la passe, tiré des fichiers entrés. Absent : le titre par défaut de la primitive. */
  titreDuCommit?: (tache: string, fichiers: readonly string[]) => string
  /** Appelé quand la passe fait entrer un travail que la porte avait refusé : le fil le dit à l'utilisateur. */
  annoncerLaReprise?: (tache: string) => void
}

/**
 * LE MÉNAGE DE LA RACINE UNIQUE (`copies-de-taches\<fil>`), par les verbes de la primitive : la même décision
 * que pour les copies d'avant (fil fini, calme, aucun tour), et le retrait passe par `retirerLaCopieDeTache`,
 * qui refuse tout écart et toute copie encore utilisée.
 *
 * L'ORDRE COMPTE. La primitive retire d'abord, en refusant un fil qui se sert encore de la copie ou dont le
 * tour a repris. Les fils décrochés ne sont rendus à leur dossier qu'APRÈS un retrait réussi : une copie gardée
 * (travail non publié) garde sa note, et son fil y revient au tour suivant sans bascule du dossier.
 */
export async function menageDesCopiesDeTaches(
  entree: EntreeDuMenageDesCopiesDeTaches
): Promise<BilanDuMenage> {
  const bilan: BilanDuMenage = { supprimees: [], gardees: [], echecs: [] }
  const maintenant = entree.maintenant ?? Date.now
  const calmeMs = entree.calmeMs ?? CALME_AVANT_MENAGE_MS
  const racine = racineDesCopiesDeTaches(entree.dossierDeDonnees)
  // Les suppressions coupées d'un passage précédent se finissent d'abord, sans nouvelle lecture.
  const reprises = await reprendreLesSuppressionsCoupees({
    dossierDeDonnees: entree.dossierDeDonnees,
    depot: entree.depot,
    sansDistant: true,
    runGit: entree.runGit
  })
  bilan.echecs.push(...reprises.echecs)
  if (!existsSync(racine)) return bilan
  let noms: string[]
  try {
    noms = readdirSync(racine)
  } catch (erreur) {
    bilan.echecs.push({ chemin: racine, raison: message(erreur) })
    return bilan
  }
  for (const nom of noms) {
    if (
      nom.startsWith(PREFIXE_A_SUPPRIMER) ||
      nom.startsWith(PREFIXE_EN_CREATION) ||
      nom.startsWith(PREFIXE_ENTREE_EN_ATTENTE)
    )
      continue
    const chemin = join(racine, nom)
    if (!identiteDeLaCopie(chemin)) continue
    // Une copie d'un autre dépôt se range par la passe de SON dépôt : celle-ci ne la lit pas et ne la retire pas.
    if (copieDUnAutreDepot(chemin, entree.depot)) continue
    // la passe horaire refait l'entrée que la porte a refusée (fichier visé modifié), sans nouveau tour : sans
    // cette reprise, le travail restait dans la copie jusqu'au prochain tour du fil. Un travail jamais refusé n'est pas
    // touché, et une entrée refusée n'est refaite que si aucun tour de ce fil ne tourne.
    if (
      uneEntreeEstEnAttente(entree.dossierDeDonnees, nom) &&
      !entree.tourEnCours(nom) &&
      !entree.lireFils().some((fil) => usageDeLaCopie(fil, chemin) && entree.tourEnCours(fil.id))
    ) {
      const titre = entree.titreDuCommit
      const entre = await entrerLeTravailDeLaCopie({
        dossierDeDonnees: entree.dossierDeDonnees,
        depot: entree.depot,
        tache: nom,
        sansDistant: true,
        runGit: entree.runGit,
        ...(titre ? { messageDuCommit: (fichiers: readonly string[]) => titre(nom, fichiers) } : {})
      })
      if (!entre.ok) {
        const refus = { chemin, raison: entre.raison }
        if (entre.motif === 'echec') bilan.echecs.push(refus)
        else bilan.gardees.push(refus)
        continue
      }
      if (entre.etat === 'entree') entree.annoncerLaReprise?.(nom)
    }
    const decision = decisionPourLaCopie({
      copie: chemin,
      fils: entree.lireFils(),
      tourEnCours: entree.tourEnCours,
      maintenant: maintenant(),
      calmeMs,
      ouverteA: ouvertureSurLeDisque(chemin)
    })
    if (!decision.supprimer) {
      bilan.gardees.push({ chemin, raison: decision.raison })
      continue
    }
    // Un fil décidé « fini » qui reprend entre-temps, ou un tour en cours, bloque le retrait : la primitive relit ce
    // constat juste avant de renommer la copie.
    const bloque = (fil: FilDuMenage): boolean =>
      usageDeLaCopie(fil, chemin) &&
      (entree.tourEnCours(fil.id) ||
        !decision.aDecrocher.includes(fil.id) ||
        maintenant() - fil.updatedAt < calmeMs)
    const retrait = await retirerLaCopieDeTache({
      dossierDeDonnees: entree.dossierDeDonnees,
      depot: entree.depot,
      tache: nom,
      sansDistant: true,
      runGit: entree.runGit,
      tachesQuiLUtilisent: () =>
        entree
          .lireFils()
          .filter(bloque)
          .map((fil) => fil.id)
    })
    if (!retrait.ok) {
      if (retrait.motif === 'echec') bilan.echecs.push({ chemin, raison: retrait.raison })
      else bilan.gardees.push({ chemin, raison: retrait.raison })
      continue
    }
    if (retrait.etat !== 'retiree') continue
    bilan.supprimees.push(chemin)
    bilan.echecs.push(
      ...rangerHistoriqueDeLaCopieRetiree({
        copie: chemin,
        dossierAvant: dossierAvantDeLaCopie(entree.lireFils(), chemin, entree.depot),
        racines: (entree.racinesHistoriqueCli ?? racinesHistoriqueCliPour)(chemin),
        jour: jourDe(maintenant())
      })
    )
    // Rendu à son dossier d'avant seulement après le retrait, et seulement s'il se sert toujours de cette copie.
    for (const id of decision.aDecrocher) {
      if (entree.tourEnCours(id)) continue
      if (entree.lireFils().some((fil) => fil.id === id && usageDeLaCopie(fil, chemin)))
        entree.decrocher(id)
    }
  }
  return bilan
}
