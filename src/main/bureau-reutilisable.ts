/**
 * UN BUREAU PAR TÂCHE, PAS UN PAR TENTATIVE.
 *
 * DÉFAUT MESURÉ le 2026-08-25 : `withIsolatedMutation` mint un identifiant de bureau par
 * `randomUUID()` à CHAQUE appel. Un tour qui a échoué dix fois sur la même édition a donc laissé
 * DIX bureaux, tous porteurs du même JSX non compilable, ~50 Mo pièce. La source des résidus n'est
 * pas l'échec : c'est qu'un échec fabrique un objet neuf au lieu de reprendre le sien.
 *
 * LA RÈGLE, tranchée par l'utilisateur le 2026-08-25 : réinitialiser le bureau à chaque tentative,
 * SAUF s'il contient du travail qu'aucune tentative précédente sur cette cible n'explique.
 *
 * Pourquoi ce « sauf » n'est pas une précaution décorative — les deux branches naïves sont
 * mauvaises, et c'est ce qui rendait la décision indécidable sans arbitrage :
 *   - hériter du contenu : la tentative suivante repart du code cassé de la précédente. Sur le cas
 *     réel, l'agent aurait hérité de son propre JSX déséquilibré à chaque essai ;
 *   - réinitialiser toujours : on détruit le contenu de la tentative précédente, ce qui viole la
 *     contrainte « aucune suppression de travail non trié ».
 *
 * Le « sauf » tranche entre les deux avec un critère VÉRIFIABLE : le bureau ne contient-il que des
 * fichiers que cette tâche était censée toucher ? Si oui, c'est le brouillon de l'essai précédent,
 * il peut repartir de zéro. Si non, il porte autre chose — on n'y touche pas, et la tentative va
 * ailleurs.
 */

/** Ce qu'il faut faire d'un bureau retrouvé au moment d'une nouvelle tentative. */
export type DecisionBureau = 'reinitialiser' | 'preserver'

/**
 * Identifiant STABLE d'un bureau, dérivé de la tâche et non du hasard.
 *
 * Deux tentatives de la même commande, sur la même cible, dans la même conversation, retombent sur
 * le même bureau. C'est tout le levier : sans cette stabilité, aucune réutilisation n'est possible
 * et le stock croît d'un objet par échec.
 *
 * La cible est normalisée (séparateurs et casse) parce que le même fichier arrive écrit de deux
 * façons selon l'appelant, et que deux écritures d'un même chemin fabriqueraient deux bureaux —
 * exactement le défaut qu'on corrige.
 */
export function cleDeBureau(
  commande: string,
  conversationId: string | undefined,
  cible: string | undefined
): string | undefined {
  const chemin = (cible ?? '').trim()
  // Sans cible, aucune identité de tâche : l'appelant doit garder son identifiant aléatoire plutôt
  // que de faire collisionner des tâches distinctes sur un même bureau.
  if (!chemin) return undefined
  const normalise = chemin.replace(/\\/g, '/').toLowerCase()
  const empreinte = normalise.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(-60)
  const conversation = (conversationId ?? 'sans-conversation').replace(/[^A-Za-z0-9_-]/g, '')
  return `command-${commande}-${conversation}-${empreinte}`
}

/**
 * Le bureau retrouvé peut-il repartir de zéro, ou porte-t-il du travail à préserver ?
 *
 * `preserver` est le défaut prudent : tout ce qui n'est pas EXPLICITEMENT le brouillon de cette
 * tâche est laissé intact. Un bureau vide, lui, se réinitialise sans discussion — il n'y a rien à
 * perdre, et le préserver reviendrait à faire grossir le stock pour rien.
 */
export function decisionDeReutilisation(
  fichiersDuBureau: readonly string[],
  ciblesDeLaTache: readonly string[]
): DecisionBureau {
  if (fichiersDuBureau.length === 0) return 'reinitialiser'
  const attendus = new Set(ciblesDeLaTache.map((c) => c.replace(/\\/g, '/').toLowerCase()))
  if (attendus.size === 0) return 'preserver'
  const tousAttendus = fichiersDuBureau.every((fichier) =>
    attendus.has(fichier.replace(/\\/g, '/').toLowerCase())
  )
  return tousAttendus ? 'reinitialiser' : 'preserver'
}
