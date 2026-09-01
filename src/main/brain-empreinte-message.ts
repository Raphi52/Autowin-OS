import type { BrainRetrievalStatus } from './brain-retrieval'

/**
 * DIRE POURQUOI LE BRAIN EST MUET — « il ne sait rien » et « on n'a pas pu lui demander » ne se
 * disent pas pareil.
 *
 * MESURE conv-9 (2026-08-31). La phase `think` a affiche « Aucune empreinte de depot dans le Brain —
 * /learn en fin de run l'ecrira pour les prochains » alors que la trace Brain du MEME tour portait
 * `{ found: false, status: 'unavailable', injectedChars: 0 }` : le serveur etait INJOIGNABLE. Le
 * message transformait une panne d'infrastructure en resultat de recherche. Consequences vecues dans
 * ce meme tour : personne n'a songe a relancer le serveur, et le depot d'une lecon a ensuite echoue
 * pour la meme raison sans que le lien soit fait.
 *
 * Le statut etait pourtant deja calcule deux lignes plus haut : le message choisissait simplement de
 * ne regarder que la TAILLE du texte recupere. Un instrument qui invente la cause de son silence
 * ferme l'enquete au lieu de l'ouvrir.
 */
export function messageEmpreinteBrain(
  statut: BrainRetrievalStatus | undefined,
  caracteresInjectes: number
): { text: string; detail: string } {
  if (caracteresInjectes > 0)
    return {
      text: `Empreinte du dépôt chargée (${caracteresInjectes} caractères) — injectée en tête de contexte des phases.`,
      detail: 'think : empreinte chargée'
    }
  if (statut === 'unavailable')
    return {
      text:
        'Brain INJOIGNABLE — aucune empreinte n’a pu être demandée (serveur arrêté, jeton absent ou ' +
        'réseau). Ce n’est PAS « la base ne sait rien » : rien n’a été interrogé, et un dépôt lancé ' +
        'maintenant échouerait pour la même raison.',
      detail: 'think : Brain injoignable'
    }
  if (statut === 'invalid')
    return {
      text:
        'Réponse du Brain ILLISIBLE (format ou intégrité) — l’empreinte est écartée. La base a répondu, ' +
        'mais ce qu’elle a répondu n’est pas exploitable : ne pas en conclure qu’elle est vide.',
      detail: 'think : réponse Brain invalide'
    }
  return {
    text:
      'Aucune empreinte de dépôt dans le Brain — la base a bien répondu, elle ne connaît simplement ' +
      'rien sur ce sujet ; /learn en fin de run l’écrira pour les prochains.',
    detail: 'think : aucune empreinte'
  }
}
