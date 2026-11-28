import { lotsRetenusParLeQuota } from './lots-retenus-quota'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import type {
  QueuedDirective,
  ChatAttachment,
  Msg,
  SendOptions,
  DirectiveReceipt
} from './chat-view-types'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que la file d'attente des messages, le verrou des lots et la compaction automatique lisent de ChatView. */
export type FileAttenteCtx = {
  busyConversationsRef: React.RefObject<Set<string>>
  compactionEnAttenteRef: React.RefObject<Set<string>>
  dernierMessageUtilisateurDe: (conversationId: string) => string | undefined
  drainApresVerrouRef: React.RefObject<Set<string>>
  interruptingConversationsRef: React.RefObject<Set<string>>
  liveMessagesRef: React.RefObject<Map<string, Msg[]>>
  lotsRetenusDansLeFil: (id: string) => boolean
  lotsRetenusRef: React.RefObject<Set<string>>
  marquerRecusDesLots: (id: string, motif: 'lot' | 'lot-quota') => void
  nextQueueEntryIdRef: React.RefObject<number>
  queueRef: React.RefObject<Map<string, QueuedDirective[]>>
  retirerRecusEnAttente: (conversationId: string, textes: string[]) => void
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  sendLocksRef: React.RefObject<Set<string>>
  setBusyConversations: React.Dispatch<React.SetStateAction<Set<string>>>
  setConversationQueue: (id: string, next: QueuedDirective[]) => void
  setDirectiveReceipts: React.Dispatch<React.SetStateAction<Record<string, DirectiveReceipt[]>>>
  setInterruptingConversations: React.Dispatch<React.SetStateAction<Set<string>>>
  stopDemandeRef: React.RefObject<Set<string>>
  stoppedQueueDrainRef: React.RefObject<Set<string>>
  teteRetenueParLeVerrou: (id: string) => boolean
}

export function setConversationBusy(ctx: FileAttenteCtx, id: string, value: boolean): void {
  const { busyConversationsRef, lotsRetenusRef, marquerRecusDesLots, setBusyConversations } = ctx
  if (value) busyConversationsRef.current.add(id)
  else busyConversationsRef.current.delete(id)
  setBusyConversations(new Set(busyConversationsRef.current))
  // UN TOUR REPART DANS LE FIL : c'est la reprise. Les lots retenus par le quota attendent de
  // nouveau la fin d'un tour, et leur reçu le redit ; sa fin dira s'ils partent.
  if (value && lotsRetenusRef.current.delete(id)) marquerRecusDesLots(id, 'lot')
}

export function setConversationInterrupting(ctx: FileAttenteCtx, id: string, value: boolean): void {
  const { interruptingConversationsRef, setInterruptingConversations } = ctx
  if (value) interruptingConversationsRef.current.add(id)
  else interruptingConversationsRef.current.delete(id)
  setInterruptingConversations(new Set(interruptingConversationsRef.current))
}

export function setConversationQueue(
  ctx: FileAttenteCtx,
  id: string,
  next: QueuedDirective[]
): void {
  const { lotsRetenusRef, queueRef, retirerRecusEnAttente } = ctx
  const avant = queueRef.current.get(id) ?? []
  if (next.length) queueRef.current.set(id, next)
  else queueRef.current.delete(id)
  // UN TEXTE QUI QUITTE LA FILE N'ATTEND PLUS RIEN — parti en message, ou rendu au composer par
  // Stop. Son reçu « Attend la fin du tour » mentirait alors, et doublait le vrai message dans le
  // fil (Message parti à 12:26:29, reçu toujours affiché). Point UNIQUE : les trois
  // sorties de la file passent toutes par ici.
  const restants = new Set(next.map((entree) => entree.text))
  const sortis = avant.filter((entree) => !restants.has(entree.text)).map((e) => e.text)
  if (sortis.length) retirerRecusEnAttente(id, sortis)
  // Plus rien en file (parti, ou rendu au composer par Stop) : plus rien à retenir.
  if (next.length === 0) lotsRetenusRef.current.delete(id)
}

/** Le reçu des lots en attente dit pourquoi ils attendent : fin du tour, ou reprise après le quota. */
export function marquerRecusDesLots(
  ctx: FileAttenteCtx,
  id: string,
  motif: 'lot' | 'lot-quota'
): void {
  const { setDirectiveReceipts } = ctx
  setDirectiveReceipts((current) => {
    const receipts = current[id]
    if (!receipts?.some((r) => r.attenteMotif === 'lot' || r.attenteMotif === 'lot-quota'))
      return current
    return {
      ...current,
      [id]: receipts.map((receipt) =>
        receipt.status === 'attente' &&
        (receipt.attenteMotif === 'lot' || receipt.attenteMotif === 'lot-quota')
          ? { ...receipt, attenteMotif: motif }
          : receipt
      )
    }
  })
}

/**
 * LE LOT SUIVANT NE PART PAS DANS LE MUR DE QUOTA (2026-10-22). À consulter par CHAQUE
 * sortie automatique de la file, avant d'en relâcher la tête : le lot d'avant coupé par la limite
 * (`lots-retenus-quota.ts`), le suivant partait aussitôt, retombait sur le même refus et relâchait le
 * troisième — la sélection entière se vidait en échecs. Retenus, ils restent en file, visibles, et
 * partent à la fin du prochain tour qui ne bute pas sur la limite (la reprise, par l'utilisateur).
 */
export function lotsRetenusDansLeFil(ctx: FileAttenteCtx, id: string): boolean {
  const { liveMessagesRef, lotsRetenusRef, marquerRecusDesLots, queueRef } = ctx
  const file = queueRef.current.get(id) ?? []
  if (file[0]?.lot !== true) return false
  if (lotsRetenusRef.current.has(id)) return true
  if (!lotsRetenusParLeQuota(file, liveMessagesRef.current.get(id) ?? [])) return false
  lotsRetenusRef.current.add(id)
  marquerRecusDesLots(id, 'lot-quota')
  return true
}

export function teteRetenueParLeVerrou(ctx: FileAttenteCtx, id: string): boolean {
  const { drainApresVerrouRef, sendLocksRef } = ctx
  if (!sendLocksRef.current.has(id)) return false
  drainApresVerrouRef.current.add(id)
  return true
}

export function lancerCompactionAuto(ctx: FileAttenteCtx, conversationId: string): void {
  const {
    busyConversationsRef,
    compactionEnAttenteRef,
    dernierMessageUtilisateurDe,
    send,
    sendLocksRef
  } = ctx
  if (
    sendLocksRef.current.has(conversationId) ||
    busyConversationsRef.current.has(conversationId)
  ) {
    compactionEnAttenteRef.current.add(conversationId)
    return
  }
  compactionEnAttenteRef.current.delete(conversationId)
  // Un résumé est déjà parti pendant l'attente (bouton Compacter) : un second serait payé pour rien.
  if (dernierMessageUtilisateurDe(conversationId)?.trim() === COMPACT_REQUEST) return
  void send(COMPACT_REQUEST, { targetConversationId: conversationId })
}

/** Le drain retenu par le verrou, rejoué quand l'envoi qui le tenait s'est clos. */
export function drainerApresVerrou(ctx: FileAttenteCtx, id: string): void {
  const {
    busyConversationsRef,
    lotsRetenusDansLeFil,
    queueRef,
    send,
    setConversationQueue,
    stopDemandeRef,
    stoppedQueueDrainRef,
    teteRetenueParLeVerrou
  } = ctx
  // Un tour est reparti entre-temps (mode auto, message tapé) : la fin de CE tour drainera.
  if (busyConversationsRef.current.has(id) || teteRetenueParLeVerrou(id)) return
  // Un Stop survenu pendant l'attente garde sa promesse : rien ne repart seul.
  if (stoppedQueueDrainRef.current.has(id) || stopDemandeRef.current.has(id)) return
  if (lotsRetenusDansLeFil(id)) return
  const [tete, ...reste] = queueRef.current.get(id) ?? []
  if (!tete) return
  setConversationQueue(id, reste)
  void send(tete.text, {
    keepComposerDraft: true,
    automatique: true,
    targetConversationId: id,
    ...(tete.attachments?.length ? { piecesJointesImposees: tete.attachments } : {})
  })
}

/**
 * `mode: 'btw'` = « celui-la passe EN DERNIER ». Il ne suffit pas de deplacer l'entree une fois :
 * sans cette insertion, le message suivant tape par l'utilisateur atterrissait APRES le message
 * marque BTW, ce qui defaisait silencieusement la promesse du bouton (« remettre a la fin ») —
 * `mode` n'etait alors lu que pour l'affichage, donc le clic n'avait aucun effet durable.
 * Un nouvel envoi BTW, lui, se range derriere les BTW deja presents (ordre d'arrivee conserve).
 */
export function enqueueMessage(
  ctx: FileAttenteCtx,
  id: string,
  text: string,
  mode?: QueuedDirective['mode'],
  attachments?: ChatAttachment[],
  /** `lot` : un lot de sélection scout mis en file par le panneau. */
  origine?: Pick<QueuedDirective, 'lot'>
): void {
  const { nextQueueEntryIdRef, queueRef, setConversationQueue, stoppedQueueDrainRef } = ctx
  // Un texte qui arrive en file APRES un Stop est un geste explicite de l'utilisateur : il LEVE le
  // gel one-shot pose par Stop. Sans cette ligne, « stop puis j'ecris dans la foulee » perdait le
  // message — le tour n'etait pas encore retombe, l'injection echouait, la file recevait le texte
  // et la transition busy→false l'avalait au titre du gel (constate le 03/09). Le gel ne doit
  // arreter QUE la relance automatique de ce qui restait en file, jamais une nouvelle demande.
  stoppedQueueDrainRef.current.delete(id)
  const current = queueRef.current.get(id) ?? []
  const entry: QueuedDirective = {
    id: nextQueueEntryIdRef.current++,
    text,
    mode,
    ...(attachments && attachments.length ? { attachments } : {}),
    ...(origine?.lot ? { lot: true as const } : {})
  }
  if (mode === 'btw') {
    setConversationQueue(id, [...current, entry])
    return
  }
  let insertAt = current.length
  while (insertAt > 0 && current[insertAt - 1].mode === 'btw') insertAt -= 1
  const next = current.slice()
  next.splice(insertAt, 0, entry)
  setConversationQueue(id, next)
}
