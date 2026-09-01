import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * QUI A DEMANDE LA FERMETURE — le chainon manquant du journal des arrets.
 *
 * `scripts/enregistreur_sortie.py` sait dire QUAND l'app est morte et AVEC QUEL CODE, mais jamais
 * POURQUOI : une fermeture demandee par la commande `restart_app`, une relance apres mise a jour et
 * une coupure par l'outil de developpement rendent exactement la meme ligne « code=0 arret propre ».
 * Le 2026-09-01, retrouver la cause d'une fermeture a coute le recoupement de quatre journaux et de
 * l'historique git. Cette cause, l'app est la SEULE a la connaitre : elle doit donc l'ecrire
 * elle-meme, dans le MEME fichier, juste avant de mourir.
 *
 * Deux proprietes non negociables :
 * - une seule ligne par fermeture, ecrite au dernier moment (`before-quit`) : l'origine annoncee
 *   plus tot peut etre annulee par un `preventDefault`, seule la sortie reelle fait foi.
 * - aucune exception ne remonte : un journal qui casse la fermeture serait pire que pas de journal.
 */

/** Ce qui s'affiche quand aucun chemin interne n'a revendique la fermeture. */
export const ORIGINE_INCONNUE =
  'inconnue — fermeture externe (fenetre, outil de developpement, arret systeme)'

let origineAnnoncee: string | null = null

/** Le journal des arrets vit a la RACINE des donnees portables, aux cotes des lignes du veilleur. */
export function cheminJournalArrets(racineDonnees: string): string {
  return join(racineDonnees, 'app-exits.log')
}

/**
 * Revendique la fermeture a venir. Le DERNIER appelant gagne : c'est celui qui a reellement
 * declenche le `quit`, les precedents ayant renonce.
 */
export function annoncerFermeture(origine: string): void {
  const propre = origine.trim()
  if (propre) origineAnnoncee = propre
}

/** Pour les tests, et pour un `preventDefault` qui rend la main sans fermer. */
export function oublierOrigineFermeture(): void {
  origineAnnoncee = null
}

function horodatage(maintenant: Date): string {
  const deux = (valeur: number): string => String(valeur).padStart(2, '0')
  return (
    `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}` +
    `T${deux(maintenant.getHours())}:${deux(maintenant.getMinutes())}:${deux(maintenant.getSeconds())}`
  )
}

/**
 * Ecrit la cause dans le journal des arrets et rend la ligne ecrite (vide si l'ecriture a echoue).
 * Le format reprend celui du veilleur Python : horodatage local, puis une etiquette, puis du texte.
 */
export function journaliserCauseFermeture(chemin: string, maintenant: Date = new Date()): string {
  const ligne = `${horodatage(maintenant)} fermeture demandee-par=${origineAnnoncee ?? ORIGINE_INCONNUE}\n`
  try {
    mkdirSync(dirname(chemin), { recursive: true })
    appendFileSync(chemin, ligne, 'utf8')
  } catch {
    return ''
  }
  return ligne
}
