import { useEffect } from 'react'
import {
  createLiveRunDeltaBatcher,
  reduceAssistantPilotEvent,
  porteLActionOuverte
} from './chat-view-model'
import type { PilotEvent, AsstMsg, Msg } from './chat-view-types'
import {
  hydraterFilStocke,
  type MessageStocke,
  memoriserContextes,
  memoriserJauges
} from './chat-view-outils'
import { adopterLeTourPersiste, completerAvecHistorique } from './fil-affichable'
import { type ContexteStatique } from '../../../shared/contexte-detaille'
import { occupationDeFenetre } from '../../../shared/occupation-fenetre'
import { contextGauge, doitCompacterAutomatiquement } from '../../../shared/context-gauge'

// Extrait de ChatView.tsx tel quel, sans changement de comportement (conv-1508).
export type FluxDuPiloteCtx = {
  busyConversationsRef: React.RefObject<Set<string>>
  compactionAutoRef: React.RefObject<Set<string>>
  compactionEnAttenteRef: React.RefObject<Set<string>>
  dernierMessageUtilisateurDe: (conversationId: string) => string | undefined
  lancerCompactionAuto: (conversationId: string) => void
  liveMessagesRef: React.RefObject<Map<string, import('./chat-view-types').Msg[]>>
  patchLast: (
    conversationId: string,
    fn: (m: import('./chat-view-model').HydratedAssistantMessage) => void,
    porte?: ((m: import('./chat-view-model').HydratedAssistantMessage) => boolean) | undefined
  ) => void
  pilotFlushRef: React.RefObject<() => void>
  publierFil: (conversationId: string | null, fil: import('./chat-view-types').Msg[]) => void
  rebaseDirectiveReceiptsAfterStreamReset: (
    conversationId: string,
    reset: { streamId: string; conclusionSeule?: true | undefined }
  ) => void
  setContextesStatiques: React.Dispatch<
    React.SetStateAction<
      Record<string, import('../../../shared/contexte-detaille').ContexteStatique>
    >
  >
  setContextGauges: React.Dispatch<
    React.SetStateAction<Record<string, import('../../../shared/context-gauge').ContextGauge>>
  >
  setConversationBusy: (id: string, value: boolean) => void
}

export function useFluxDuPilote(ctx: FluxDuPiloteCtx): void {
  const {
    busyConversationsRef,
    compactionAutoRef,
    compactionEnAttenteRef,
    dernierMessageUtilisateurDe,
    lancerCompactionAuto,
    liveMessagesRef,
    patchLast,
    pilotFlushRef,
    publierFil,
    rebaseDirectiveReceiptsAfterStreamReset,
    setContextesStatiques,
    setContextGauges,
    setConversationBusy
  } = ctx
  useEffect(() => {
    /*
     * UN RE-RENDU PAR FRAME, PAS PAR TOKEN.
     *
     * Chaque delta pilote arrive dans sa propre tâche IPC et appelait `patchLast` → `setMessages` :
     * 300 tokens = 300 recopies du fil et 300 rendus, chacun en O(taille du message). Le batcher
     * existait déjà (branché sur `orchestrate-delta`) ; le chemin le PLUS fréquent — le streaming du
     * chat — ne l'utilisait pas.
     *
     * Ce qui est batché : seulement le TEXTE qui s'accumule (`delta`, `reasoning`, `think`). Tout le
     * reste — `command`, `result`, `stream-reset`, `done`, `error`, `cancellation` — vide le tampon
     * puis s'applique IMMÉDIATEMENT : une clôture ne doit jamais dormir une frame, et l'ordre des
     * événements dans le réducteur est préservé par ce flush.
     */
    const pilotBatcher = createLiveRunDeltaBatcher<{
      conversationId: string
      event: PilotEvent
    }>(
      (batch) => {
        const parConversation = new Map<string, PilotEvent[]>()
        for (const item of batch) {
          const liste = parConversation.get(item.conversationId) ?? []
          liste.push(item.event)
          parConversation.set(item.conversationId, liste)
        }
        for (const [conversationId, events] of parConversation)
          patchLast(conversationId, (message) => {
            let etat = message as AsstMsg
            for (const event of events) etat = reduceAssistantPilotEvent(etat, event) as AsstMsg
            Object.assign(message, etat)
          })
      },
      (flush) => window.requestAnimationFrame(flush),
      (handle) => window.cancelAnimationFrame(handle)
    )
    // Rend le vidage du tampon atteignable HORS de cet effet (voir `pilotFlushRef`).
    pilotFlushRef.current = () => pilotBatcher.flush()
    // Rend le vidage du tampon atteignable HORS de cet effet (voir `pilotFlushRef`).
    pilotFlushRef.current = () => pilotBatcher.flush()
    const off = window.api.onPilotEvent((raw) => {
      const e = raw as PilotEvent
      const conversationId = e.conversationId
      if (!conversationId) return
      // TOUR INITIÉ CÔTÉ MAIN (scout de veille, tâche planifiée) : la vue ne l'a pas lancé, donc il
      // n'est pas dans `busyConversationsRef` — et ses événements étaient JETÉS : la conversation
      // s'ouvrait sur un panneau vide pendant que l'agent travaillait (mesuré le 14/08,
      // conv-1164→1166). Le premier événement pilote PROUVE qu'un tour tourne : on marque la
      // conversation occupée et on amorce un fil live pour que les patchs aient une cible.
      if (!busyConversationsRef.current.has(conversationId)) {
        if (e.kind === 'done' || e.kind === 'error') return
        setConversationBusy(conversationId, true)
        // Le cache live fait AUTORITÉ à la réouverture (`loadConv` le préfère au store). S'il est
        // ABSENT ici, l'amorce ci-dessous en ferait un fil réduit au seul tour en cours : la
        // conversation rouvrait TRONQUÉE de tout son historique (conv-1376). D'où l'amorce du cache
        // depuis le store, faite AVANT d'y écrire l'amorce du tour.
        const cacheAbsent = !liveMessagesRef.current.has(conversationId)
        const fil = liveMessagesRef.current.get(conversationId) ?? []
        if (!fil.some((message) => message.role === 'assistant' && !message.done)) {
          const amorce = [
            ...fil,
            { role: 'assistant', content: '', parts: [], status: 'streaming' } as unknown as Msg
          ]
          liveMessagesRef.current.set(conversationId, amorce)
          publierFil(conversationId, amorce)
        }
        // L'HISTORIQUE — dont le MESSAGE ENVOYÉ du tour — vit dans le store, pas dans les événements :
        // sans ce rattrapage, le fil montrait la réponse sans la demande (« j'ai pas vu le message
        // envoyé », 14/08), et le cache tronquait la conversation à la réouverture (conv-1376).
        // On met le fil persisté en tête du fil adopté, sans écraser les patchs déjà arrivés.
        if (cacheAbsent) {
          void window.api
            .conversation(conversationId)
            .then((conversation) => {
              const duStore = hydraterFilStocke(
                (conversation as { messages?: MessageStocke[] })?.messages ?? []
              )
              const historique = duStore.filter(
                // Un tour en vol peut être persisté NON CLOS : il ferait doublon avec l'amorce.
                (message) => message.role !== 'assistant' || (message as AsstMsg).done === true
              )
              const avant = liveMessagesRef.current.get(conversationId) ?? []
              // ... mais ce tour persisté porte ce que l'amorce n'a pas (réponse écrite, action
              // `orchestrate` que visent les battements) : il DEVIENT l'amorce (conv-1146).
              const courant = adopterLeTourPersiste(duStore, avant)
              // Decide sur l'IDENTITE, pas sur « il y a un message utilisateur » : cette heuristique
              // abandonnait l'historique des qu'un message etait tape pendant la lecture du store, et
              // le fil restait tronque a son dernier tour (conv-152, saisie ts=1788413114634).
              const complet = completerAvecHistorique(historique, courant)
              if (complet === avant) return
              liveMessagesRef.current.set(conversationId, complet)
              publierFil(conversationId, complet)
            })
            .catch(() => {})
        }
      }
      if (e.kind === 'done' || e.kind === 'error') setConversationBusy(conversationId, false)
      if (e.kind === 'done' && e.usage) {
        /*
        OCCUPATION = ENTREE DU DERNIER APPEL, pas le cumul du tour.

        `usage.inputTokens` somme toutes les iterations : juste pour la depense, faux pour la
        fenetre, car le prefixe est renvoye a chaque appel. Un tour de neuf appels rendait
        578 207 tokens pour une fenetre de 200 000 et la jauge restait collee a 100 %
        (mesure du 2026-09-04, journal d'activite de conv-240). `derniereEntree` porte donc ce que
        le DERNIER appel a recu.

        AUCUN REPLI SUR LE CUMUL ICI. Cette vue repliait sur `inputTokens` quand le fournisseur
        n'avait pas desagrege : elle reintroduisait donc la jauge fausse que le moteur
        (`main/chat/run-pilot-chat.ts`) refuse deja d'ecrire pour cette raison exacte — un cumul
        est un MAJORANT, pas une occupation (2 413 317 tokens observes pour une fenetre de 1 M).
        On passe par `occupationDeFenetre`, le seul endroit qui tranche, et on n'affiche RIEN
        quand il annonce un repli : `context-gauge.ts` tient deja la meme regle, « une jauge
        fausse est pire qu'une jauge absente — elle est crue ».
        */
        const usage = e.usage as typeof e.usage & {
          derniereEntree?: number
          derniereEntreeCache?: number
          model?: string
          provider?: string
          /** Partie fixe du contexte mesuree par le CLI pendant le tour (agent-pilot, conv-1000). */
          contexte?: ContexteStatique
        }
        const contexteMesure = usage.contexte
        if (contexteMesure)
          setContextesStatiques((current) => {
            const suivant = { ...current, [conversationId]: contexteMesure }
            memoriserContextes(suivant)
            return suivant
          })
        const occupation = occupationDeFenetre({
          inputTokens: usage.inputTokens ?? 0,
          derniereEntree: usage.derniereEntree,
          derniereEntreeCache: usage.derniereEntreeCache
        })
        const jauge = occupation.replicumul
          ? undefined
          : contextGauge({
              inputTokens: occupation.entree,
              outputTokens: usage.outputTokens,
              cacheReadTokens: occupation.cache,
              model: usage.model,
              provider: usage.provider
            })
        if (jauge)
          setContextGauges((current) => {
            const suivant = { ...current, [conversationId]: jauge }
            memoriserJauges(suivant)
            return suivant
          })
        /*
        COMPACTION AUTOMATIQUE AU PALIER CRITIQUE.

        Le bouton existait, le palier aussi, et rien ne les reliait : c'est au moment ou la place
        manque que l'utilisateur est le moins disponible pour cliquer. On envoie donc un TOUR
        NORMAL — visible dans le fil, journalise comme tout autre message, jamais un elagage
        silencieux : l'agent produit le resume, et c'est ce resume qui porte la suite.

        UNE SEULE FOIS PAR FRANCHISSEMENT. `compactionAutoRef` retient les fils deja compactes et
        les oublie des que la jauge redescend : sans lui, un fil qui reste critique redemanderait
        un resume a chaque tour, en boucle et aux frais de l'utilisateur.
        */
        if (doitCompacterAutomatiquement(jauge, dernierMessageUtilisateurDe(conversationId))) {
          if (!compactionAutoRef.current.has(conversationId)) {
            compactionAutoRef.current.add(conversationId)
            // Ce `done` arrive AVANT la réponse de `pilotChat` : le verrou d'envoi tient encore, la
            // compaction l'attend au lieu d'être refusée sans un mot (conv-1080).
            lancerCompactionAuto(conversationId)
          }
        } else if (jauge && jauge.level !== 'critique') {
          compactionAutoRef.current.delete(conversationId)
          compactionEnAttenteRef.current.delete(conversationId)
        }
      }
      if (e.kind === 'stream-reset' && e.streamId)
        rebaseDirectiveReceiptsAfterStreamReset(conversationId, {
          streamId: e.streamId,
          ...(e.conclusionSeule ? { conclusionSeule: true as const } : {})
        })
      if (e.kind === 'delta' || e.kind === 'reasoning' || e.kind === 'think') {
        pilotBatcher.enqueue({ conversationId, event: e })
        return
      }
      pilotBatcher.flush()
      // Battement et verdict VISENT une action deja posee : ils rejoignent la bulle qui la porte,
      // meme au-dessus d'une orientation (conv-955). Le reste s'ecrit en fin de fil, comme avant.
      patchLast(
        conversationId,
        (message) => Object.assign(message, reduceAssistantPilotEvent(message, e)),
        (e.kind === 'action-progress' || e.kind === 'result') && e.actionId
          ? porteLActionOuverte(e.actionId, e.turnId)
          : undefined
      )
    })
    return () => {
      // `cancel` et non `flush` : poser un état sur une vue démontée n'aide personne, et le fil
      // persisté par le main reste la source de vérité à la réouverture.
      pilotBatcher.cancel()
      off()
    }
  }, [])
}
