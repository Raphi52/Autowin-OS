import type { Conv } from './chat-view-types'

export type ConversationMosaicProps = {
  /** Conversations DEJA filtrees et triees par le panneau (meme source que la liste). */
  conversations: readonly Conv[]
  activeId: string | null
  onOpen: (conv: Conv) => void
}

/**
 * Vue MOSAIQUE des conversations — pendant de `.conv-list`, alimente par la MEME source
 * (`conversationHits`), donc la recherche et le tri restent valides dans les deux modes.
 *
 * Etat volontairement SQUELETTIQUE : l'habillage d'une tuile (densite, extrait, badges) est un
 * travail de design, mene ensuite. Ce fichier ne fixe que le contrat de donnees et le geste.
 */
export function ConversationMosaic({
  conversations,
  activeId,
  onOpen
}: ConversationMosaicProps): React.JSX.Element {
  if (conversations.length === 0) {
    return <div className="conv-mosaic-empty">Aucune conversation à afficher.</div>
  }
  return (
    <div className="conv-mosaic scroll-y" data-testid="conv-mosaic">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          type="button"
          className={`conv-tile${conv.id === activeId ? ' active' : ''}`}
          data-conv-id={conv.id}
          aria-current={conv.id === activeId ? 'page' : undefined}
          onClick={() => onOpen(conv)}
        >
          <span className="conv-tile-title">{conv.title || 'Sans titre'}</span>
          <span className="conv-tile-meta">
            {conv.messageCount ?? conv.messages?.length ?? 0} messages
          </span>
        </button>
      ))}
    </div>
  )
}
