import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { AUTOWIN_APP_DATA_DIR } from '../../shared/app-identity'
import type { QuelBrain } from './brain-reglage'

/**
 * QUEL BRAIN POUR QUEL DOSSIER DE TRAVAIL (plan « Affectation des dossiers de travail aux Brains »,
 * lot 1 : stockage et lecture ; l'écriture par défaut de `remember` vient au lot 2).
 *
 * Un dossier de travail (CWD) peut être assigné au Brain de l'équipe ou au Brain perso. Les notes
 * écrites depuis ce dossier iront dans le Brain assigné. Le fichier vit à côté de `brain.json` et de
 * `brain-perso.json`, dans `%APPDATA%\autowin-os\brain-affectations.json` :
 *   { "affectations": [ { "cwd": "D:\\BrainRotRoyale", "brain": "perso" } ] }
 *
 * Ce module lit, écrit et répond « quel Brain pour ce dossier ». Il ne décide ni du repli quand le
 * Brain perso n'est pas réglé, ni des recherches : elles interrogent toujours les deux Brains.
 */

const NOM_FICHIER = 'brain-affectations.json'

export interface Affectation {
  /** Dossier de travail, chemin absolu tel qu'enregistré. */
  cwd: string
  /** Brain qui reçoit les notes écrites depuis ce dossier et ses sous-dossiers. */
  brain: QuelBrain
}

/** `undefined` sans `APPDATA` : un environnement qui ne le pose pas ne lit aucune affectation. */
export function brainAffectationFile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.APPDATA?.trim()
  return base ? join(base, AUTOWIN_APP_DATA_DIR, NOM_FICHIER) : undefined
}

/**
 * Forme comparable d'un chemin : absolu, séparateurs unifiés, sans casse ni `/` final. Sur le modèle
 * de `cheminComparable` (brain-perso-racine.ts). Celle-là n'est pas exportée, et ce lot ne touche à
 * aucun autre fichier : elle est donc répliquée ici.
 */
function cheminComparable(chemin: string): string {
  return resolve(chemin)
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}

/** Le chemin est-il le dossier lui-même, ou un de ses sous-dossiers ? Formes déjà comparables. */
function estDansDossier(cible: string, dossier: string): boolean {
  if (cible === dossier) return true
  // Le `/` ajouté empêche un frère au nom voisin (« Brain » et « BrainRotRoyale ») d'y passer.
  const prefixe = dossier.endsWith('/') ? dossier : `${dossier}/`
  return cible.startsWith(prefixe)
}

/** Une entrée valide a un chemin absolu et un Brain connu. Une entrée invalide est ignorée seule. */
function lireEntree(entree: unknown): Affectation | undefined {
  if (!entree || typeof entree !== 'object') return undefined
  const { cwd, brain } = entree as { cwd?: unknown; brain?: unknown }
  const marque: QuelBrain | undefined =
    brain === 'equipe' ? 'equipe' : brain === 'perso' ? 'perso' : undefined
  if (typeof cwd !== 'string' || !marque) return undefined
  const chemin = cwd.trim()
  if (!chemin || !isAbsolute(chemin)) return undefined
  return { cwd: resolve(chemin), brain: marque }
}

/** Ce qu'on lit du fichier : ses affectations, et s'il existe sans pouvoir se lire. */
interface Lecture {
  affectations: Affectation[]
  /** Présent mais pas un JSON d'affectations : il est mis de côté avant toute nouvelle écriture. */
  illisible: boolean
}

function lireFichier(fichier: string): Lecture {
  let brut: unknown
  try {
    // Un BOM, écrit par certains éditeurs Windows, ne doit pas rendre le fichier illisible.
    brut = JSON.parse(readFileSync(fichier, 'utf8').replace(/^\uFEFF/, ''))
  } catch (erreur) {
    // Absent = aucune affectation. Présent mais cassé = illisible.
    const absent = (erreur as NodeJS.ErrnoException).code === 'ENOENT'
    return { affectations: [], illisible: !absent }
  }
  const liste = (brut as { affectations?: unknown } | null)?.affectations
  if (!Array.isArray(liste)) return { affectations: [], illisible: true }
  // Un même dossier présent deux fois : la dernière entrée gagne.
  const parCle = new Map<string, Affectation>()
  for (const entree of liste) {
    const affectation = lireEntree(entree)
    if (affectation) parCle.set(cheminComparable(affectation.cwd), affectation)
  }
  return { affectations: [...parCle.values()], illisible: false }
}

/**
 * Les affectations enregistrées, ou `[]`. Ne bloque jamais le démarrage : absent, illisible ou mal
 * formé, c'est « aucune affectation ».
 */
export function lireAffectations(env: NodeJS.ProcessEnv = process.env): Affectation[] {
  const fichier = brainAffectationFile(env)
  return fichier ? lireFichier(fichier).affectations : []
}

/**
 * Le fichier est-il présent sans pouvoir se lire ? `lireAffectations` rend alors `[]`, comme pour un
 * fichier absent : cette sonde permet à l'appelant (les canaux) de dire la différence.
 */
export function affectationsIllisibles(env: NodeJS.ProcessEnv = process.env): boolean {
  const fichier = brainAffectationFile(env)
  return fichier ? lireFichier(fichier).illisible : false
}

/** Suffixe du fichier illisible mis de côté ; suivi d'un horodatage. */
export const SUFFIXE_ILLISIBLE = '.illisible-'

/** Un fichier illisible part à côté, sous un autre nom : ce qu'il contient reste retrouvable. */
function mettreDeCote(fichier: string): void {
  renameSync(fichier, `${fichier}${SUFFIXE_ILLISIBLE}${Date.now()}`)
}

/**
 * Écrit la liste complète. Liste vide : le fichier disparaît, comme le réglage du Brain quand il n'y
 * a plus rien à régler.
 */
function ecrireFichier(fichier: string, affectations: Affectation[]): void {
  if (affectations.length === 0) {
    rmSync(fichier, { force: true })
    return
  }
  mkdirSync(dirname(fichier), { recursive: true })
  // Écriture atomique : le contenu part dans un fichier temporaire du même dossier, puis un renommage
  // le substitue d'un seul coup. Un lecteur ne voit jamais un JSON à moitié écrit.
  const temporaire = `${fichier}.${process.pid}-${randomUUID()}.tmp`
  try {
    writeFileSync(temporaire, `${JSON.stringify({ affectations }, null, 2)}\n`, 'utf8')
    renameSync(temporaire, fichier)
  } catch (erreur) {
    rmSync(temporaire, { force: true })
    throw erreur
  }
}

/** Un chemin relatif dépendrait du dossier où l'app a démarré : on le refuse. */
function exigerCheminAbsolu(cwd: string): string {
  const chemin = cwd.trim()
  if (!chemin || !isAbsolute(chemin)) {
    throw new Error(
      `Chemin absolu obligatoire : « ${cwd} ». Donne le dossier entier, par exemple D:\\Projets\\MonDossier.`
    )
  }
  return chemin
}

/**
 * Assigne un Brain à un dossier de travail. Une entrée déjà présente pour le même dossier (comparaison
 * normalisée) est remplacée ; les autres sont gardées. Refuse un chemin relatif ou un Brain inconnu,
 * sans rien écrire. Renvoie l'affectation telle qu'elle est enregistrée.
 */
export function enregistrerAffectation(
  env: NodeJS.ProcessEnv,
  cwd: string,
  brain: QuelBrain
): Affectation {
  const chemin = exigerCheminAbsolu(cwd)
  if (brain !== 'equipe' && brain !== 'perso') {
    throw new Error(`Brain inconnu : « ${String(brain)} ». Valeurs possibles : equipe ou perso.`)
  }
  const fichier = brainAffectationFile(env)
  if (!fichier)
    throw new Error('Dossier de données introuvable (APPDATA) : affectation non enregistrée.')
  const affectation: Affectation = { cwd: resolve(chemin), brain }
  const cle = cheminComparable(affectation.cwd)
  const lecture = lireFichier(fichier)
  if (lecture.illisible) mettreDeCote(fichier)
  ecrireFichier(fichier, [
    ...lecture.affectations.filter((a) => cheminComparable(a.cwd) !== cle),
    affectation
  ])
  return affectation
}

/**
 * Retire l'affectation de ce dossier exact : son parent et ses sous-dossiers gardent leur Brain.
 * Renvoie `true` si une entrée a été retirée. Un fichier illisible n'est jamais réécrit ici.
 */
export function retirerAffectation(env: NodeJS.ProcessEnv, cwd: string): boolean {
  const cle = cheminComparable(exigerCheminAbsolu(cwd))
  const fichier = brainAffectationFile(env)
  if (!fichier) return false
  const lecture = lireFichier(fichier)
  if (lecture.illisible) return false
  const restantes = lecture.affectations.filter((a) => cheminComparable(a.cwd) !== cle)
  if (restantes.length === lecture.affectations.length) return false
  ecrireFichier(fichier, restantes)
  return true
}

/**
 * Le Brain assigné à ce dossier, ou `undefined` : aucune affectation, donc le comportement d'avant
 * (l'équipe). Un dossier assigné couvre ses sous-dossiers ; la correspondance la plus longue gagne.
 * Un chemin relatif ne correspond à rien. Le Brain rendu est celui qui est enregistré, sans repli : si
 * le Brain perso n'est pas réglé, c'est à l'appelant de le signaler (lot 2).
 */
export function brainPourCwd(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): QuelBrain | undefined {
  const chemin = cwd.trim()
  if (!chemin || !isAbsolute(chemin)) return undefined
  const cible = cheminComparable(chemin)
  let retenue: Affectation | undefined
  let longueur = -1
  for (const affectation of lireAffectations(env)) {
    const dossier = cheminComparable(affectation.cwd)
    if (!estDansDossier(cible, dossier) || dossier.length <= longueur) continue
    retenue = affectation
    longueur = dossier.length
  }
  return retenue?.brain
}
