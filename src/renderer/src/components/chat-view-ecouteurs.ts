import { NEW_DRAFT_KEY } from './chat-view-outils'
import { ouvrirEcouteurPrefill, fermerEcouteurPrefill } from './relais-prefill'
import type { ChatComposerHandle } from './ChatComposer'
import type { Conv, Msg, SendOptions } from './chat-view-types'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les écouteurs posés au montage (pré-remplissage, ouverture d'un fil) lisent de ChatView. */
export type EcouteursCtx = {
  activeRef: React.RefObject<string | null>
  composerRef: React.RefObject<ChatComposerHandle | null>
  convsRef: React.RefObject<Conv[]>
  convViewModeRef: React.RefObject<'list' | 'mosaic'>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  newConv: () => void
  ouvrirDansMosaique: (id: string) => Promise<void>
  poserDansFenetreMosaique: (id: string, texte: string) => void
  refreshConvs: () => Promise<void>
  refreshFiches: () => Promise<void>
  replayTurnJournal: (conversationId: string, turnId: string) => Promise<void>
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setDraftInput: (key: string, value: string) => void
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  switchComposerDraft: (key: string) => void
}

export function ecouterPrefillEtBrainwash(ctx: EcouteursCtx): () => void {
  const {
    activeRef,
    composerRef,
    convViewModeRef,
    convsRef,
    loadConv,
    newConv,
    ouvrirDansMosaique,
    poserDansFenetreMosaique,
    refreshConvs,
    send,
    setActiveId,
    setDraftInput,
    setMessages,
    switchComposerDraft
  } = ctx
  const openBrainwash = (event: Event): void => {
    const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt
    if (!prompt) return
    newConv()
    setDraftInput(NEW_DRAFT_KEY, prompt)
    requestAnimationFrame(() => composerRef.current?.focus())
  }
  /**
   * Tickets → Chat (refonte du 2026-07-28). Ouvre la conversation de la sélection et y PRÉ-REMPLIT
   * le prompt sans l'envoyer : c'est l'utilisateur qui déclenche. `send: true` (case « Traiter
   * réellement ») envoie immédiatement. Avant, la vue Tickets lançait N orchestrations sans que le
   * prompt soit jamais visible.
   */
  const prefill = (event: Event): void => {
    const detail = (
      event as CustomEvent<{
        conversationId?: string
        prompt?: string
        send?: boolean
      }>
    ).detail
    // Un événement SANS prompt mais AVEC conversationId est une demande de SÉLECTION : « ouvre
    // cette conversation ». Le scout de veille s'en sert pour amener l'utilisateur devant le tour
    // qui démarre — l'ignorer laissait la conversation active inchangée (mesuré le 14/08 : le clic
    // « En générer plus » atterrissait sur l'ancienne conversation).
    if (!detail?.prompt && !detail?.conversationId) return
    const id = detail.conversationId
    /**
     * MOSAIQUE. Le chat unique n'est pas rendu du tout dans ce mode : remplir son champ
     * n'affichait RIEN, et « Faire reparer » (comme « Prompter dans Autowin » ou « Preparer le
     * prompt » des tickets) paraissait mort alors que la conversation etait bien creee. On ouvre
     * donc une fenetre DE PLUS — la mosaique reste en place —, on y depose le brouillon (deja
     * indexe par conversation) et on impose la valeur au composer de cette fenetre des qu'il est
     * monte. Choix utilisateur du 2026-09-01 contre la sortie de mosaique.
     */
    if (id && convViewModeRef.current === 'mosaic') {
      const prompt = detail.prompt
      void (async () => {
        if (!convsRef.current.some((conversation) => conversation.id === id)) await refreshConvs()
        await ouvrirDansMosaique(id)
        if (!prompt) return
        if (detail.send) {
          setDraftInput(id, prompt)
          void send(prompt, { targetConversationId: id })
          return
        }
        poserDansFenetreMosaique(id, prompt)
      })()
      return
    }
    if (id) {
      const target = convsRef.current.find((conversation) => conversation.id === id)
      if (target) void loadConv(target)
      else {
        // Conversation créée À L'INSTANT (scout de veille) : la liste du renderer ne la porte pas
        // encore. La rafraîchir PUIS charger, sinon le panneau restait sur l'état vide « Parle à
        // l'agent » pendant que le tour tournait dans le store (mesuré le 14/08).
        activeRef.current = id
        setActiveId(id)
        setMessages([])
        void (async () => {
          await refreshConvs()
          const fraiche = convsRef.current.find((conversation) => conversation.id === id)
          if (fraiche && activeRef.current === id) await loadConv(fraiche)
        })()
      }
    }
    if (!detail.prompt) return
    const draftKey = id ?? NEW_DRAFT_KEY
    switchComposerDraft(draftKey)
    setDraftInput(draftKey, detail.prompt)
    if (detail.send) void send(detail.prompt, { targetConversationId: id })
    else requestAnimationFrame(() => composerRef.current?.focus())
  }
  window.addEventListener('autowin:prefill-conversation', prefill)
  window.addEventListener('autowin:brainwash', openBrainwash)
  // Une demande émise AVANT le premier affichage du chat a été gardée par le relais (
  // `relais-prefill.ts`) : on la réclame dans le MÊME bloc que la pose de l'écouteur.
  const gardee = ouvrirEcouteurPrefill()
  if (gardee) prefill(new CustomEvent('autowin:prefill-conversation', { detail: gardee }))
  return () => {
    fermerEcouteurPrefill()
    window.removeEventListener('autowin:prefill-conversation', prefill)
    window.removeEventListener('autowin:brainwash', openBrainwash)
  }
}

// Survie niveau 2 : « Reprendre » depuis le bandeau de démarrage ouvre la conversation dont le
// tour a été interrompu par la fermeture de l'app (son fil est rechargé depuis le store).
export function ecouterOuvertureDeConversation(ctx: EcouteursCtx): () => void {
  const { convsRef, loadConv, refreshConvs, refreshFiches, replayTurnJournal } = ctx
  const openConversation = (event: Event): void => {
    // DEUX FORMES acceptées : l'objet `{ conversationId }` (bandeau de reprise) et l'id NU en
    // chaîne, envoyé par l'écran des fiches et l'accueil. Avant, la chaîne tombait dans
    // `detail?.conversationId === undefined` et l'ouverture était silencieusement ignorée : le
    // chat restait sur la conversation courante, d'où l'impression d'« aller vers la dernière ».
    const raw = (event as CustomEvent<{ conversationId?: string; turnId?: string } | string>).detail
    const detail = typeof raw === 'string' ? { conversationId: raw } : raw
    const id = detail?.conversationId
    if (!id) return
    // La conversation demandée peut ne PAS être dans la liste en mémoire : celle créée depuis
    // l'écran des fiches est plus récente que le dernier chargement. Sans ce rafraîchissement, la
    // recherche échouait et le chat restait sur la conversation affichée — on croyait « atterrir
    // sur la dernière ». Même garde que le chemin de pré-remplissage voisin.
    void (async () => {
      if (!convsRef.current.some((conversation) => conversation.id === id)) await refreshConvs()
      const target = convsRef.current.find((conversation) => conversation.id === id)
      if (target) await loadConv(target)
      // Fil déjà ouvert : `activeId` ne change pas, l'effet ne relirait pas ses fiches, et la fiche
      // demandée depuis le Board ne se déplierait pas.
      if (target) await refreshFiches()
    })()
    // REJEU du journal : l'app était fermée pendant le tour → le store n'a pas reçu ces événements,
    // seul le journal fichier les contient. On reconstruit le texte produit et on l'affiche.
    if (detail?.turnId) void replayTurnJournal(id, detail.turnId)
  }
  window.addEventListener('autowin:open-conversation', openConversation)
  return () => window.removeEventListener('autowin:open-conversation', openConversation)
}
