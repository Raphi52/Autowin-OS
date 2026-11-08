import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ancienNomDeCopieDeFil, nomDeCopieDeFil } from '../../shared/copie-du-fil'
import { supprimerArbreAsync } from '../fichiers/fs-supprimer'
import { lireLaBaseDuFil } from '../git/photo-du-code'
import { CALME_AVANT_PUBLICATION_MS } from '../git/git-apres-fil'
import { arbreDeLaCopie } from '../orchestration/garder-un-essai'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import { delierLesDependances } from '../store/dependances-copie-agent'

/*
 * LE MÉNAGE DES COPIES DE FIL. Chaque fil du dépôt d'Autowin reçoit sa copie
 * (`copies-de-fil/<fil>` ; avant elle, `retours-de-tour/essai__<fil>-<instant>-1`, voir
 * `bascule-dossier-conversation.ts`) et rien ne la retirait : 11 copies complètes du dépôt sur le disque le 07/11, une par fil ouvert depuis la veille.
 * L'utilisateur a demandé qu'elles soient supprimées quand leur fil est fini.
 *
 * UNE COPIE PART SEULEMENT SI RIEN N'Y SERAIT PERDU : son arbre (fichiers non suivis compris, ignorés
 * exclus) est celui de la base du fil, c'est-à-dire exactement ce que la porte de fin de tour a déjà
 * publié. Une copie qui porte un écart reste, quelle que soit l'ancienneté du fil. Mesuré le 07/11 :
 * 9 copies sur 11 étaient dans ce cas, et celle de conv-1702 portait un travail non publié.
 *
 * « FINI » = aucun tour en cours, et le fil est resté calme `CALME_AVANT_MENAGE_MS` (ou il est marqué
 * inactif et calme depuis `CALME_AVANT_PUBLICATION_MS`). Pas le calme de 3 min de la publication :
 * un fil repris après sa suppression rouvre une copie neuve et repart sans la session interne de
 * l'outil, avec tout l'historique du fil — un prix à ne payer qu'après une vraie pause.
 *
 * LE FIL EST DÉCROCHÉ AVANT LA SUPPRESSION : son dossier rangé redevient celui d'avant la copie.
 * Sans quoi son tour suivant serait refusé (« dossier rangé disparu »). La copie est d'abord RENOMMÉE
 * (`a-supprimer__…`) dans le même geste synchrone que la dernière vérification : un tour qui démarre
 * ensuite ne la voit plus et en ouvre une neuve ; un renommage refusé par Windows (un fichier ouvert
 * dedans) laisse la copie en place. La suppression suit l'ordre de `balayerCopiesDeBaseOrphelines` :
 * la jonction `node_modules` d'abord (elle mène aux modules du dépôt), puis l'arbre par
 * `supprimerArbreAsync` qui ne suit jamais un lien, puis `git worktree prune` dans le dépôt.
 */

/** 12 h : un fil laissé le soir est rangé au matin, un fil de la journée garde sa copie. */
export const CALME_AVANT_MENAGE_MS = 12 * 3_600_000

/** Le préfixe d'une copie décrochée et en cours de suppression : un ménage coupé la reprend. */
export const PREFIXE_A_SUPPRIMER = 'a-supprimer__'

/** Ce que le ménage lit d'un fil. */
export interface FilDuMenage {
  id: string
  projectPath?: string
  copieDuFil?: { chemin?: unknown }
  inactive?: boolean
  updatedAt: number
}

/**
 * Le fil d'une copie de fil et, quand son nom le porte, l'instant de son ouverture : `copies-de-fil/<fil>`,
 * ou l'ancien nom `essai__<fil>-<instant>-<rang>`. `null` pour tout autre dossier.
 */
function identiteDeLaCopie(copie: string): { fil: string; quand?: number } | null {
  const ancienne = ancienNomDeCopieDeFil(copie)
  if (ancienne) return { fil: ancienne.fil, quand: ancienne.quand }
  return nomDeCopieDeFil(copie)
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
  const utilisateurs = entree.fils.filter(
    (fil) =>
      cle(fil.projectPath) === ici ||
      (typeof fil.copieDuFil?.chemin === 'string' && cle(fil.copieDuFil.chemin) === ici)
  )
  // Sans fil (supprimé, ou archivé pas encore relu) : seule l'heure de la copie dit son âge. Une copie
  // toute neuve peut être celle qu'un tour est en train d'ouvrir, avant de la noter sur son fil.
  if (utilisateurs.length === 0)
    return ouverteA !== undefined && entree.maintenant - ouverteA >= calmeMs
      ? { supprimer: true, filDuNom: nom.fil, aDecrocher: [] }
      : { supprimer: false, raison: 'copie récente sans fil : peut-être en cours d’ouverture' }
  const aDecrocher: string[] = []
  for (const fil of utilisateurs) {
    if (entree.tourEnCours(fil.id))
      return { supprimer: false, raison: `${fil.id} a un tour en cours` }
    const calme = entree.maintenant - fil.updatedAt
    const fini = calme >= calmeMs || (fil.inactive === true && calme >= CALME_AVANT_PUBLICATION_MS)
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

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur)
}

/** Retire une copie déjà décrochée : la jonction des modules d'abord, puis l'arbre. */
async function retirerLaCopie(chemin: string): Promise<void> {
  const retrait = delierLesDependances(chemin)
  if (retrait.fait === 'echec') throw new Error(`jonction des modules : ${retrait.raison}`)
  await supprimerArbreAsync(chemin)
}

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
