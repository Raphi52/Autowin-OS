import { memoriserDerniereConversation, derniereConversationOuverte } from './derniere-conversation'
import {
  texteFil,
  hydraterFilStocke,
  traceSilentFailure,
  type MessageStocke
} from './chat-view-outils'
import { positionLectureMemorisee, type PositionLecture } from './position-lecture'
import { filAffichable } from './fil-affichable'
import { pickTurnToResume, rejeuDejaEnregistre, type UnfinishedTurn } from './resume-unfinished'
import { brouillonEnAttente } from './brouillons-persistes'
import { conversationsRecentes } from './conversation-search'
import {
  hydrateStoredAssistant,
  indexDeLaBulleQuiPorte,
  settleIfDone,
  type HydratedAssistantMessage
} from './chat-view-model'
import { promptDeRelanceGratuite } from './auto-relance'
import { reutiliserConversationsInchangees } from './conversations-stables'
import type { Conv, Msg, AsstMsg, SendOptions } from './chat-view-types'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que le chargement, le rejeu et la mise à jour du fil affiché lisent de ChatView. */
export type FilCtx = {
  activeRef: React.RefObject<string | null>
  autoResumeOnce: (loaded: Conv[]) => Promise<void>
  basculeConvRef: React.RefObject<boolean>
  busyConversationsRef: React.RefObject<Set<string>>
  convsRef: React.RefObject<Conv[]>
  followTailRef: React.RefObject<boolean>
  gesteLecteurRef: React.RefObject<boolean>
  liveMessagesRef: React.RefObject<Map<string, Msg[]>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  loadConversationRequestRef: React.RefObject<number>
  marquerConversationVue: (id: string, updatedAt?: number | undefined) => void
  mosaicIdsRef: React.RefObject<string[]>
  patchLast: (
    conversationId: string,
    fn: (m: HydratedAssistantMessage) => void,
    porte?: ((m: HydratedAssistantMessage) => boolean) | undefined
  ) => void
  positionARestaurerRef: React.RefObject<PositionLecture | null>
  publierFil: (conversationId: string | null, fil: Msg[]) => void
  reconcilierTourNonClos: (id: string) => Promise<void>
  replayedTurnsRef: React.RefObject<Set<string>>
  replayTurnJournal: (conversationId: string, turnId: string) => Promise<void>
  repriseDemarrageRef: React.RefObject<Promise<void> | null>
  resetConvLoad: () => void
  sendRef: React.RefObject<
    (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  >
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setConversationBusy: (id: string, value: boolean) => void
  setConvLoad: React.Dispatch<
    React.SetStateAction<{
      status: 'idle' | 'loading' | 'error'
      target?: Conv | undefined
      error?: string | undefined
    }>
  >
  setConvs: React.Dispatch<React.SetStateAction<Conv[]>>
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setListeTelOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  setMosaicFils: React.Dispatch<React.SetStateAction<Record<string, Msg[]>>>
  setScrolledAwayFromTail: React.Dispatch<React.SetStateAction<boolean>>
  switchComposerDraft: (key: string) => void
}

/**
 * `filDeRepli` : le fil AFFICHÉ juste avant un rechargement qui a invalidé le cache live. Un store
 * qui répond un fil VIDE (tour en vol pas encore persisté, écriture en cours) ne fait PAS foi : sans
 * ce repli, la conversation « arrêtait de s'afficher » et l'écran retombait sur l'accueil « Parle à
 * l'agent » avec ses chips de runs, alors que les messages étaient bien là (constaté le 27/08).
 */
export async function loadConv(ctx: FilCtx, c: Conv, filDeRepli?: readonly Msg[]): Promise<void> {
  const {
    activeRef,
    basculeConvRef,
    followTailRef,
    gesteLecteurRef,
    liveMessagesRef,
    loadConversationRequestRef,
    marquerConversationVue,
    positionARestaurerRef,
    reconcilierTourNonClos,
    resetConvLoad,
    setActiveId,
    setConvLoad,
    setHasNewActivity,
    setListeTelOuverte,
    setMessages,
    setScrolledAwayFromTail,
    switchComposerDraft
  } = ctx
  // Retenu ICI : `loadConv` est le point de passage unique de toute ouverture (clic, reprise,
  // inbox d'agents), donc le seul endroit ou la memoire ne peut pas se desynchroniser.
  memoriserDerniereConversation(c.id)
  marquerConversationVue(c.id, c.updatedAt)
  const requestId = ++loadConversationRequestRef.current
  // Le numéro de requête arbitre AUSSI l'affichage : une réponse (ou un échec) PÉRIMÉ ne
  // repeint plus rien — c'est la dernière sélection de l'utilisateur qui fait foi.
  const perime = (): boolean => requestId !== loadConversationRequestRef.current
  let detailed: Conv | null
  if (c.messages) detailed = c
  else {
    setConvLoad({ status: 'loading', target: c })
    try {
      detailed = (await window.api.conversation(c.id)) as Conv | null
    } catch (error) {
      if (perime()) return
      setConvLoad({
        status: 'error',
        target: c,
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }
  }
  if (perime()) return
  if (!detailed) {
    setConvLoad({ status: 'error', target: c, error: texteFil('fil.introuvableStore') })
    return
  }
  resetConvLoad()
  const reprise = positionLectureMemorisee(c.id)
  positionARestaurerRef.current = reprise ?? null
  followTailRef.current = !reprise
  setHasNewActivity(false)
  // Le « fil remonte » appartient a LA conversation qu'on quitte. Sans cette remise a l'etat de la
  // conversation OUVERTE, le bouton « ↓ Dernier message » restait peint pendant le rendu du
  // nouveau fil et ne partait qu'a la frame de descente : un CLIGNOTEMENT a chaque bascule
  // (rapporte le 2026-09-01). Une reprise, elle, s'ouvre bien remontee : le bouton y est du.
  setScrolledAwayFromTail(!!reprise)
  // Le fil va etre REMPLACE : les `scroll` qui suivent viennent du navigateur, pas du lecteur.
  basculeConvRef.current = true
  gesteLecteurRef.current = false
  activeRef.current = c.id
  setActiveId(c.id)
  setListeTelOuverte(false)
  const branchMessages = detailed.messages ?? []
  const duStore = hydraterFilStocke(branchMessages)
  // Un rechargement ne RÉTRÉCIT pas le fil à zéro : le vide du store est une absence d'information,
  // pas une conversation vidée.
  const relu =
    duStore.length === 0 && filDeRepli && filDeRepli.length > 0 ? [...filDeRepli] : duStore
  /*
   * UN CACHE VIDE EST UNE ABSENCE, PAS UN FIL.
   *
   * Vecu le 2026-09-01 : « les messages de conv-82 ont disparu » — la conversation
   * existait, la barre laterale comptait ses 5 messages, le disque les rendait tous, l'ecran
   * n'affichait RIEN. Une conversation ouverte alors qu'elle etait encore VIDE (elle vient d'etre
   * creee) laisse un tableau vide dans le cache d'affichage ; l'agent la remplit ensuite cote
   * processus principal, sans passer par ce cache. A la reouverture, `?? relu` ne se declenchait
   * pas — un tableau vide n'est pas `undefined` — et ce vide gagnait sur un store PLEIN.
   *
   * Meme regle que juste au-dessus pour le store : le fil ne RETRECIT pas a zero.
   */
  /*
   * ... ET UN CACHE PLUS COURT QUE LE STORE N'EST PAS LE FIL.
   *
   * Vecu (saisie ts=1788413114634 : « la moitié de cette convers s'est effacé j'arrive
   * pas a remonter le fil », tour 57656364-053f-40e6-bc8e-91efd5b74e39). Le disque portait les 41
   * messages, l'ecran la seule fin. Un tour lance cote main amorce ce cache avec le SEUL message
   * en cours ; `cache.length > 0` le faisait alors gagner sur un store PLEIN. `filAffichable`
   * repose la tete du store et garde la queue vivante : le fil ne RETRECIT plus.
   */
  const cacheAffiche = liveMessagesRef.current.get(c.id)
  const stored = filAffichable(cacheAffiche, relu)
  liveMessagesRef.current.set(c.id, stored)
  setMessages(stored)
  switchComposerDraft(c.id)
  void reconcilierTourNonClos(c.id)
}

/**
 * Un tour relu comme NON CLOS est-il vraiment en vol ? Le main seul le sait.
 *
 * Un message persiste en `streaming` — l'app tuee en plein tour — se relisait comme un tour vivant :
 * ses actions restaient sans issue, donc l'indicateur « N action en cours » collait alors que le
 * panneau Sous-agents etait vide. On INTERROGE donc l'autorite, au lieu de supposer dans un sens ou
 * dans l'autre : un tour reellement en vol est ADOPTE (fil occupe), un tour mort est clos.
 *
 * Best-effort : si la sonde echoue, on ne change rien — mieux vaut un indicateur trop prudent qu'un
 * tour vivant declare mort.
 */
export async function reconcilierTourNonClos(ctx: FilCtx, id: string): Promise<void> {
  const { activeRef, busyConversationsRef, liveMessagesRef, patchLast, setConversationBusy } = ctx
  const messages = liveMessagesRef.current.get(id) ?? []
  const dernier = [...messages].reverse().find((message) => message.role === 'assistant')
  /*
   * N'IMPORTE QUELLE bulle non close justifie la sonde, pas seulement la DERNIÈRE (
   * 2026-10-13). Au redémarrage, le main rattache une orchestration encore vivante et AJOUTE en bas
   * du fil un récapitulatif « Reprise du fil… » sans statut, donc relu comme terminé
   * (`index.ts`, `recapMessage`). La bulle du tour vivant n'était plus la dernière : l'écran ne
   * sondait pas, croyait le fil libre, et la saisie partait en message normal, refusé par le main.
   */
  const unTourNonClos = messages.some(
    (message) => message.role === 'assistant' && !(message as AsstMsg).done
  )
  if (!unTourNonClos) return
  let actif: boolean | undefined
  try {
    actif = (await window.api.pilotChatActive?.(id))?.active
  } catch {
    return
  }
  if (actif === undefined) return
  if (activeRef.current !== id && !liveMessagesRef.current.has(id)) return
  if (actif) {
    /*
     * UN TOUR VIVANT QUE L'ÉCRAN N'A PAS LANCÉ : il l'ADOPTE (2026-10-11).
     * Cas réel : le main redémarre pendant un tour, le CLI survit et le main le REPREND, mais sans
     * émettre le moindre événement pilote pendant l'attente. L'écran ne passait un fil en
     * « occupé » que sur un tel événement : il croyait le fil libre, et le message suivant lançait
     * un second agent sur la même session. Adopté, le fil montre Stop, la saisie part en
     * orientation, et la veille des tours (`TOUR_VIVANT_SONDE_MS`) le relâche à sa vraie fin.
     */
    if (!busyConversationsRef.current.has(id)) setConversationBusy(id, true)
    return
  }
  // Tour mort : on ne clôt que la DERNIÈRE bulle, comme avant. Une bulle plus haute restée
  // « en cours » n'est pas réécrite ici : rien ne dit qu'elle appartienne au tour sondé.
  if (!dernier || (dernier as AsstMsg).done) return
  setConversationBusy(id, false)
  patchLast(id, (message) => {
    message.done = true
    if (message.status === 'streaming') message.status = 'interrupted'
  })
}

export async function autoResumeOnce(ctx: FilCtx, loaded: Conv[]): Promise<void> {
  const { loadConv, replayTurnJournal, sendRef } = ctx
  let turns: UnfinishedTurn[] = []
  try {
    turns = ((await window.api.unfinishedTurns?.()) ?? []) as UnfinishedTurn[]
  } catch (error) {
    traceSilentFailure('unfinished-turns', error)
    return
  }
  // L'horloge ECARTE les vestiges : un tour interrompu la veille ne doit plus voler le demarrage
  // a la conversation ou l'utilisateur travaille (2026-08-18).
  const target = pickTurnToResume(turns, Date.now())
  /**
   * UN MESSAGE A MOITIE ECRIT GAGNE SUR LA REPRISE. Symptome du 2026-09-01 : « de temps en temps
   * ca m'enleve de la conversation dans laquelle je suis en train d'ecrire ». Un rechargement de
   * fenetre relance cette reprise, qui ouvrait la conversation d'un tour interrompu AILLEURS et
   * plantait l'utilisateur devant un fil qui n'etait pas le sien.
   *
   * Rien n'est perdu de l'autre cote : le journal du tour interrompu est rejoue quand meme, son
   * fil est donc a jour des qu'on l'ouvre — seule la SELECTION reste a l'utilisateur.
   */
  const ouJEcrivais = derniereConversationOuverte(loaded)
  if (target) {
    const conversation = loaded.find((candidate) => candidate.id === target.conversationId)
    if (conversation) {
      if (brouillonEnAttente(ouJEcrivais) && ouJEcrivais !== target.conversationId) {
        await replayTurnJournal(target.conversationId, target.turnId)
        const restons = loaded.find((candidate) => candidate.id === ouJEcrivais)
        if (restons) {
          await loadConv(restons)
          return
        }
      }
      await loadConv(conversation)
      await replayTurnJournal(target.conversationId, target.turnId)
      return
    }
  }
  // Pas de tour a reprendre : on rouvre la ou l'utilisateur etait (demande du 2026-08-18). La
  // reprise d'un tour inacheve reste PRIORITAIRE — elle repare quelque chose, celle-ci ne fait
  // que replacer le curseur. Aucune selection inventee si la memoire est vide ou perimee.
  const derniere = ouJEcrivais
  if (derniere) {
    const conversation = loaded.find((candidate) => candidate.id === derniere)
    if (conversation) await loadConv(conversation)
  } else {
    // MEMOIRE VIDE (premier lancement, stockage efface, conversation supprimee depuis) : on ouvre
    // LA PLUS RECENTE au sens de la RECENCE UTILISATEUR — la ou l'utilisateur a parle en dernier,
    // jamais la derniere TOUCHEE (`updatedAt` bouge sur un rangement, un RUN.md attache, un delta
    // de streaming). Avant, ce cas n'ouvrait RIEN et laissait le panneau vide.
    const plusRecente = conversationsRecentes(loaded, 1)[0]
    if (plusRecente) await loadConv(plusRecente)
  }
  // Survie niveau 3 — RELANCE GRATUITE (demande user 2026-08-13 : « faire en sorte que ça tue
  // pas les runs »). `pickTurnToResume` exige `events > 0` : un tour mort AVANT d'avoir rien
  // produit (0 événement, 0 texte, 0 action réglée — donc 0 dépense) passait au travers et
  // restait abandonné jusqu'à un clic humain sur « Renvoyer ». Mesuré trois fois sur les
  // campagnes des 12-13/08. Ce chemin tourne UNE fois au boot, avant toute activité vivante —
  // pas dans la boucle de rendu, où un routage en vol marque transitoirement un tour
  // `interrupted` et déclenchait un envoi parasite (pilotChat appelé 2 fois, mesuré).
  // UNE seule conversation relancée par boot : deux orchestrations parallèles s'annulent
  // mutuellement dans l'app (défaut mesuré le 13/08 — la seconde a tué la première).
  // Les candidats viennent d'`unfinishedTurns` (events === 0 : rien produit, donc rien payé),
  // PAS d'un balayage de toutes les conversations — un fetch systématique au boot consommait
  // les réponses moquées des tests de chargement et interférait avec le premier chargement réel.
  const candidats = turns
    .filter((turn) => turn && turn.conversationId && turn.events === 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((turn) => loaded.find((conversation) => conversation.id === turn.conversationId))
    .filter((conversation): conversation is Conv => Boolean(conversation))
  for (const candidate of candidats) {
    try {
      const detail = (await window.api.conversation(candidate.id)) as { messages?: unknown[] }
      const hydrated = (detail?.messages ?? []).map((message) =>
        (message as { role?: string }).role === 'assistant'
          ? hydrateStoredAssistant(message as never)
          : message
      ) as Parameters<typeof promptDeRelanceGratuite>[0]
      const prompt = promptDeRelanceGratuite(hydrated)
      if (!prompt) continue
      void sendRef.current(prompt, { targetConversationId: candidate.id })
      return
    } catch (error) {
      traceSilentFailure('relance-gratuite', error)
    }
  }
}

/**
 * Survie niveau 2 — REJEU : reconstruit, depuis le journal fichier du tour, ce que le CLI a produit
 * pendant que l'app était fermée (le store de conversation, lui, n'a rien reçu), puis l'affiche
 * comme réponse assistant. N'ajoute rien si le contenu est déjà présent (pas de doublon).
 */
export async function replayTurnJournal(
  ctx: FilCtx,
  conversationId: string,
  turnId: string
): Promise<void> {
  const { liveMessagesRef, publierFil, replayedTurnsRef } = ctx
  let events: Array<Record<string, unknown>> = []
  try {
    events = (await window.api.turnJournal?.(conversationId, turnId)) ?? []
  } catch (error) {
    traceSilentFailure('turn-journal', error)
    return
  }
  const replayed = events
    .filter((event) => event.kind === 'delta' && typeof event.text === 'string')
    .map((event) => event.text as string)
    .join('')
  if (!replayed.trim()) return
  // Dédup par TOUR, pas par texte : `JSON.stringify(message).includes(80 premiers caractères)`
  // sérialisait tout le fil à chaque rejeu ET se trompait dans les deux sens — deux tours au
  // préambule identique se masquaient, un tour reformulé à la persistance se dupliquait.
  if (replayedTurnsRef.current.has(turnId)) return
  // L'ENREGISTREMENT D'ABORD : un tour encore en vol, ou dont le texte est déjà
  // enregistré, n'a rien à rejouer — sa bulle rejouée remplaçait la demande et l'action en cours.
  let enregistre: MessageStocke[] = []
  try {
    enregistre =
      ((await window.api.conversation(conversationId)) as { messages?: MessageStocke[] } | null)
        ?.messages ?? []
  } catch (error) {
    traceSilentFailure('turn-journal', error)
  }
  if (rejeuDejaEnregistre(enregistre, turnId, replayed)) {
    replayedTurnsRef.current.add(turnId)
    return
  }
  // Relu APRÈS l'attente : un événement du tour a pu poser son fil entre-temps.
  const current = liveMessagesRef.current.get(conversationId) ?? []
  if (replayedTurnsRef.current.has(turnId)) return
  if (current.some((message) => message.role === 'assistant' && message.turnId === turnId)) {
    replayedTurnsRef.current.add(turnId)
    return
  }
  const next: Msg[] = [
    ...current,
    // `parts` EXPLICITE : un tableau vide passerait le `??` de hydrateStoredAssistant et donnerait
    // un message sans aucune part → invisible (cause du rejeu muet constatée en essai réel).
    hydrateStoredAssistant({
      content: replayed,
      parts: [{ kind: 'text', text: replayed }],
      status: 'completed',
      // Le tour est PORTÉ par le message : c'est lui qui rend la dédup exacte au rejeu suivant.
      turnId
    })
  ]
  replayedTurnsRef.current.add(turnId)
  liveMessagesRef.current.set(conversationId, next)
  publierFil(conversationId, next)
}

/** Recharge la conversation active depuis le store à jour (invalide le cache live). */
export async function reloadActiveFromStore(ctx: FilCtx, id: string): Promise<void> {
  const { liveMessagesRef, loadConv, setConvs } = ctx
  liveMessagesRef.current.delete(id)
  const fresh = (await window.api.conversations()) as Conv[]
  setConvs(fresh)
  const updated = fresh.find((c) => c.id === id)
  if (updated) void loadConv(updated)
}

// Declaree SOUS `autoResumeOnce`, qu'elle appelle : appelee avant sa declaration, le compilateur
// React rattachait au rendu le `Date.now()` de la reprise.
export async function refreshConvs(ctx: FilCtx): Promise<void> {
  const { autoResumeOnce, convsRef, repriseDemarrageRef, setConvs } = ctx
  // Les fils inchangés gardent leur objet : seules leurs lignes modifiées se redessinent (gel
  // `renderer:vue-chat-liste` — l'IPC rend des copies neuves, ~1 000 lignes refaites).
  const loaded = reutiliserConversationsInchangees(
    convsRef.current,
    (await window.api.conversations()) as Conv[]
  )
  convsRef.current = loaded // dispo IMMÉDIATEMENT pour la reprise auto (sans attendre le render)
  setConvs(loaded)
  repriseDemarrageRef.current ??= autoResumeOnce(loaded)
}

/* --- fil : événements de pilotage → patch de la dernière bulle agent --- */

/**
 * ENTONNOIR DE PEINTURE. Avant la mosaique, chaque site faisait `if (actif) setMessages(fil)` :
 * une conversation non active n'etait jamais peinte, donc une fenetre de mosaique serait restee
 * figee pendant son propre streaming. Tout passe desormais ICI.
 */
export function publierFil(ctx: FilCtx, conversationId: string | null, fil: Msg[]): void {
  const { activeRef, mosaicIdsRef, setMessages, setMosaicFils } = ctx
  if (activeRef.current === conversationId) setMessages(fil)
  if (conversationId !== null && mosaicIdsRef.current.includes(conversationId)) {
    setMosaicFils((courant) => ({ ...courant, [conversationId]: fil }))
  }
}

export function patchLast(
  ctx: FilCtx,
  conversationId: string,
  fn: (m: AsstMsg) => void,
  /**
   * L'evenement vise une part DEJA posee (battement, verdict, ligne de pipeline) : il rejoint la
   * bulle qui la porte, meme si une orientation a ete ecrite dessous (2026-10-15 — sans
   * cela, une bulle vide s'ouvrait sous l'orientation et le run semblait plante pendant 29 min).
   */
  porte?: (m: AsstMsg) => boolean
): void {
  const { liveMessagesRef, publierFil } = ctx
  // RIEN A PATCHER N'EST PAS « FIL VIDE ». Le cache peut avoir ete retire le temps d'une relecture
  // (handler `refresh`) : publier le tableau vide qui en resulte EFFACAIT la fenetre de mosaique
  // a l'ecran, avant qu'elle ne se repeigne — le clignotement signale par l'utilisateur.
  const courant = liveMessagesRef.current.get(conversationId)
  if (!courant || courant.length === 0) return
  const next = courant.slice()
  // OU ECRIRE : la bulle qui porte la part visee, sinon la bulle ouverte EN FIN DE FIL, jamais
  // au-dessus d'une demande.
  let cible = porte ? indexDeLaBulleQuiPorte(next, porte) : -1
  for (let i = next.length - 1; cible === -1 && i >= 0; i--) {
    if (next[i].role === 'user') break
    if (next[i].role === 'assistant') {
      cible = i
      break
    }
  }
  if (cible === -1) {
    next.push(hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' }))
    cible = next.length - 1
  }
  const copy: AsstMsg = {
    ...(next[cible] as AsstMsg),
    parts: (next[cible] as AsstMsg).parts.slice()
  }
  fn(copy)
  // Invariant impose ICI, dans l'entonnoir UNIQUE de mutation, et non aux trois sites qui closent
  // un tour (annule / echoue / termine) : un quatrieme site futur l'oublierait. Un tour `done` ne
  // laisse aucune action « en cours » — sinon l'indicateur tourne indefiniment et le bouton
  // « Reprendre » n'apparait qu'apres un redemarrage de l'app.
  next[cible] = settleIfDone(copy) as AsstMsg
  liveMessagesRef.current.set(conversationId, next)
  publierFil(conversationId, next)
}
