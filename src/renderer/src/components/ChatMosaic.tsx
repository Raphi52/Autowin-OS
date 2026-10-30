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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTextesChatFil } from '../textes-ecrans/chat-fil'
import { ChatMessageRow } from './ChatMessageRow'
import { lotsNonLus } from './frise-des-lots'
import { usePlanDuChef } from './lots-mesures'
import { BandeauSuperConv, OngletsSuperConv, type OngletSuperConv } from './SuperConvMosaique'
import { RemplirSaisieDuFil } from './saisie-du-fil'
import type { Msg } from './chat-view-types'
import { colonnesPour } from './chat-mosaic-grille'
import { askReponseDuFil, tourDuMessageEnCours } from './chat-message-keys'
import type { SkillInstallee } from './useSkillsInventory'
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
  /**
   * Un encart sur TOUTE la largeur, au-dessus des fenêtres : la carte de comparaison
   * d'« Essaie 3 façons » (conv-1038, 2026-10-21). Hors de la grille des fenêtres, il ne déplace
   * aucune d'elles.
   */
  entete?: React.ReactNode
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
   * REPONSE A UNE QUESTION `ask` posee DANS une fenetre (conv-50, 2026-09-01).
   *
   * Sans ce destinataire, la ligne de message etait rendue sans chemin d'envoi : le clic ne
   * pouvait RIEN faire partir. La cible est la conversation de la FENETRE, jamais l'active.
   */
  onAnswerAsk?: (prompt: string, cible: string) => void
  /**
   * Bouton de choix d'une page interactive (conv-1304, saisie-du-fil.ts) : il remplit la saisie de
   * la FENETRE ou il est clique, jamais celle d'une autre.
   */
  onRemplirSaisie?: (texte: string, cible: string) => void
  /**
   * SIGNATURE des entrees du composer qui ne transitent PAS par `fenetre` (brouillons, pieces
   * jointes, palettes). Elle change quand un composer doit se redessiner, et SEULEMENT alors :
   * c'est ce qui autorise une fenetre inchangee a ne pas se re-rendre pendant qu'une autre streame.
   */
  signatureComposer?: string
  /** Skills installees : un message `/<skill>` porte le meme bandeau qu'en chat plein. */
  skills?: readonly SkillInstallee[] | null
  /**
   * SUPER CONVS (conv-1305, /draft « implémente 5 et 6 ») : fil de lot → son chef, son rang et le
   * total (`liensDesPlans`, ChatView). Un chef ouvert ici devient UNE case à onglets, et ses lots
   * ouverts y entrent au lieu d'occuper chacun une case.
   */
  liensDeLots?: ReadonlyMap<string, LienDeLotMosaique>
  /**
   * Fil → titre de sa conv, pour les onglets d'une super conv (conv-1286) : un lot dont la fenêtre
   * n'est pas ouverte ici a aussi un onglet. Même Map tant qu'aucun titre ne change.
   */
  titresDesFils?: ReadonlyMap<string, string>
  /** Ouvre un fil de lot dans la mosaïque : clic sur l'onglet d'un lot pas encore peint. */
  onOuvrirFil?: (id: string) => void
}

export type LienDeLotMosaique = { chef: string; rang: number; total: number }

function FenetreChatBrut({
  fenetre,
  onClose,
  onOuvrirSeule,
  rendreComposer,
  onAnswerAsk,
  onRemplirSaisie,
  skills,
  onglets,
  bandeau
}: {
  fenetre: ChatMosaicWindow
  onClose: (id: string) => void
  onOuvrirSeule: (id: string) => void
  rendreComposer: (id: string) => React.ReactNode
  onAnswerAsk?: (prompt: string, cible: string) => void
  onRemplirSaisie?: (texte: string, cible: string) => void
  skills?: readonly SkillInstallee[] | null
  /** Jamais lue ici : elle n'existe que pour le comparateur du memo ci-dessous. */
  signatureComposer?: string
  /** Super conv (conv-1305) : les onglets prennent la place du titre dans l'en-tête. */
  onglets?: React.ReactNode
  /** Super conv (conv-1305) : la frise, posée entre l'en-tête et le fil. */
  bandeau?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTextesChatFil()
  const filRef = useRef<HTMLDivElement>(null)
  const idFenetre = fenetre.id
  const remplirSaisie = useCallback(
    (texte: string) => onRemplirSaisie?.(texte, idFenetre),
    [onRemplirSaisie, idFenetre]
  )
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
  /*
   * LE PASSAGE d'occupe a libre, detecte PENDANT LE RENDU.
   *
   * Il vivait dans un effet, qui appelait `setAttention` de facon synchrone
   * (`react-hooks/set-state-in-effect`) : la bordure doree apparaissait donc un rendu en retard.
   * Comparer la valeur precedente pendant le rendu est le patron prevu par React pour ce cas ; le
   * rendu en cours est relance avant tout affichage.
   *
   * La PUBLICATION vers l'accueil, elle, reste dans un effet : c'est une ecriture vers l'exterieur
   * du composant, et elle n'a rien a faire dans un rendu.
   */
  const [busyPrecedent, setBusyPrecedent] = useState(fenetre.busy)
  if (busyPrecedent !== fenetre.busy) {
    setBusyPrecedent(fenetre.busy)
    setAttention(busyPrecedent && !fenetre.busy)
  }
  /*
   * L'etat est aussi PUBLIE : l'accueil affiche la meme liste que ces bordures dorees. Sans cette
   * publication, l'information restait prisonniere de ce composant.
   *
   * On ne publie QUE sur un CHANGEMENT. Publier a chaque montage ferait retirer de la liste, au
   * simple affichage d'une tuile, une attente deposee par quelqu'un d'autre.
   */
  const attentionPubliee = useRef(attention)
  useEffect(() => {
    if (attentionPubliee.current === attention) return
    attentionPubliee.current = attention
    if (attention) marquerConversationEnAttente(fenetre.id, fenetre.title)
    else retirerConversationEnAttente(fenetre.id)
  }, [attention, fenetre.id, fenetre.title])
  const repris = (): void => {
    setAttention(false)
    retirerConversationEnAttente(fenetre.id)
  }
  const cadreRef = useRef<HTMLElement>(null)
  /**
   * Cliquer dans une fenetre pose le curseur DANS son champ de saisie : sinon chaque bascule de
   * fenetre coutait un clic de plus (demande du 2026-09-06, meme reflexe que le chat plein ecran).
   * Trois exceptions : un controle deja cliquable (bouton, lien, champ), et une SELECTION de texte
   * en cours — lui voler le focus effacerait ce que l'utilisateur vient de surligner.
   */
  const poserLeFocus = (event: React.MouseEvent<HTMLElement>): void => {
    const cible = event.target as HTMLElement | null
    if (cible?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
    if ((window.getSelection?.()?.toString() ?? '').length > 0) return
    cadreRef.current?.querySelector('textarea')?.focus()
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

  const etat = fenetre.busy ? 'occupe' : attention ? 'attention' : undefined
  /*
   * UNE FENETRE DE MOSAIQUE EST UN VRAI PANNEAU DE CHAT (conv-817, 2026-10-13 : « mes chat dans le
   * mode mosaique doivent avoir le style de chat normal avec les chanfreins et tout »). Elle porte
   * les classes du chat plein — `lisere-dessus chat`, fil en `chat-scroll`, saisie `.composer` en
   * ENFANT DIRECT — pour que CHAQUE theme lui applique ce qu'il pose sur le chat plein : panneau
   * (`.chat::after`), cadre a coins coupes (`.chat::before`), saisie detachee (`.chat > .composer`),
   * satin et lumiere de la souris. Un habillage propre a la mosaique divergeait au premier theme.
   */
  return (
    <section
      className={`lisere-dessus chat chat-mosaic-window${onglets ? ' chat-mosaic-super' : ''}`}
      data-conv-id={fenetre.id}
      data-etat={etat}
      ref={cadreRef}
      onMouseDown={repris}
      onFocusCapture={repris}
      onClick={poserLeFocus}
    >
      {/* L'ETAT DU TOUR (occupe / termine non repris) se lit sur un ANNEAU A PART : `::after` et
          `::before` sont desormais le panneau et le cadre du chat, que l'anneau dore ecrasait. */}
      {etat && <span className="chat-mosaic-window-anneau" aria-hidden="true" />}
      <header className="chat-mosaic-window-head">
        {onglets ?? (
          <span className="chat-mosaic-window-title">
            {fenetre.title || t('mosaique.sansTitre')}
          </span>
        )}
        {fenetre.busy && (
          <span className="chat-mosaic-window-busy" aria-label={t('mosaique.tourEnCours')}>
            •
          </span>
        )}
        <button
          type="button"
          className="chat-mosaic-window-open"
          data-testid="chat-mosaic-open"
          aria-label={t('mosaique.ouvrirPleinEcran', {
            titre: fenetre.title || t('mosaique.laConversation')
          })}
          title={t('mosaique.ouvrirSeule')}
          onClick={() => onOuvrirSeule(fenetre.id)}
        >
          ↗
        </button>
        <button
          type="button"
          className="chat-mosaic-window-close"
          aria-label={t('mosaique.fermer', {
            titre: fenetre.title || t('mosaique.laConversation')
          })}
          onClick={() => onClose(fenetre.id)}
        >
          ×
        </button>
      </header>
      {bandeau}
      <div
        className="chat-scroll chat-mosaic-window-thread scroll-y"
        ref={filRef}
        onScroll={surDefilement}
      >
        {fenetre.messages.length === 0 ? (
          <div className="chat-mosaic-window-empty">{t('mosaique.aucunMessage')}</div>
        ) : (
          <RemplirSaisieDuFil.Provider value={onRemplirSaisie ? remplirSaisie : null}>
            {fenetre.messages.map((message, index) => (
              <ChatMessageRow
                key={`${fenetre.id}-${index}`}
                message={message}
                conversationId={fenetre.id}
                skills={skills}
                tourEnCours={
                  message.role === 'user'
                    ? tourDuMessageEnCours([...fenetre.messages], index, fenetre.busy)
                    : undefined
                }
                askReponse={
                  message.role === 'assistant'
                    ? askReponseDuFil([...fenetre.messages], index)
                    : undefined
                }
                onAnswerAsk={onAnswerAsk ? (prompt) => onAnswerAsk(prompt, fenetre.id) : undefined}
              />
            ))}
          </RemplirSaisieDuFil.Provider>
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
          {t('mosaique.dernierMessage')}
        </button>
      )}
      {/* Pas d'enveloppe : la saisie doit etre ENFANT DIRECT de `.chat`, comme en chat plein. */}
      {rendreComposer(fenetre.id)}
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
    avant.onAnswerAsk === apres.onAnswerAsk &&
    avant.onRemplirSaisie === apres.onRemplirSaisie &&
    avant.signatureComposer === apres.signatureComposer &&
    avant.skills === apres.skills &&
    avant.onglets === apres.onglets &&
    avant.bandeau === apres.bandeau
  )
})

/** Fil d'un lot pas encore peint dans la mosaïque (son ouverture est en route). */
const FIL_EN_ROUTE: readonly Msg[] = []
const AUCUN_LOT: ReadonlyMap<string, ChatMosaicWindow> = new Map()

/**
 * UNE CASE POUR TOUTE LA SUPER CONV (conv-1305, /draft : « implémente 5 et 6 »). Le chef et ses lots
 * ouverts ne font plus qu'une fenêtre : un onglet par fil dans l'en-tête, la frise pleine (chiffres
 * et pistes) sous l'onglet du chef, la seule piste du lot sous l'onglet d'un lot, puis le fil
 * et la saisie de l'onglet ouvert — le vrai fil, la vraie saisie, ceux de `FenetreChat`.
 *
 * Les rappels et les nœuds passés à `FenetreChat` restent STABLES tant que le plan et l'onglet ne
 * changent pas : la mosaïque refabrique ses fenêtres à chaque image d'un flux, et un nœud neuf à
 * chaque image redessinerait la saisie de la case — le gel mesuré en conv-1581.
 */
function CaseSuperConv({
  chef,
  lots,
  onClose,
  onOuvrirSeule,
  rendreComposer,
  onAnswerAsk,
  onRemplirSaisie,
  signatureComposer,
  skills,
  onOuvrirFil,
  titresDesFils
}: {
  chef: ChatMosaicWindow
  /** Les fenêtres des lots de ce chef déjà ouvertes dans la mosaïque, par fil. */
  lots: ReadonlyMap<string, ChatMosaicWindow>
  onClose: (id: string) => void
  onOuvrirSeule: (id: string) => void
  rendreComposer: (id: string) => React.ReactNode
  onAnswerAsk?: (prompt: string, cible: string) => void
  onRemplirSaisie?: (texte: string, cible: string) => void
  signatureComposer?: string
  skills?: readonly SkillInstallee[] | null
  onOuvrirFil?: (id: string) => void
  titresDesFils?: ReadonlyMap<string, string>
}): React.JSX.Element {
  const plan = usePlanDuChef(chef.id)
  const [onglet, setOnglet] = useState<OngletSuperConv>('chef')
  // Un lot fini APRÈS l'ouverture de la case et pas encore regardé garde son onglet doré.
  const [ouvertLe] = useState(() => Date.now())
  const [vusLe, setVusLe] = useState<Readonly<Record<number, number>>>({})

  // Dernières valeurs lues par des rappels stables (posées après le rendu, jamais pendant).
  const derniers = useRef({ plan, lots, onglet, onClose, onOuvrirFil, chef: chef.id })
  useEffect(() => {
    derniers.current = { plan, lots, onglet, onClose, onOuvrirFil, chef: chef.id }
  })

  const lotActif =
    typeof onglet === 'number' ? plan?.lots.find((l) => l.rang === onglet) : undefined
  // Un onglet de lot sans fil (plan relu entre-temps) retombe sur le chef.
  const ongletEffectif: OngletSuperConv = lotActif?.fil ? onglet : 'chef'
  const filActif = ongletEffectif === 'chef' ? undefined : lotActif?.fil

  const choisir = useCallback((suivant: OngletSuperConv) => {
    const { plan: p, lots: ouverts, onglet: precedent, onOuvrirFil: ouvrir } = derniers.current
    const maintenant = Date.now()
    setVusLe((vus) => ({
      ...vus,
      ...(typeof precedent === 'number' ? { [precedent]: maintenant } : {}),
      ...(typeof suivant === 'number' ? { [suivant]: maintenant } : {})
    }))
    setOnglet(suivant)
    if (typeof suivant !== 'number') return
    const fil = p?.lots.find((l) => l.rang === suivant)?.fil
    if (fil && !ouverts.has(fil)) ouvrir?.(fil)
  }, [])
  /** Fermer la case ferme TOUTE la super conv : le chef et chacun de ses lots ouverts. */
  const fermerTout = useCallback(() => {
    const { chef: id, lots: ouverts, onClose: fermer } = derniers.current
    fermer(id)
    for (const fil of ouverts.keys()) fermer(fil)
  }, [])

  const onglets = useMemo(
    () =>
      plan ? (
        <OngletsSuperConv
          plan={plan}
          actif={ongletEffectif}
          nonLus={lotsNonLus(plan, vusLe, ouvertLe, ongletEffectif)}
          titres={titresDesFils}
          onChoisir={choisir}
        />
      ) : undefined,
    [plan, ongletEffectif, vusLe, ouvertLe, titresDesFils, choisir]
  )
  const bandeau = useMemo(
    () =>
      plan ? (
        <BandeauSuperConv plan={plan} onglet={ongletEffectif} gestesDuPlan onOuvrirLot={choisir} />
      ) : undefined,
    [plan, ongletEffectif, choisir]
  )

  const fenetre: ChatMosaicWindow = filActif
    ? (lots.get(filActif) ?? {
        id: filActif,
        title: lotActif?.titre ?? filActif,
        messages: FIL_EN_ROUTE,
        busy: false
      })
    : chef
  return (
    <FenetreChat
      key={fenetre.id}
      fenetre={fenetre}
      onClose={plan ? fermerTout : onClose}
      onOuvrirSeule={onOuvrirSeule}
      rendreComposer={rendreComposer}
      onAnswerAsk={onAnswerAsk}
      onRemplirSaisie={onRemplirSaisie}
      signatureComposer={signatureComposer}
      skills={skills}
      onglets={onglets}
      bandeau={bandeau}
    />
  )
}

/**
 * Pur : quelles fenêtres sont des CHEFS de super conv (leur case portera les onglets), et quelles
 * fenêtres de lots y entrent, par chef. Un lot dont le chef n'est pas ouvert garde sa propre case.
 */
function regrouperSuperConvs(
  fenetres: readonly ChatMosaicWindow[],
  liens: ReadonlyMap<string, LienDeLotMosaique> | undefined
): { chefs: Set<string>; lotsParChef: Map<string, Map<string, ChatMosaicWindow>> } {
  const chefs = new Set<string>()
  const lotsParChef = new Map<string, Map<string, ChatMosaicWindow>>()
  if (!liens || liens.size === 0) return { chefs, lotsParChef }
  const ouvertes = new Set(fenetres.map((f) => f.id))
  for (const lien of liens.values()) if (ouvertes.has(lien.chef)) chefs.add(lien.chef)
  for (const fenetre of fenetres) {
    const lien = liens.get(fenetre.id)
    if (!lien || lien.chef === fenetre.id || !chefs.has(lien.chef)) continue
    const siens = lotsParChef.get(lien.chef) ?? new Map<string, ChatMosaicWindow>()
    siens.set(fenetre.id, fenetre)
    lotsParChef.set(lien.chef, siens)
  }
  return { chefs, lotsParChef }
}

export function ChatMosaic({
  fenetres,
  entete,
  onClose,
  onOuvrirSeule,
  rendreComposer,
  onNouvelleConversation,
  onAnswerAsk,
  onRemplirSaisie,
  signatureComposer,
  skills,
  liensDeLots,
  titresDesFils,
  onOuvrirFil
}: ChatMosaicProps): React.JSX.Element {
  const { t } = useTextesChatFil()
  const { chefs, lotsParChef } = useMemo(
    () => regrouperSuperConvs(fenetres, liensDeLots),
    [fenetres, liensDeLots]
  )
  /** Les fenêtres qui entrent dans la case de leur chef n'occupent pas de case à elles. */
  const dansUneSuperConv = (id: string): boolean => {
    const chef = liensDeLots?.get(id)?.chef
    return !!chef && chef !== id && chefs.has(chef)
  }
  const visibles = fenetres.filter((fenetre) => !dansUneSuperConv(fenetre.id))
  if (fenetres.length === 0) {
    return (
      <div className="chat-mosaic-vide" data-testid="chat-mosaic">
        <button
          type="button"
          className="chat-mosaic-new"
          data-testid="chat-mosaic-new"
          onClick={onNouvelleConversation}
        >
          {t('mosaique.nouvelle')}
        </button>
        {t('mosaique.vide')}
      </div>
    )
  }
  return (
    <div
      className="chat-mosaic scroll-y"
      data-testid="chat-mosaic"
      data-count={visibles.length}
      style={{ gridTemplateColumns: `repeat(${colonnesPour(visibles.length)}, minmax(0, 1fr))` }}
    >
      {entete}
      {visibles.map((fenetre) =>
        chefs.has(fenetre.id) ? (
          <CaseSuperConv
            key={fenetre.id}
            chef={fenetre}
            lots={lotsParChef.get(fenetre.id) ?? AUCUN_LOT}
            onClose={onClose}
            onOuvrirSeule={onOuvrirSeule}
            rendreComposer={rendreComposer}
            onAnswerAsk={onAnswerAsk}
            onRemplirSaisie={onRemplirSaisie}
            signatureComposer={signatureComposer}
            skills={skills}
            onOuvrirFil={onOuvrirFil}
            titresDesFils={titresDesFils}
          />
        ) : (
          <FenetreChat
            key={fenetre.id}
            fenetre={fenetre}
            onClose={onClose}
            onOuvrirSeule={onOuvrirSeule}
            rendreComposer={rendreComposer}
            onAnswerAsk={onAnswerAsk}
            onRemplirSaisie={onRemplirSaisie}
            signatureComposer={signatureComposer}
            skills={skills}
          />
        )
      )}
    </div>
  )
}
