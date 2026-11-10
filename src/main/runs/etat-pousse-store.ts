import { join } from 'node:path'
import { ensureAutowinAppData } from '../app/app-data'
import { deposerFichier, relireFichier } from '../gel/ecriture-hors-fil'

/**
 * LA BASE DE COMPARAISON DE L'ÉTAT SURVIT AU REDÉMARRAGE.
 *
 * Quand la session du modèle est reprise, le bloc ÉTAT DE L'APP part en diff (`chat/etat-diff.ts`).
 * Un diff ne se calcule que contre l'état que le modèle a reçu en dernier. Cette base vivait dans une
 * `Map` en mémoire : au redémarrage, la session revenait (`runs/chat-session-store.ts`) mais pas sa
 * base, et le premier tour repris renvoyait l'état entier, catalogue des skills compris.
 *
 * UN FICHIER PAR FIL, et non un index commun : chaque tour réécrit la base de SON fil (environ 10 Ko),
 * et un index commun réécrirait l'ensemble des fils à chaque tour.
 *
 * FAIL-OPEN, comme tout cache : fichier absent, illisible ou de forme inattendue = « aucune base », donc
 * l'état ENTIER part. Un diff calculé contre une base douteuse ferait lire au modèle une valeur périmée
 * comme une valeur courante : le repli coûte plus cher, il n'est jamais faux.
 */

const DOSSIER_ETAT_POUSSE = 'etat-pousse'

/**
 * Seuls les identifiants de fil sûrs deviennent un nom de fichier : un séparateur de chemin dans
 * l'identifiant ferait sortir la base du dossier.
 */
const IDENTIFIANT_DE_FIL_SUR = /^[A-Za-z0-9_-]{1,120}$/

export type EtatPousse = Record<string, unknown>

function estUnEtat(valeur: unknown): valeur is EtatPousse {
  return !!valeur && typeof valeur === 'object' && !Array.isArray(valeur)
}

function cheminDeLEtat(conversationId: string, base: string): string {
  return join(base, DOSSIER_ETAT_POUSSE, `${conversationId}.json`)
}

/**
 * Rend la base du fil, ou `undefined`. La résolution de la racine est DANS le `try` : une racine
 * indisponible doit valoir « aucune base », jamais casser le tour.
 */
export function lireEtatPousse(conversationId: string, base?: string): EtatPousse | undefined {
  if (!IDENTIFIANT_DE_FIL_SUR.test(conversationId)) return undefined
  try {
    const texte = relireFichier(cheminDeLEtat(conversationId, base ?? ensureAutowinAppData()))
    if (texte === undefined) return undefined
    const valeur: unknown = JSON.parse(texte)
    return estUnEtat(valeur) ? valeur : undefined
  } catch {
    return undefined
  }
}

/** Dépose la base du fil. Sans effet si l'identifiant est douteux ou si l'état n'est pas un objet. */
export function deposerEtatPousse(conversationId: string, etat: unknown, base?: string): void {
  if (!IDENTIFIANT_DE_FIL_SUR.test(conversationId) || !estUnEtat(etat)) return
  try {
    deposerFichier(
      cheminDeLEtat(conversationId, base ?? ensureAutowinAppData()),
      `${JSON.stringify(etat)}\n`
    )
  } catch {
    /* base non déposée : au redémarrage suivant, l'état entier repart, ce qui reste juste */
  }
}
