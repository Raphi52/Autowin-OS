/**
 * ASSEMBLAGE DU MESSAGE D'UN TOUR DE CHAT — extrait pour être VÉRIFIABLE.
 *
 * Ce qui vit ici y vit pour une raison précise : tout contenu qui DÉPEND du tour (état de l'app, contexte
 * récupéré, écho de mémoire) doit voyager dans le MESSAGE et jamais dans le prompt système. Mesuré le
 * 2026-07-28 : tant qu'un contenu variable était concaténé au système, `cache_read` valait 0 sur 100 % des
 * appels — ~16 k de cache réécrits à chaque tour pour répondre une phrase.
 *
 * L'extraction est née d'un défaut d'AUDIT, pas d'un goût pour l'abstraction : la présence de l'écho de
 * mémoire n'était prouvée que par un test qui LISAIT le source (`toContain('sessionMemoryBlock')`). Un tel
 * test survit à un câblage cassé. Ici l'invariant se teste sur la sortie réelle de la fonction.
 */

export interface TurnMessageParts {
  /** État courant de l'app, sérialisé. */
  snapshot: unknown
  /** Bloc de connaissance récupérée (Brain + graphe), déjà mis en forme. Peut être vide. */
  brainContext: string
  /** Écho des faits retenus dans ce fil. Peut être vide. */
  memoryEcho: string
  /**
   * Corps de la skill invoquée en tête du message (`/remake …`), déjà mis en forme. Vide sinon.
   *
   * Ici et non dans le `system`, pour la raison qui gouverne tout ce fichier : ce contenu APPARAÎT et
   * DISPARAÎT selon le tour, donc le mettre dans le préfixe le réécrirait à chaque invocation et tuerait
   * le cache. Conséquence voulue : le coût d'une skill n'est payé que quand elle est demandée.
   */
  skillBody?: string
  /** Le fil complet, utilisé quand aucune session CLI n'est reprise. */
  history: ReadonlyArray<{ role: string; content: string }>
  /** Renseigné quand une session CLI existante est reprise : le modèle connaît déjà l'historique. */
  resumeSessionId?: string
  /** Dernier message utilisateur — le seul renvoyé quand la session est reprise. */
  lastUserMessage?: string
}

/**
 * Borne l'historique sans laisser une réponse assistant privée de sa question en tête.
 *
 * Un tour entrant contient normalement `2n + 1` messages (les paires précédentes, puis la nouvelle
 * question). Une tranche paire comme `slice(-40)` commence alors par la dernière réponse du tour
 * écarté. On conserve la même borne puis on réaligne uniquement le début sur le prochain utilisateur.
 */
export function boundedTurnHistory<T extends { role: 'user' | 'assistant' }>(
  history: readonly T[],
  maxMessages = 40
): T[] {
  if (!Number.isInteger(maxMessages) || maxMessages <= 0) return []
  const tail = history.slice(-maxMessages)
  const firstUser = tail.findIndex((message) => message.role === 'user')
  return firstUser < 0 ? [] : tail.slice(firstUser)
}

/**
 * Rend les entrées du message, dans l'ordre, sans aucune entrée vide.
 *
 * Une entrée vide (pas de contexte récupéré, pas d'écho) laisserait un trou de deux sauts de ligne dans
 * le prompt final : on filtre, on ne laisse pas le hasard décider.
 */
export function buildTurnMessages(parts: TurnMessageParts): string[] {
  const entries = parts.resumeSessionId
    ? [
        `ÉTAT DE L'APP:\n${JSON.stringify(parts.snapshot)}`,
        parts.brainContext,
        parts.memoryEcho,
        parts.skillBody ?? '',
        `Suite de NOTRE conversation en cours (tu en connais déjà l'historique par ta session : ne le redemande pas).`,
        `UTILISATEUR: ${parts.lastUserMessage ?? ''}`
      ]
    : [
        `ÉTAT DE L'APP:\n${JSON.stringify(parts.snapshot)}`,
        parts.brainContext,
        parts.memoryEcho,
        parts.skillBody ?? '',
        ...parts.history.map((m) => `${m.role === 'user' ? 'UTILISATEUR' : 'TOI'}: ${m.content}`)
      ]
  return entries.filter((entry) => entry.trim().length > 0)
}
