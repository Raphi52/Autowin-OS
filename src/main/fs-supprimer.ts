import { chmodSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'

/**
 * SUPPRESSION D'UN DOSSIER (OU D'UN FICHIER) ET DE TOUT SON CONTENU — l'unique moyen sûr de l'app.
 *
 * POURQUOI ON N'APPELLE PLUS `fs.rmSync(x, { recursive: true })`, mesuré le 2026-10-05 sous
 * Electron 44.5.1 (Node 24.21.0), comparé à Electron 39.8.10 (Node 22.22.1), sur ce poste Windows :
 *
 *  1. `rmSync` échoue en EPERM sur un fichier en LECTURE SEULE — et git en crée partout
 *     (`.git/objects`). Le correctif annoncé par Electron 44.5.0 (« Fixed `fs.rmSync` failing to
 *     remove read-only files on Windows ») ne marche pas ici, même avec `maxRetries`.
 *  2. Bien plus grave : `rmSync` TRAVERSE une jonction NTFS et VIDE SA CIBLE — qu'elle soit à
 *     l'intérieur du dossier supprimé (3 essais sur 3) ou que le chemin donné soit la jonction
 *     elle-même. Sous Node 22, la jonction partait et sa cible restait intacte. Or chaque copie de
 *     travail d'agent relie `node_modules` au dépôt par une jonction
 *     (`store/dependances-copie-agent.ts`) : supprimer une copie viderait les modules du dépôt.
 *
 * CE QUI EST SÛR, mesuré le même jour sous les deux versions : `lstatSync` reconnaît une jonction
 * (`isSymbolicLink()`), et `unlinkSync` la retire SANS toucher sa cible. D'où un parcours fait à
 * la main, qui ne dépend plus du comportement interne de Node : un lien est retiré, jamais suivi.
 *
 * Comportement, cas par cas (voir `fs-supprimer.test.ts`) :
 *  - chemin absent → succès silencieux (comme `force: true`) ; un 2e appel ne fait donc rien ;
 *  - chemin vide, relatif, racine de lecteur, dossier courant ou l'un de ses parents → REFUS
 *    explicite, rien n'est supprimé (`rmSync('')` ne fait rien et ne dit rien : un bug d'appelant
 *    passait pour une réussite) ;
 *  - lien ou jonction, à la racine ou à n'importe quelle profondeur → seul le lien part ;
 *  - fichier en lecture seule → l'attribut est retiré, puis le fichier supprimé ;
 *  - verrou passager de Windows (EBUSY, ENOTEMPTY, EPERM) → quelques nouvelles tentatives
 *    espacées, puis l'erreur d'origine (qui nomme le fichier bloquant) ; le reste reste en place.
 */

export type OptionsSuppression = {
  /** Nombre total d'essais par élément quand Windows le tient verrouillé. */
  tentatives?: number
  /** Pause entre deux essais, en millisecondes. */
  pauseMs?: number
}

const TENTATIVES_PAR_DEFAUT = 5
const PAUSE_PAR_DEFAUT_MS = 100
const CODES_PASSAGERS = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES'])

function code(erreur: unknown): string | undefined {
  return (erreur as NodeJS.ErrnoException | undefined)?.code
}

function egaux(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Raison de refuser un chemin, ou `null` s'il est acceptable. Fonction pure, exportée pour être
 * testée SANS jamais appeler la suppression sur une racine ou sur le dossier courant.
 */
export function motifDeRefus(
  chemin: unknown,
  dossierCourant: string = process.cwd()
): string | null {
  if (typeof chemin !== 'string') return 'chemin absent ou mal typé'
  if (chemin.trim() === '') return 'chemin vide'
  if (!isAbsolute(chemin)) return `chemin relatif refusé : ${chemin}`
  const cible = resolve(chemin)
  if (egaux(cible, parse(cible).root) || egaux(cible + sep, parse(cible).root)) {
    return `racine de lecteur refusée : ${cible}`
  }
  // Le dossier courant et chacun de ses parents : les supprimer emporterait l'app ou le dépôt.
  let ancetre = resolve(dossierCourant)
  for (;;) {
    if (egaux(cible, ancetre)) return `dossier courant ou l'un de ses parents refusé : ${cible}`
    const parent = dirname(ancetre)
    if (parent === ancetre) break
    ancetre = parent
  }
  return null
}

function dormir(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function avecReessais(geste: () => void, tentatives: number, pauseMs: number): void {
  for (let essai = 1; ; essai++) {
    try {
      geste()
      return
    } catch (erreur) {
      if (code(erreur) === 'ENOENT') return
      if (essai >= tentatives || !CODES_PASSAGERS.has(code(erreur) ?? '')) throw erreur
      dormir(pauseMs)
    }
  }
}

/** Retire un lien ou une jonction SANS toucher sa cible. */
function retirerLien(chemin: string): void {
  try {
    unlinkSync(chemin)
  } catch (erreur) {
    // Un lien symbolique de DOSSIER (pas une jonction) se retire par rmdir sous Windows ;
    // rmdir non récursif ne descend jamais dans la cible.
    if (code(erreur) === 'EPERM' || code(erreur) === 'EISDIR') rmdirSync(chemin)
    else throw erreur
  }
}

/** Supprime un fichier, en retirant la lecture seule si Windows refuse. */
function retirerFichier(chemin: string): void {
  try {
    unlinkSync(chemin)
  } catch (erreur) {
    if (code(erreur) !== 'EPERM' && code(erreur) !== 'EACCES') throw erreur
    chmodSync(chemin, 0o666)
    unlinkSync(chemin)
  }
}

function retirerDossierVide(chemin: string): void {
  try {
    rmdirSync(chemin)
  } catch (erreur) {
    if (code(erreur) !== 'EPERM' && code(erreur) !== 'EACCES') throw erreur
    chmodSync(chemin, 0o777)
    rmdirSync(chemin)
  }
}

function retirer(chemin: string, tentatives: number, pauseMs: number): void {
  let infos
  try {
    infos = lstatSync(chemin)
  } catch (erreur) {
    if (code(erreur) === 'ENOENT') return
    throw erreur
  }
  // `lstat` NE SUIT PAS le lien : c'est toute la garde. Jamais `stat` ici.
  if (infos.isSymbolicLink()) {
    avecReessais(() => retirerLien(chemin), tentatives, pauseMs)
    return
  }
  if (!infos.isDirectory()) {
    avecReessais(() => retirerFichier(chemin), tentatives, pauseMs)
    return
  }
  // Un dossier : vider puis retirer. Sur ENOTEMPTY (quelqu'un y a écrit entre-temps), on revide.
  // Seul le retrait du dossier lui-même est réessayé ici : l'échec d'un enfant a DÉJÀ épuisé ses
  // propres tentatives, le réessayer à chaque niveau multiplierait l'attente par la profondeur.
  // fix-ok: le retrait d'un dossier réessayait aussi l'échec d'un enfant déjà épuisé — attente multipliée par la profondeur (relu, test « cas 8 verrou durable » vert sous E44 et E39).
  for (let essai = 1; ; essai++) {
    let enfants: string[]
    try {
      enfants = readdirSync(chemin)
    } catch (erreur) {
      if (code(erreur) === 'ENOENT') return
      throw erreur
    }
    for (const nom of enfants) retirer(join(chemin, nom), tentatives, pauseMs)
    try {
      retirerDossierVide(chemin)
      return
    } catch (erreur) {
      if (code(erreur) === 'ENOENT') return
      if (essai >= tentatives || !CODES_PASSAGERS.has(code(erreur) ?? '')) throw erreur
      dormir(pauseMs)
    }
  }
}

/**
 * Supprime `chemin` et tout son contenu, sans jamais suivre un lien ni une jonction.
 * Jette si le chemin est refusé (voir `motifDeRefus`) ou si un élément reste bloqué.
 */
export function supprimerArbre(chemin: string, options: OptionsSuppression = {}): void {
  const refus = motifDeRefus(chemin)
  if (refus) throw new Error(`supprimerArbre : ${refus}`)
  const tentatives = Math.max(1, options.tentatives ?? TENTATIVES_PAR_DEFAUT)
  const pauseMs = Math.max(0, options.pauseMs ?? PAUSE_PAR_DEFAUT_MS)
  retirer(resolve(chemin), tentatives, pauseMs)
}
