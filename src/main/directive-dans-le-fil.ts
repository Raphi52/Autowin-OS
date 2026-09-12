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
      /*
       * LA CONSIGNE SE POSE AVANT LA RÉPONSE QUI LA TRAITE (mesure du 2026-09-11, conv-439).
       *
       * Trois tours d'aller-retour sur cette ligne, parce qu'on la croyait arbitrable entre deux
       * défauts opposés. Elle ne l'est pas, pour une raison mécanique : le brouillon assistant posé
       * par `beginTurn` est VIDE au moment de l'injection — son texte n'est écrit qu'à la CLÔTURE du
       * tour. Poser la consigne « après » la pose donc sous un message qui recevra ensuite TOUT le
       * texte du tour, bloc de clôture compris. L'utilisateur relit alors sa directive sous une
       * réponse qui la traite déjà et conclut qu'elle a été ignorée : « le message vient de
       * s'afficher après ton bloc fait, comme un cheveu sur la soupe » (2026-09-11).
       *
       * Le défaut inverse (2026-09-03/04 : « mon message part au-dessus de l'agent ») était un
       * défaut d'AFFICHAGE PENDANT LE TOUR, et il a reçu sa propre solution côté écran : le reçu
       * (`.directive-receipt`) SCINDE la réponse en vol — texte déjà vu au-dessus, consigne, puis la
       * suite en dessous (ChatView.behavior.test.tsx, « place le reçu entre la réponse déjà vue et
       * la continuation »). La position PERSISTÉE n'a donc plus à compenser ce défaut-là.
       *
       * LIMITE ASSUMÉE : après rechargement, le texte du tour est UN seul message, donc la part
       * déjà lue avant l'injection se relit sous la consigne. Fix complet = scinder le message
       * assistant au point d'injection (clore sur le texte courant, puis `beginContinuationTurn`) ;
       * non fait ici, cela touche le routage des deltas par `turnId`.
       */
      avantLaReponseEnCours: true
    })
    // On retrouve la consigne par son CONTENU en repartant de la fin (et non par « le dernier
    // message »)  : l'ordre du fil est décidé par le store, pas ici — un jour où l'insertion
    // reviendrait, cette lecture resterait juste.
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
