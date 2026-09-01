/**
 * UNE DIRECTIVE INJECTÉE EST UN MESSAGE, PAS UN SOUVENIR D'ÉCRAN.
 *
 * Répondre à une question `ask` (ou orienter) pendant qu'un tour tourne passe par l'injection :
 * la directive rejoint la boucle pilote, mais rien n'était écrit dans la conversation. Le seul
 * témoin était un « reçu » vivant dans la mémoire de l'écran — un rechargement l'effaçait, et
 * l'utilisateur devait recliquer (conv-38, 2026-09-01).
 *
 * Cette écriture est le pendant de `beginTurn` pour le texte qui n'ouvre pas de tour : elle
 * persiste le message utilisateur et demande à l'écran de relire la conversation active.
 */

export interface FilPourDirective {
  append(
    id: string,
    message: {
      role: 'user' | 'assistant'
      content: string
      orientation?: boolean
      avantLaReponseEnCours?: boolean
    }
  ): {
    messages: ReadonlyArray<{ messageId?: string; role: 'user' | 'assistant'; content: string }>
  }
}

export function enregistrerDirectiveDansLeFil(params: {
  conversations: FilPourDirective
  conversationId: string
  texte: string
  broadcast: (event: { type: 'refresh'; scope: 'chat'; convId: string }) => void
  onError?: (error: unknown) => void
}): string | undefined {
  const texte = params.texte.trim()
  if (!texte) return undefined
  try {
    const conversation = params.conversations.append(params.conversationId, {
      role: 'user',
      content: texte,
      // CE MESSAGE ORIENTE, IL NE REPOND PAS (conv-50, 2026-09-01). Sans ce drapeau, le verrou du
      // bloc `ask` le prend pour la reponse a la question du tour : le bloc affiche « Répondu » et
      // le clic de l'utilisateur ne part plus. Le verrou anti-double-envoi, lui, reste entier.
      orientation: true,
      // ELLE SE LIT AVANT LA RÉPONSE QU'ELLE ORIENTE (conv-46, 2026-09-01). Écrite en fin de fil,
      // la consigne se retrouvait SOUS le brouillon de réponse du tour en cours : l'utilisateur
      // voyait sa phrase en dernier, sans rien en dessous, et croyait qu'il ne se passait rien —
      // alors que le tour l'avait bien reçue et traitée.
      avantLaReponseEnCours: true
    })
    // La consigne n'est PAS forcément le dernier message du fil : quand un tour est en cours, elle
    // se pose AVANT le brouillon de réponse. On la retrouve donc par son contenu, en repartant de
    // la fin — la plus récente est la nôtre.
    const messageId = [...conversation.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.content === texte)?.messageId
    // L'écran ne relit la conversation active que sur `scope: 'chat'` — sans ce signal, le message
    // n'apparaîtrait qu'au prochain rechargement complet.
    params.broadcast({ type: 'refresh', scope: 'chat', convId: params.conversationId })
    return messageId
  } catch (error) {
    // Même doctrine que le journal de saisie : une trace manquée ne doit JAMAIS transformer une
    // injection acceptée en injection refusée. La directive, elle, est déjà empilée.
    params.onError?.(error)
    return undefined
  }
}
