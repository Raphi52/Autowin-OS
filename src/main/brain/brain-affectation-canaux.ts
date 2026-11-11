import type { BrainAffectationsState } from '../../shared/preload-contracts'
import { readdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import {
  affectationsIllisibles,
  brainAffectationFile,
  enregistrerAffectation,
  lireAffectations,
  retirerAffectation,
  SUFFIXE_ILLISIBLE
} from './brain-affectation'
import type { QuelBrain } from './brain-reglage'

/**
 * Les trois canaux des affectations dossier de travail → Brain (plan « Affectation des dossiers de
 * travail aux Brains », lot 3) : la liste, l'enregistrement `{ cwd, brain }` et le retrait `{ cwd }`.
 *
 * L'entrée vient du rendu : sa forme est donc inconnue et se valide ICI, avant tout appel à
 * `brain-affectation.ts` (lot 1). Chaque réponse porte la liste à jour ; une demande refusée y ajoute
 * `erreur`, une raison lisible. Rien ne plante, et un refus n'écrit rien. `chat.ts` ne fait que le
 * câblage : garde de l'expéditeur, puis un appel à ce module.
 *
 * FICHIER ILLISIBLE (lot 7) : `brain-affectation.ts` rend alors une liste vide, comme pour un fichier
 * absent, et l'enregistrement le met de côté sous un autre nom. Les trois canaux le disent dans
 * `erreur` : fichier illisible présent (lecture, retrait), ou nom du fichier mis de côté
 * (enregistrement). Sans cela, l'interface montrerait « aucune affectation » alors qu'il en reste.
 */

/** Limite Windows d'un chemin, chemins longs compris : au-delà, ce ne peut pas être un dossier. */
const CHEMIN_MAX = 32767

const MSG_CWD_MANQUANT = 'Dossier de travail manquant : il faut un chemin absolu, en texte.'
const MSG_CHEMIN_LONG = 'Chemin trop long pour être un dossier de travail.'
const MSG_BRAIN_INCONNU = 'Brain inconnu : il faut choisir equipe ou perso.'

/** Le nom du fichier d'affectations, ou `undefined` sans `APPDATA`. */
function nomDuFichier(env: NodeJS.ProcessEnv): string | undefined {
  const fichier = brainAffectationFile(env)
  return fichier ? basename(fichier) : undefined
}

function msgIllisible(env: NodeJS.ProcessEnv): string {
  return `Le fichier ${nomDuFichier(env)} est présent mais illisible : la liste est vide et rien n'y a été modifié. Enregistrer une affectation le mettra de côté sous un autre nom.`
}

function msgMisDeCote(nom: string, enregistre: boolean): string {
  const suite = enregistre
    ? "l'affectation est enregistrée dans un fichier neuf"
    : "l'affectation n'a pas pu être enregistrée"
  return `Le fichier des affectations était illisible : il a été mis de côté sous le nom ${nom}, et ${suite}.`
}

/** Les fichiers illisibles déjà mis de côté, par nom. Dossier absent ou illisible : aucun. */
function misDeCote(env: NodeJS.ProcessEnv): string[] {
  const fichier = brainAffectationFile(env)
  if (!fichier) return []
  const prefixe = `${basename(fichier)}${SUFFIXE_ILLISIBLE}`
  try {
    return readdirSync(dirname(fichier)).filter((nom) => nom.startsWith(prefixe))
  } catch {
    return []
  }
}

/**
 * La liste à jour, avec l'état réel du fichier. Un fichier illisible encore en place s'ajoute à la
 * raison donnée par l'appelant : ni l'une ni l'autre ne se perd.
 */
function etat(env: NodeJS.ProcessEnv, erreur?: string): BrainAffectationsState {
  const raisons = [erreur, affectationsIllisibles(env) ? msgIllisible(env) : undefined].filter(
    (r): r is string => Boolean(r)
  )
  return {
    affectations: lireAffectations(env),
    ...(raisons.length ? { erreur: raisons.join(' ') } : {})
  }
}

function raison(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur)
}

/** Les champs de l'entrée. Une entrée qui n'est pas un objet n'a aucun champ. */
function champs(entree: unknown): { cwd?: unknown; brain?: unknown } {
  return entree && typeof entree === 'object' ? (entree as { cwd?: unknown; brain?: unknown }) : {}
}

/**
 * Le dossier, s'il est un texte de taille raisonnable. Son caractère absolu est vérifié par
 * `brain-affectation.ts`, qui donne lui-même sa raison.
 */
function dossier(cwd: unknown): { cwd: string } | { erreur: string } {
  if (typeof cwd !== 'string') return { erreur: MSG_CWD_MANQUANT }
  if (cwd.length > CHEMIN_MAX) return { erreur: MSG_CHEMIN_LONG }
  return { cwd }
}

/** La liste des affectations, à jour. */
export function listerAffectations(env: NodeJS.ProcessEnv = process.env): BrainAffectationsState {
  return etat(env)
}

/** Assigne un Brain à un dossier de travail. Entrée attendue : `{ cwd, brain }`. */
export function enregistrerAffectationDepuisLeRendu(
  env: NodeJS.ProcessEnv,
  entree: unknown
): BrainAffectationsState {
  const { cwd, brain } = champs(entree)
  const lu = dossier(cwd)
  if ('erreur' in lu) return etat(env, lu.erreur)
  // Valeurs fermées : seuls `equipe` et `perso` passent.
  const marque: QuelBrain | undefined =
    brain === 'equipe' ? 'equipe' : brain === 'perso' ? 'perso' : undefined
  if (!marque) return etat(env, MSG_BRAIN_INCONNU)
  // Un fichier illisible est mis de côté par l'enregistrement : son nouveau nom est celui qui
  // apparaît dans le dossier entre l'avant et l'après.
  const avant = new Set(misDeCote(env))
  const nouveau = (): string | undefined => misDeCote(env).find((nom) => !avant.has(nom))
  try {
    enregistrerAffectation(env, lu.cwd, marque)
    const nom = nouveau()
    return etat(env, nom ? msgMisDeCote(nom, true) : undefined)
  } catch (erreur) {
    const nom = nouveau()
    return etat(env, nom ? `${msgMisDeCote(nom, false)} ${raison(erreur)}` : raison(erreur))
  }
}

/**
 * Retire l'affectation de ce dossier exact. Entrée attendue : `{ cwd }`. Un dossier sans affectation
 * n'est pas un refus : la liste reste telle quelle. Un fichier illisible n'est pas réécrit : la
 * réponse le dit, au lieu d'une liste vide muette.
 */
export function retirerAffectationDepuisLeRendu(
  env: NodeJS.ProcessEnv,
  entree: unknown
): BrainAffectationsState {
  const lu = dossier(champs(entree).cwd)
  if ('erreur' in lu) return etat(env, lu.erreur)
  try {
    retirerAffectation(env, lu.cwd)
    return etat(env)
  } catch (erreur) {
    return etat(env, raison(erreur))
  }
}
