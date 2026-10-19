/**
 * UNE LEÇON ÉCRITE QUE RIEN NE RETIENT SE DIT — conv-335 (2026-10-18).
 *
 * Mesure : le tour ff240730-2bbf-49e3-9923-5db1839772ba écrit « **Leçon** : quand le travail d'une
 * étape est confié à une tâche programmée, je retire l'étape… », puis « **Leçon corrigée** : … ».
 * Aucune n'est déposée, ni au Brain ni dans la mémoire du poste. L'utilisateur ne l'apprend qu'en le
 * demandant (tour d5bf24a1-958a-4c94-ad13-80b67a3a1fe0, « Ca sert vraiment ces lecons? » : 239 s,
 * 3,56 $). Sur 227 fils enregistrés : 31 réponses portent une ligne « Leçon : », 26 dans un tour qui
 * n'a appelé aucun `remember`.
 *
 * La constitution ne fait plus écrire ces lignes (réflexe 6), mais une règle de prompt laisse au même
 * modèle le soin de s'en souvenir. La clôture le dit donc par le CODE, sans appel modèle de plus —
 * comme elle dit déjà « Mémoire NON déposée » quand un dépôt est refusé.
 */

/**
 * Une ligne qui S'ÉTIQUETTE leçon : « Leçon : », « **Leçon** : », « - **Leçon :** »,
 * « **Leçon corrigée** : », « **Leçon (pour les prochaines captures) :** ». Une mention en cours de
 * phrase (« les deux leçons que tu as recollées ») n'en est pas une, ni une citation (`>`).
 */
const LIGNE_DE_LECON =
  /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*|__)?Le[cç]ons?(?:[ \t]+corrig[ée]es?)?(?:\*\*|__)?(?:[ \t]*\([^)\n]{0,160}\))?[ \t\u00a0\u202f]*(?:\*\*|__)?[ \t\u00a0\u202f]*:/imu

/** Les blocs de code ne sont pas la réponse : une « Leçon : » dans un exemple n'en est pas une. */
const BLOC_DE_CODE = /```[\s\S]*?```/g

export function ecritUneLecon(texte: string): boolean {
  return LIGNE_DE_LECON.test(texte.normalize('NFC').replace(BLOC_DE_CODE, ''))
}

/**
 * Un outil natif qui ÉCRIT un fichier de mémoire du poste (`…/memory/<note>.md`) : c'est un dépôt,
 * au même titre qu'un `remember` accepté (conv-265 : « Leçon (enregistrée dans ma mémoire, … .md) »).
 */
const ECRIVAIN_DE_MEMOIRE = /^(?:Write|Edit|MultiEdit)\b.*[\\/]memory[\\/][^\\/\n]+\.md\b/iu

export function ecritUnFichierDeMemoire(statut: string | undefined): boolean {
  return ECRIVAIN_DE_MEMOIRE.test((statut ?? '').trim())
}

export const AVERTISSEMENT_LECON_NON_RETENUE =
  '⚠️ Leçon non retenue — rien n’a été déposé dans le Brain ni dans la mémoire du poste ' +
  'pendant ce tour : aucune autre conversation ne la relira.'

/** Le texte de clôture, suivi de l'avertissement si une leçon y est écrite sans aucun dépôt. */
export function avertirSiLeconNonRetenue(texte: string, depotCeTour: boolean): string {
  if (depotCeTour || !ecritUneLecon(texte) || texte.includes(AVERTISSEMENT_LECON_NON_RETENUE))
    return texte
  return `${texte}\n\n${AVERTISSEMENT_LECON_NON_RETENUE}`
}
