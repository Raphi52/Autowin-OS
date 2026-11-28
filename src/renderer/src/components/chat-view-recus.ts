import { traceSilentFailure } from './chat-view-outils'
import { rangsEffacesParLeReset } from '../../../shared/chat-turn'
import type { QueuedDirective, DirectiveReceipt, Msg } from './chat-view-types'
import { useState, useEffect, useMemo } from 'react'
import { rejouerOrientations } from './orientations-rejouees'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que la tenue des reçus de consigne (saisies envoyées pendant un tour) lit de ChatView. */
export type RecusCtx = {
  liveMessagesRef: React.RefObject<Map<string, Msg[]>>
  pilotFlushRef: React.RefObject<() => void>
  queueRef: React.RefObject<Map<string, QueuedDirective[]>>
  retirerDirectiveReceipt: (conversationId: string, entryId: number) => void
  setConversationQueue: (id: string, next: QueuedDirective[]) => void
  setDirectiveReceipts: React.Dispatch<React.SetStateAction<Record<string, DirectiveReceipt[]>>>
}

/**
 * FILET DE SÉCURITÉ : écrit le texte de l'utilisateur sur disque AVANT qu'il ne quitte le composer.
 *
 * Mesure du 2026-09-01 : deux messages tapés pendant un tour ont disparu sans trace.
 * Le composer se vide dès l'envoi, et le texte ne vit ensuite que dans des refs volatiles
 * (`composerDraftsRef`, `queueRef`, `directiveReceipts`) tant qu'aucun TOUR n'est créé — un
 * rechargement, un changement de conversation ou une injection refusée l'effaçait définitivement.
 *
 * Volontairement « fire and forget » : un journal indisponible ne doit jamais retarder ni faire
 * échouer un envoi. L'échec est tracé silencieusement, jamais remonté à l'utilisateur.
 */
export function journaliserSaisie(
  conversationId: string,
  texte: string,
  voie: 'message' | 'orientation',
  origine?: 'mode-auto'
): void {
  try {
    // L'origine n'est transmise que si elle existe : un texte tapé garde l'appel d'origine à 3 arguments.
    const ecrit = origine
      ? window.api.journaliserSaisie?.(conversationId, texte, voie, origine)
      : window.api.journaliserSaisie?.(conversationId, texte, voie)
    void ecrit?.catch((error: unknown) => {
      traceSilentFailure('journal-saisie', error)
    })
  } catch (error) {
    traceSilentFailure('journal-saisie', error)
  }
}

export function setDirectiveReceipt(
  ctx: RecusCtx,
  conversationId: string,
  entry: QueuedDirective,
  status: DirectiveReceipt['status'],
  // Une REPONSE a une question `ask` emprunte le meme transport qu'une orientation, mais ce
  // n'en est pas une : sans ce drapeau, le fil affichait « ✓ Orienté » sur une reponse.
  reponse?: boolean,
  /** Pourquoi le texte attend (statut `attente`) — dit par l'app principale quand elle le sait. */
  attente?: Pick<DirectiveReceipt, 'attenteMotif' | 'commande'>
): void {
  const { liveMessagesRef, pilotFlushRef, setDirectiveReceipts } = ctx
  // L'ancre doit porter sur le fil TEL QU'AFFICHE : sans ce vidage, les deltas encore en tampon
  // manquaient a l'appel, et le recu se posait AVANT le texte deja lu (un seul bloc au rendu).
  pilotFlushRef.current()
  const liveMessages = liveMessagesRef.current.get(conversationId) ?? []
  const afterMessageIndex = liveMessages.length - 1
  const anchorMessage = liveMessages[afterMessageIndex]
  const afterPartIndex = anchorMessage?.role === 'assistant' ? anchorMessage.parts.length - 1 : -1
  const anchorPart =
    anchorMessage?.role === 'assistant' && afterPartIndex >= 0
      ? anchorMessage.parts[afterPartIndex]
      : undefined
  setDirectiveReceipts((current) => {
    const receipts = current[conversationId] ?? []
    const existing = receipts.findIndex((receipt) => receipt.id === entry.id)
    const next =
      existing >= 0
        ? receipts.map((receipt, index) =>
            index === existing ? { ...receipt, status, ...attente } : receipt
          )
        : [
            ...receipts,
            {
              id: entry.id,
              text: entry.text,
              status,
              ...attente,
              ...(reponse ? { reponse: true as const } : {}),
              afterMessageIndex,
              afterPartIndex,
              ...(anchorPart?.kind === 'text' ? { afterTextOffset: anchorPart.text.length } : {})
            }
          ]
    return { ...current, [conversationId]: next }
  })
}

/** Retire les reçus « mis de côté » dont le texte vient de quitter la file (voir `setConversationQueue`). */
export function retirerRecusEnAttente(
  ctx: RecusCtx,
  conversationId: string,
  textes: string[]
): void {
  const { setDirectiveReceipts } = ctx
  const partis = new Set(textes)
  setDirectiveReceipts((current) => {
    const receipts = current[conversationId]
    if (!receipts?.length) return current
    const next = receipts.filter(
      (receipt) =>
        !((receipt.status === 'attente' || receipt.status === 'failed') && partis.has(receipt.text))
    )
    if (next.length === receipts.length) return current
    return { ...current, [conversationId]: next }
  })
}

/**
 * Le main a ecrit un VRAI message pour ce texte : le recu provisoire n'a plus lieu d'etre.
 * Sans ce retrait, l'utilisateur verrait DEUX fois son texte (le recu + le message relu).
 */
export function retirerDirectiveReceipt(
  ctx: RecusCtx,
  conversationId: string,
  entryId: number
): void {
  const { setDirectiveReceipts } = ctx
  setDirectiveReceipts((current) => {
    const receipts = current[conversationId]
    if (!receipts?.length) return current
    const next = receipts.filter((receipt) => receipt.id !== entryId)
    if (next.length === receipts.length) return current
    return { ...current, [conversationId]: next }
  })
}

/**
 * ANNULER UN ENVOI EN ATTENTE (2026-11-03) : « /git » tapé pendant un tour attendait sa
 * fin, et seul Stop pouvait l'en sortir — en coupant aussi le tour. Le reçu et la file ne partagent
 * pas d'identifiant (`submitBtw`), seulement le TEXTE : on retire la PREMIÈRE entrée de ce texte,
 * pas toutes (deux envois identiques restent deux envois), puis ce reçu-là par son id.
 */
export function annulerEnvoiEnAttente(
  ctx: RecusCtx,
  conversationId: string,
  receipt: DirectiveReceipt
): void {
  const { queueRef, retirerDirectiveReceipt, setConversationQueue } = ctx
  const file = queueRef.current.get(conversationId) ?? []
  const rang = file.findIndex((entree) => entree.text === receipt.text)
  if (rang >= 0)
    setConversationQueue(conversationId, [...file.slice(0, rang), ...file.slice(rang + 1)])
  retirerDirectiveReceipt(conversationId, receipt.id)
}

export function rebaseDirectiveReceiptsAfterStreamReset(
  ctx: RecusCtx,
  conversationId: string,
  reset: { streamId: string; conclusionSeule?: true }
): void {
  const { liveMessagesRef, setDirectiveReceipts } = ctx
  const liveMessages = liveMessagesRef.current.get(conversationId) ?? []
  setDirectiveReceipts((current) => {
    const receipts = current[conversationId]
    if (!receipts?.length) return current
    let changed = false
    const next = receipts.map((receipt) => {
      if (receipt.afterPartIndex < 0) return receipt
      const anchorMessage = liveMessages[receipt.afterMessageIndex]
      if (anchorMessage?.role !== 'assistant') return receipt
      // Les MÊMES parts que retire le réducteur : une relance ne retire plus que la conclusion
      // Compter tout le texte du flux décalerait le reçu à tort.
      const effaces = rangsEffacesParLeReset(anchorMessage.parts, reset)
      const removedBefore = effaces.filter((rang) => rang < receipt.afterPartIndex).length
      const anchorRemoved = effaces.includes(receipt.afterPartIndex)
      if (removedBefore === 0 && !anchorRemoved) return receipt
      changed = true
      const nouvelIndex = receipt.afterPartIndex - removedBefore - (anchorRemoved ? 1 : 0)
      // Tout ce qui precedait ce recu vient d'etre efface : il se pose AVANT ce qui reste.
      // On ne redescend PAS a un index negatif — au rendu, `afterPartIndex < 0` veut dire
      // « aucun point d'accroche, ce recu passe en dernier », ce qui l'aurait renvoye APRES le
      // flux de remplacement alors qu'il l'a precede.
      if (nouvelIndex < 0) return { ...receipt, afterPartIndex: 0, afterTextOffset: 0 }
      return {
        ...receipt,
        afterPartIndex: nouvelIndex,
        ...(anchorRemoved ? { afterTextOffset: undefined } : {})
      }
    })
    return changed ? { ...current, [conversationId]: next } : current
  })
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type RecusDuFilCtx = {
  activeId: string | null
  messagesRef: React.RefObject<Msg[]>
}

/** Les reçus des consignes du fil : relus du main à l'ouverture, et groupés par message. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useRecusDuFil(ctx: RecusDuFilCtx) {
  const { activeId, messagesRef } = ctx
  /**
   * Saisie du dossier en cours de creation, dans le sous-menu « Ranger dans un dossier ».
   *
   * `undefined` = pas en train de creer. La liste du menu est DERIVEE des conversations deja
   * rangees : sans ce champ, zero dossier signifiait zero moyen d'en creer un, donc zero dossier
   * pour toujours (constate le 2026-08-18). On saisit ICI plutot que via le selecteur natif :
   * un dossier de conversations est une etiquette, pas un repertoire Windows.
   */
  // File d'attente : directives injectées pendant le tour, pas encore consommées (conv active).
  // Elle n'a PLUS d'affichage (choix utilisateur du 2026-09-17 : le panneau ne servait à rien) —
  // les messages en attente se drainent seuls à la fin du tour. L'état reste tenu ici parce que
  // c'est lui que le drain lit.
  const [directiveReceipts, setDirectiveReceipts] = useState<Record<string, DirectiveReceipt[]>>({})
  /*
   * REJOUER LES CONSIGNES DU TOUR A L'OUVERTURE D'UNE CONVERSATION.
   *
   * Sans cela, une consigne tapee pendant un run disparaissait au premier changement de
   * conversation : elle ne vivait que dans `directiveReceipts`, jamais relue du journal.
   * On n'ECRASE JAMAIS des recus deja presents -- ceux du direct sont plus riches (ancre fine
   * dans le flux, statut reel) ; on ne remplit que les fils encore vides.
   */
  useEffect(() => {
    if (!activeId) return
    // Canal ABSENT (preload plus ancien, ou harnais de test) : on ne rejoue rien plutot que de
    // faire tomber tout le fil. Meme motif defensif que `PerfLagPanel` sur `perfGels`.
    if (typeof window.api?.orientationsDeConversation !== 'function') return
    let vivant = true
    // Le fil tel qu'il est a l'OUVERTURE, lu par sa ref : `messages` en dependance relancerait la
    // relecture a chaque delta de flux, donc a chaque token recu.
    const filALOuverture = messagesRef.current
    void window.api
      .orientationsDeConversation(activeId)
      .then((orientations) => {
        if (!vivant || orientations.length === 0) return
        setDirectiveReceipts((current) => {
          if (current[activeId]?.length) return current
          const rejoues = rejouerOrientations(orientations, filALOuverture)
          return rejoues.length ? { ...current, [activeId]: rejoues } : current
        })
      })
      .catch(() => {
        /* Le journal est une trace de dernier recours : ne pas le lire n'est jamais une panne. */
      })
    return () => {
      vivant = false
    }
    // `messagesRef` vient de `useRef` (ChatView.tsx) : stable, il ne relance rien.
  }, [activeId, messagesRef])
  const activeDirectiveReceipts = useMemo(
    () => (activeId ? (directiveReceipts[activeId] ?? []) : []),
    [activeId, directiveReceipts]
  )
  const activeDirectiveReceiptsByMessage = useMemo(() => {
    const byMessage = new Map<number, DirectiveReceipt[]>()
    for (const receipt of activeDirectiveReceipts) {
      if (receipt.afterMessageIndex < 0) continue
      const current = byMessage.get(receipt.afterMessageIndex) ?? []
      byMessage.set(receipt.afterMessageIndex, [...current, receipt])
    }
    return byMessage
  }, [activeDirectiveReceipts])
  return { setDirectiveReceipts, activeDirectiveReceipts, activeDirectiveReceiptsByMessage }
}
