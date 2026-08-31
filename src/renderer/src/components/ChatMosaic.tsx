/**
 * MOSAIQUE MULTI-CHAT — N conversations ouvertes COTE A COTE, chacune avec son fil vivant et son
 * champ d'envoi. Ce n'est pas une grille de vignettes : chaque case est un chat sur lequel on peut
 * prompter, et la grille se recalcule selon le NOMBRE de fenetres ouvertes.
 *
 * Le composant est PUREMENT presentationnel : il ne connait ni l'IPC ni l'etat global. ChatView lui
 * fournit les fils (deja peints par `publierFil`) et recoit les gestes (fermer, envoyer).
 *
 * Le champ d'envoi est LOCAL et volontairement minimal : `ChatComposer` porte les palettes `/` et
 * `@`, les brouillons et la barre technique, tous couples a la conversation ACTIVE unique. Le
 * brancher par fenetre est un chantier a part — a faire quand l'ergonomie de la mosaique est validee.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'
import { colonnesPour } from './chat-mosaic-grille'
import './ChatMosaic.css'
import {
  marquerConversationEnAttente,
  retirerConversationEnAttente
} from './conversations-attention'

export type ChatMosaicWindow = {
  id: string
  title: string
  messages: readonly Msg[]
  busy: boolean
}

export type ChatMosaicProps = {
  fenetres: readonly ChatMosaicWindow[]
  onClose: (id: string) => void
  /** Quitte la mosaique et ouvre CETTE conversation seule dans le fil unique. */
  onOuvrirSeule: (id: string) => void
  /**
   * Composer de la fenetre, FABRIQUE PAR LE PARENT : c'est le vrai `ChatComposer` du chat plein,
   * avec ses palettes, ses pieces jointes et son brouillon. La mosaique n'en reimplemente aucun —
   * une seconde implementation aurait diverge des la premiere evolution.
   */
  rendreComposer: (id: string) => React.ReactNode
  /** Ouvre une conversation NEUVE dans une case de plus. */
  onNouvelleConversation: () => void
  /**
   * SIGNATURE des entrees du composer qui ne transitent PAS par `fenetre` (brouillons, pieces
   * jointes, palettes). Elle change quand un composer doit se redessiner, et SEULEMENT alors :
   * c'est ce qui autorise une fenetre inchangee a ne pas se re-rendre pendant qu'une autre streame.
   */
  signatureComposer?: string
}

function FenetreChatBrut({
  fenetre,
  onClose,
  onOuvrirSeule,
  rendreComposer
}: {
  fenetre: ChatMosaicWindow
  onClose: (id: string) => void
  onOuvrirSeule: (id: string) => void
  rendreComposer: (id: string) => React.ReactNode
  /** Jamais lue ici : elle n'existe que pour le comparateur du memo ci-dessous. */
  signatureComposer?: string
}): React.JSX.Element {
  const filRef = useRef<HTMLDivElement>(null)
  /**
   * COLLE EN BAS par defaut. Une fenetre de mosaique est petite : sans ce suivi, chaque token
   * pousse le dernier message hors du cadre et il faut defiler a la main, dans CHAQUE fenetre.
   */
  const [colleEnBas, setColleEnBas] = useState(true)
  /**
   * ATTENTION REQUISE : le tour de l agent vient de se TERMINER dans cette fenetre et l utilisateur
   * n y est pas encore revenu. La bordure se colore pour qu il voie, d un coup d oeil sur la
   * mosaique, ou intervenir. Le marqueur retombe des qu il touche la fenetre (clic ou focus).
   */
  const [attention, setAttention] = useState(false)
  const busyPrecedent = useRef(fenetre.busy)
  useEffect(() => {
    // L'etat est aussi PUBLIE : l'accueil affiche la meme liste que ces bordures dorees. Sans cette
    // publication, l'information restait prisonniere de ce composant.
    if (busyPrecedent.current && !fenetre.busy) {
      setAttention(true)
      marquerConversationEnAttente(fenetre.id, fenetre.title)
    }
    if (fenetre.busy) {
      setAttention(false)
      retirerConversationEnAttente(fenetre.id)
    }
    busyPrecedent.current = fenetre.busy
  }, [fenetre.busy, fenetre.id, fenetre.title])
  const repris = (): void => {
    setAttention(false)
    retirerConversationEnAttente(fenetre.id)
  }
  const surDefilement = (): void => {
    const el = filRef.current
    if (!el) return
    setColleEnBas(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }
  useEffect(() => {
    const el = filRef.current
    if (el && colleEnBas) el.scrollTop = el.scrollHeight
  }, [fenetre.messages, colleEnBas])

  return (
    <section
      className="chat-mosaic-window"
      data-conv-id={fenetre.id}
      data-etat={fenetre.busy ? 'occupe' : attention ? 'attention' : undefined}
      onMouseDown={repris}
      onFocusCapture={repris}
    >
      <header className="chat-mosaic-window-head">
        <span className="chat-mosaic-window-title">{fenetre.title || 'Sans titre'}</span>
        {fenetre.busy && (
          <span className="chat-mosaic-window-busy" aria-label="Tour en cours">
            •
          </span>
        )}
        <button
          type="button"
          className="chat-mosaic-window-open"
          data-testid="chat-mosaic-open"
          aria-label={`Ouvrir ${fenetre.title || 'la conversation'} en plein ecran`}
          title="Ouvrir cette conversation seule"
          onClick={() => onOuvrirSeule(fenetre.id)}
        >
          ↗
        </button>
        <button
          type="button"
          className="chat-mosaic-window-close"
          aria-label={`Fermer ${fenetre.title || 'la conversation'}`}
          onClick={() => onClose(fenetre.id)}
        >
          ×
        </button>
      </header>
      <div className="chat-mosaic-window-thread scroll-y" ref={filRef} onScroll={surDefilement}>
        {fenetre.messages.length === 0 ? (
          <div className="chat-mosaic-window-empty">Aucun message.</div>
        ) : (
          fenetre.messages.map((message, index) => (
            <ChatMessageRow
              key={`${fenetre.id}-${index}`}
              message={message}
              conversationId={fenetre.id}
            />
          ))
        )}
      </div>
      {!colleEnBas && (
        <button
          type="button"
          className="chat-mosaic-window-jump"
          data-testid="chat-mosaic-jump"
          onClick={() => {
            const el = filRef.current
            if (!el) return
            el.scrollTop = el.scrollHeight
            setColleEnBas(true)
          }}
        >
          ↓ Dernier message
        </button>
      )}
      <div className="chat-mosaic-window-composer">{rendreComposer(fenetre.id)}</div>
    </section>
  )
}

/**
 * MEMO PAR FENETRE — mesure (conv-1581, `ChatMosaic.cout-stream.test.tsx`) : pendant qu'UNE fenetre
 * streame, ChatView refabrique un objet `fenetre` par case a chaque frame. Sans ce memo, les N
 * fenetres se re-rendaient entierement (fil + `ChatComposer` et ses palettes) 60 fois par seconde —
 * le gel. Le comparateur regarde le CONTENU de `fenetre` (l'objet est neuf, ses champs ne le sont
 * pas) : retirer `messages` de cette comparaison figerait la fenetre qui streame.
 */
const FenetreChat = memo(FenetreChatBrut, (avant, apres) => {
  return (
    avant.fenetre.id === apres.fenetre.id &&
    avant.fenetre.title === apres.fenetre.title &&
    avant.fenetre.busy === apres.fenetre.busy &&
    avant.fenetre.messages === apres.fenetre.messages &&
    avant.onClose === apres.onClose &&
    avant.onOuvrirSeule === apres.onOuvrirSeule &&
    avant.rendreComposer === apres.rendreComposer &&
    avant.signatureComposer === apres.signatureComposer
  )
})

export function ChatMosaic({
  fenetres,
  onClose,
  onOuvrirSeule,
  rendreComposer,
  onNouvelleConversation,
  signatureComposer
}: ChatMosaicProps): React.JSX.Element {
  if (fenetres.length === 0) {
    return (
      <div className="chat-mosaic-vide" data-testid="chat-mosaic">
        <button
          type="button"
          className="chat-mosaic-new"
          data-testid="chat-mosaic-new"
          onClick={onNouvelleConversation}
        >
          + Nouvelle conversation
        </button>
        Clique une conversation à gauche pour l&apos;ouvrir ici. Chaque ouverture ajoute une
        fenêtre.
      </div>
    )
  }
  return (
    <div
      className="chat-mosaic scroll-y"
      data-testid="chat-mosaic"
      data-count={fenetres.length}
      style={{ gridTemplateColumns: `repeat(${colonnesPour(fenetres.length)}, minmax(0, 1fr))` }}
    >
      {fenetres.map((fenetre) => (
        <FenetreChat
          key={fenetre.id}
          fenetre={fenetre}
          onClose={onClose}
          onOuvrirSeule={onOuvrirSeule}
          rendreComposer={rendreComposer}
          signatureComposer={signatureComposer}
        />
      ))}
    </div>
  )
}
