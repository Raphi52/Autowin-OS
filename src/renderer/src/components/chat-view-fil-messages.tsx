import {
  doitIgnorerDefilementDeBascule,
  isChatNearBottom,
  doitSuivreLeBas,
  type ScopedLiveRun,
  type OrchStep
} from './chat-view-model'
import { memoriserPositionLecture } from './position-lecture'
import { mesurerMessagesRendus } from './chat-mesure-messages'
import { texteFil } from './chat-view-outils'
import { AnimationAccueilChat } from './AnimationAccueilChat'
import { presenceDepuisRunsVivants } from './run-presence'
import { DirectiveReceiptRow } from './ChatMessageRow'
import { VueMesuree } from './VueMesuree'
import { PointerMomentVideo, type MomentPointe } from './video-pointage-context'
import { RunsEnDirect } from './runs-en-direct'
import { RemplirSaisieDuFil } from './saisie-du-fil'
import type { Conv, DirectiveReceipt, Msg } from './chat-view-types'
import type { UsageDeSkill } from './chat-home-suggestions'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
/** Le fil des messages défilant, avec l’accueil quand le fil est vide et les reçus des consignes. */
export function FilDesMessages({
  activeDirectiveReceipts,
  activeId,
  activeRef,
  annulerEnvoi,
  basculeConvRef,
  brouillonPresent,
  busy,
  busyConversations,
  convLoad,
  dernierScrollTopRef,
  descenteEnVolRef,
  filRendu,
  followTailRef,
  gesteLecteurRef,
  isActive,
  liveRuns,
  loadConv,
  messages,
  phrasesAccueil,
  pointerMomentVideo,
  remplirSaisie,
  repriseEnCours,
  scrollRef,
  setHasNewActivity,
  setScrolledAwayFromTail,
  surRelachementDansLeFil,
  usagesAccueil
}: {
  activeDirectiveReceipts: DirectiveReceipt[]
  activeId: string | null
  activeRef: React.RefObject<string | null>
  annulerEnvoi: (receipt: DirectiveReceipt) => void
  basculeConvRef: React.RefObject<boolean>
  brouillonPresent: boolean
  busy: boolean
  busyConversations: Set<string>
  convLoad: {
    status: 'idle' | 'loading' | 'error'
    target?: Conv | undefined
    error?: string | undefined
  }
  dernierScrollTopRef: React.RefObject<number>
  descenteEnVolRef: React.RefObject<boolean>
  filRendu: React.JSX.Element[]
  followTailRef: React.RefObject<boolean>
  gesteLecteurRef: React.RefObject<boolean>
  isActive: boolean
  liveRuns: Record<string, ScopedLiveRun<OrchStep>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  messages: Msg[]
  phrasesAccueil: string[]
  pointerMomentVideo: (moment: MomentPointe) => void
  remplirSaisie: (texte: string) => void
  repriseEnCours: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setScrolledAwayFromTail: React.Dispatch<React.SetStateAction<boolean>>
  surRelachementDansLeFil: () => void
  usagesAccueil: UsageDeSkill[]
}): React.JSX.Element {
  return (
    <div
      className={`chat-scroll scroll-y chat-scroll--ascenseur${repriseEnCours ? ' chat-scroll--reprise' : ''}`}
      ref={scrollRef}
      onMouseUp={surRelachementDansLeFil}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      // LES GESTES QUI COMPTENT : molette, doigt, clavier, prise de la barre de defilement.
      onWheel={() => {
        gesteLecteurRef.current = true
      }}
      onTouchStart={() => {
        gesteLecteurRef.current = true
      }}
      onPointerDown={() => {
        gesteLecteurRef.current = true
      }}
      onKeyDown={() => {
        gesteLecteurRef.current = true
      }}
      onScroll={(event) => {
        const conteneur = event.currentTarget
        // Defilement FANTOME de la bascule : mesure sur l'ancienne position, aucune intention
        // de lecture. Le lire allumait « ↓ Dernier message » une frame — le clignotement.
        if (
          doitIgnorerDefilementDeBascule({
            basculeEnCours: basculeConvRef.current,
            gesteLecteur: gesteLecteurRef.current
          })
        ) {
          dernierScrollTopRef.current = conteneur.scrollTop
          return
        }
        const nearBottom = isChatNearBottom(conteneur)
        // La position de lecture se retient a chaque mouvement DU LECTEUR : quitter une
        // conversation ne passe pas toujours par un evenement de fermeture (changement de
        // conversation, fermeture brutale de l'app). Un defilement provoque par l'APP, lui,
        // n'ecrit rien : c'est ce qui rouvrait le fil au milieu.
        if (activeRef.current && gesteLecteurRef.current)
          memoriserPositionLecture(activeRef.current, conteneur, mesurerMessagesRendus(conteneur))
        // Pendant une descente automatique (envoi d'un message, streaming, fin de tour), les
        // evenements `scroll` viennent de NOUS : les prendre pour un geste de lecture coupait le
        // suivi et laissait le fil arrete au milieu du tour. Seul un recul rend la main.
        /*
         * UN DEFILEMENT QUE PERSONNE N'A PROVOQUE NE COUPE PAS LE SUIVI.
         *
         * Defaut vecu le 2026-09-06 : « quand je prompt ca met pas la vue sur le dernier
         * message ». Entre l'envoi et la frame de descente, l'app bouge le fil elle-meme (le
         * champ de saisie se vide et rend sa hauteur). Cet evenement arrivait ici avec le fil
         * encore en haut, `nearBottom` repondait faux, le suivi tombait, et la descente
         * s'annulait a la frame suivante — personne ne descendait.
         *
         * Le discriminant existe deja : `gesteLecteurRef` n'est vrai que si la molette, un
         * doigt, le clavier ou le pointeur ont touche le fil. Un `scroll` sans geste vient
         * donc de NOUS, exactement comme pendant une descente en vol, et se juge sur le SIGNE
         * du deplacement au lieu de la seule distance au bas.
         */
        const suit =
          descenteEnVolRef.current || !gesteLecteurRef.current
            ? doitSuivreLeBas({
                suivaitLeBas: followTailRef.current,
                precedentTop: dernierScrollTopRef.current,
                top: conteneur.scrollTop,
                nearBottom
              })
            : nearBottom
        dernierScrollTopRef.current = conteneur.scrollTop
        followTailRef.current = suit
        setScrolledAwayFromTail(!suit)
        if (suit) setHasNewActivity(false)
      }}
    >
      {/* Chargement du fil : squelette pendant l'attente, bandeau ACTIONNABLE en cas d'échec.
              Un fil vide muet ne disait pas la différence entre « rien à afficher » et « la
              lecture a planté ». */}
      {convLoad.status === 'loading' && (
        <div className="conv-load-skeleton" role="status" aria-label={texteFil('fil.chargement')}>
          <span className="conv-load-skeleton-line" />
          <span className="conv-load-skeleton-line" />
          <span className="conv-load-skeleton-line" />
        </div>
      )}
      {convLoad.status === 'error' && (
        <div className="conv-load-error" role="alert">
          <span className="conv-load-error-text">
            {texteFil('fil.illisible', { erreur: convLoad.error ?? '' })}
          </span>
          {convLoad.target && (
            <button
              type="button"
              className="conv-load-retry"
              onClick={() => void loadConv(convLoad.target as Conv)}
            >
              {texteFil('fil.reessayer')}
            </button>
          )}
        </div>
      )}

      {/* Sans cadre autour : le panneau de l'ancien bloc restait gris sur les thèmes clairs.
                La phrase REMPLIT la saisie, elle ne l'envoie pas (« 3+5 »). */}
      {convLoad.status === 'idle' && messages.length === 0 && (!busy || activeId === null) && (
        <AnimationAccueilChat
          libelle={texteFil('accueil.titre')}
          detail={texteFil('accueil.detail')}
          phrases={phrasesAccueil}
          usages={usagesAccueil}
          agentsAuTravail={busyConversations.size + presenceDepuisRunsVivants(liveRuns).runsActifs}
          saisieRemplie={brouillonPresent}
          actif={isActive}
          onChoisir={remplirSaisie}
        />
      )}

      {activeDirectiveReceipts
        .filter((receipt) => receipt.afterMessageIndex < 0)
        .map((receipt) => (
          <DirectiveReceiptRow
            key={`directive-receipt-${receipt.id}`}
            receipt={receipt}
            onAnnuler={annulerEnvoi}
          />
        ))}

      <VueMesuree id="chat-fil" bloc cle={activeId}>
        <PointerMomentVideo.Provider value={pointerMomentVideo}>
          {/* Les runs en cours, pour le bloc des juges qui se remplit en direct. */}
          <RunsEnDirect.Provider value={liveRuns}>
            {/* Boutons de choix des pages interactives : ils remplissent CETTE saisie. */}
            <RemplirSaisieDuFil.Provider value={remplirSaisie}>
              {filRendu}
            </RemplirSaisieDuFil.Provider>
          </RunsEnDirect.Provider>
        </PointerMomentVideo.Provider>
      </VueMesuree>
    </div>
  )
}
