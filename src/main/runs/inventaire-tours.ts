/**
 * L'INVENTAIRE DES TOURS INACHEVÉS REND LA MAIN AVANT LE MÉNAGE.
 *
 * Mesuré dans gels.jsonl (2026-09-12) : 25 gels « ipc:runs:unfinishedTurns (sync) », 69 s cumulées,
 * soit environ 2,8 s de fenêtre figée par ouverture. Le canal que l'interface appelle à chaque
 * démarrage lançait d'abord `pruneFinishedTurnJournals` (vidange des tampons, 462 dossiers,
 * 1 376 fichiers, 141 Mo lus et analysés ligne à ligne) AVANT de rendre la liste attendue.
 *
 * Le ménage reste nécessaire — il n'est pas supprimé, il est DÉCALÉ après la réponse. Il redevient
 * silencieux et sans effet sur le résultat rendu : une panne de ménage ne doit pas faire échouer un
 * démarrage, c'est déjà la règle qu'appliquait le `try/catch` d'origine.
 */
export function inventaireToursInacheves<T>(entree: {
  /** Ce que l'appelant attend : rendu TOUT DE SUITE. */
  lister: () => T
  /** Le ménage, joué APRÈS la réponse. Best-effort : ses pannes sont avalées, jamais propagées. */
  menage: () => void
  /** Report de l'exécution ; `setImmediate` en production, synchrone dans les tests. */
  differer?: (tache: () => void) => void
}): T {
  const differer = entree.differer ?? ((tache: () => void) => void setImmediate(tache))
  const resultat = entree.lister()
  differer(() => {
    try {
      entree.menage()
    } catch {
      /* ménage best-effort : jamais au prix du démarrage */
    }
  })
  return resultat
}
