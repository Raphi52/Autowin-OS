import { departPourModifier } from './modifier-relancer'
import { NEW_DRAFT_KEY, newestNotice, texteFil, type AppNotice } from './chat-view-outils'
import { canonicalProjectPath } from '../../../shared/project-path'
import { promptTravauxNonPublies } from './travail-non-publie'
import type {
  Conv,
  ChatAttachment,
  QueuedDirective,
  Msg,
  SendOptions,
  DirectiveReceipt
} from './chat-view-types'
import type { ChatComposerHandle } from './ChatComposer'
import type { ChatRuntimeIdentity } from './chat-view-model'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les gestes sur un message du fil (bifurquer, modifier, revenir, envoyer la suite) lisent de ChatView. */
export type GestesFilCtx = {
  activeId: string | null
  activeRef: React.RefObject<string | null>
  brancheDansLaCopie: (
    source: string,
    ancre: string | undefined,
    chemin: string,
    titre: string
  ) => Promise<{ ok: true; id: string } | { ok: false; raison: string }>
  busyConversationsRef: React.RefObject<Set<string>>
  composerRef: React.RefObject<ChatComposerHandle | null>
  enqueueMessage: (
    id: string,
    text: string,
    mode?: 'btw' | undefined,
    attachments?: ChatAttachment[] | undefined,
    origine?: Pick<QueuedDirective, 'lot'> | undefined
  ) => void
  filsAvecLotsRef: React.RefObject<Set<string>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  messages: Msg[]
  newConv: () => void
  nextQueueEntryIdRef: React.RefObject<number>
  refreshRuntimeIdentity: (forceModels?: boolean) => Promise<ChatRuntimeIdentity>
  reloadActiveFromStore: (id: string) => Promise<void>
  send: (text?: string | undefined, options?: SendOptions | undefined) => Promise<void>
  setAppNotice: React.Dispatch<React.SetStateAction<AppNotice | null>>
  setConvs: React.Dispatch<React.SetStateAction<Conv[]>>
  setDirectiveReceipt: (
    conversationId: string,
    entry: QueuedDirective,
    status: 'failed' | 'sending' | 'sent' | 'differee' | 'attente',
    reponse?: boolean | undefined,
    attente?: Pick<DirectiveReceipt, 'attenteMotif' | 'commande'> | undefined
  ) => void
  setDraftInput: (key: string, value: string) => void
}

/**
 * Forker ouvre la conversation CRÉÉE — c'est le geste attendu : on continue dans la copie, pas
 * dans l'originale. L'ancienne version rechargeait la conversation courante, parce que le fork
 * n'était qu'une branche interne à laquelle il fallait une barre d'onglets pour accéder.
 */
export async function forkFromMessage(ctx: GestesFilCtx, messageId: string): Promise<void> {
  const { activeId, loadConv, reloadActiveFromStore, setConvs } = ctx
  if (!activeId) return
  /*
   * Ouvre la branche MÊME pendant un tour (2026-11-04) : la retenue sur place avec un
   * bandeau « la branche vous attend dans la liste » (2026-09-03) a été refusée par l'utilisateur —
   * cliquer la branche doit toujours l'y emmener. Le tour du fil d'origine continue en fond.
   */
  const forked = (await window.api.conversationsFork(activeId, messageId)) as Conv | undefined
  const fresh = (await window.api.conversations()) as Conv[]
  setConvs(fresh)
  const target = (forked?.id && fresh.find((c) => c.id === forked.id)) || undefined
  if (!target) {
    await reloadActiveFromStore(activeId) // fork refusé : on reste où on est
    return
  }
  void loadConv(target)
}

/**
 * « MODIFIER ET RELANCER » (2026-10-21) : reprendre un de ses messages en le corrigeant.
 * La copie du fil s'arrête JUSTE AVANT lui (`departPourModifier`), s'ouvre, et le texte du message
 * attend dans sa saisie : rien n'est envoyé, l'utilisateur corrige puis envoie. Avant le premier
 * message, il n'y a rien à copier : un fil neuf. Même retenue que la branche pendant un tour : on ne
 * quitte pas le fil qui travaille, un avis dit où la copie attend. Seule la conversation revient en
 * arrière, pas les fichiers (décision « branches-rewind », étape 1).
 */
export async function modifierEtRelancer(ctx: GestesFilCtx, messageId: string): Promise<void> {
  const {
    activeRef,
    busyConversationsRef,
    composerRef,
    loadConv,
    messages,
    newConv,
    reloadActiveFromStore,
    setAppNotice,
    setConvs,
    setDraftInput
  } = ctx
  const source = activeRef.current
  if (!source) return
  const message = messages.find((candidat) => candidat.messageId === messageId)
  if (!message || message.role !== 'user' || !message.content) return
  const depart = departPourModifier(messages, messageId)
  if (!depart) return
  if (depart.kind === 'fil-neuf') {
    newConv()
    setDraftInput(NEW_DRAFT_KEY, message.content)
    requestAnimationFrame(() => composerRef.current?.focusAt(-1))
    return
  }
  const tourEnCours = busyConversationsRef.current.has(source)
  const copie = (await window.api.conversationsFork(source, depart.ancre)) as Conv | undefined
  const fraiches = (await window.api.conversations()) as Conv[]
  setConvs(fraiches)
  const cible = copie?.id
    ? fraiches.find((conversation) => conversation.id === copie.id)
    : undefined
  if (!cible) {
    await reloadActiveFromStore(source) // copie refusée : on reste où on est
    return
  }
  // Le brouillon de la copie est posé AVANT son ouverture : l'ouverture le relit tel quel.
  setDraftInput(cible.id, message.content)
  if (tourEnCours) {
    setAppNotice((current) =>
      newestNotice(current, {
        text: texteFil('copie.creee', { titre: cible.title })
      })
    )
    return
  }
  await loadConv(cible)
  requestAnimationFrame(() => composerRef.current?.focusAt(-1))
}

/**
 * « REVENIR À CE TOUR, CODE ET FIL » (2026-10-21 — décision « branches-rewind »,
 * étape 2). Le main rouvre la photo du code prise au début du tour de ce message dans une COPIE
 * SÉPARÉE (`photo-du-code.ts`) ; ici, la copie du fil s'arrête juste avant le message (comme
 * « Modifier et relancer ») et travaille DANS cette copie : son tour suivant n'écrit jamais dans le
 * dossier partagé. Le texte du message attend dans la saisie, rien n'est envoyé. Sans photo, aucune
 * branche n'est créée et la raison est dite.
 */
export async function revenirAuTour(ctx: GestesFilCtx, messageId: string): Promise<void> {
  const {
    activeRef,
    brancheDansLaCopie,
    busyConversationsRef,
    composerRef,
    loadConv,
    messages,
    setAppNotice,
    setConvs,
    setDraftInput
  } = ctx
  const source = activeRef.current
  if (!source) return
  const message = messages.find((candidat) => candidat.messageId === messageId)
  if (!message || message.role !== 'user') return
  const depart = departPourModifier(messages, messageId)
  if (!depart) return
  const retour = await window.api.conversationRevenirAuTour?.(source, messageId)
  if (!retour) return
  if (!retour.ok) {
    setAppNotice((current) => newestNotice(current, { text: retour.raison }))
    return
  }
  const branche = await brancheDansLaCopie(
    source,
    depart.kind === 'copie' ? depart.ancre : undefined,
    retour.chemin,
    texteFil('revenir.titre')
  )
  if (!branche.ok) {
    setAppNotice((current) =>
      newestNotice(current, {
        text: texteFil('revenir.brancheRefusee', {
          chemin: retour.chemin,
          raison: branche.raison
        })
      })
    )
    return
  }
  const cibleId = branche.id
  const fraiches = (await window.api.conversations()) as Conv[]
  setConvs(fraiches)
  const cible = fraiches.find((conversation) => conversation.id === cibleId)
  if (!cible) return
  setDraftInput(cible.id, message.content)
  setAppNotice((current) =>
    newestNotice(current, {
      text: texteFil('revenir.fait', { chemin: retour.chemin })
    })
  )
  if (busyConversationsRef.current.has(source)) return
  await loadConv(cible)
  requestAnimationFrame(() => composerRef.current?.focusAt(-1))
}

/**
 * Une branche du fil NÉE dans sa copie séparée (2026-10-21) : le dossier part AVEC la
 * branche (`fork(…, { dossier })`, ou la création d'un fil neuf quand il n'y a rien à copier), et
 * la réponse est RELUE. Mesuré avant : la branche était créée puis rangée par un second appel dont
 * l'échec n'était pas lu — elle s'ouvrait, recevait la demande et travaillait dans le dossier
 * PARTAGÉ. Un processus principal d'avant ce correctif ignore `dossier` : la relecture le voit.
 * fix-ok: cause mesurée (rejeu du 2026-10-21) — rattachement par un 2e appel dont l'échec n'était pas lu. Sans la relecture ci-dessous, 2 tests rouges (revenir-au-tour, trois-facons) ; sans `{ dossier }` passé au fork, 3 rouges. Entrée décisive : une branche rendue sans `projectPath`.
 */
export async function brancheDansLaCopie(
  ctx: GestesFilCtx,
  source: string,
  ancre: string | undefined,
  chemin: string,
  titre: string
): Promise<{ ok: true; id: string } | { ok: false; raison: string }> {
  const { refreshRuntimeIdentity } = ctx
  const attendu = canonicalProjectPath(chemin)
  try {
    let branche: { id?: string; projectPath?: string } | undefined
    if (ancre) {
      branche = (await window.api.conversationsFork(source, ancre, { dossier: chemin })) as Conv
    } else {
      const identity = await refreshRuntimeIdentity()
      branche = await window.api.conversationsCreate({
        title: titre,
        category: identity.provider,
        provider: identity.provider,
        projectPath: chemin
      })
    }
    if (!branche?.id) return { ok: false, raison: texteFil('branche.refusee') }
    if (!attendu || branche.projectPath !== attendu)
      return { ok: false, raison: texteFil('branche.dossierNonPose') }
    return { ok: true, id: branche.id }
  } catch (erreur) {
    return { ok: false, raison: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}

/**
 * DES MESSAGES À LA SUITE DANS UN FIL : le premier part, les autres attendent dans la
 * file du fil, un par tour. C'est le même geste que les lots du scout (`pickRef`), mais
 * pour N'IMPORTE QUEL fil, affiché ou non. `filsAvecLotsRef` relâche la file d'un fil quitté, et
 * la marque `lot` la retient après une coupure par la limite d'abonnement (`lots-retenus-quota.ts`).
 */
export function envoyerALaSuite(ctx: GestesFilCtx, id: string, textes: readonly string[]): void {
  const {
    busyConversationsRef,
    enqueueMessage,
    filsAvecLotsRef,
    nextQueueEntryIdRef,
    send,
    setDirectiveReceipt
  } = ctx
  const mettreEnFile = (texte: string): void => {
    setDirectiveReceipt(
      id,
      { id: nextQueueEntryIdRef.current++, text: texte },
      'attente',
      undefined,
      { attenteMotif: 'lot' }
    )
    enqueueMessage(id, texte, undefined, undefined, { lot: true })
    filsAvecLotsRef.current.add(id)
  }
  const [premier, ...suite] = textes
  if (premier === undefined) return
  if (busyConversationsRef.current.has(id)) {
    for (const texte of textes) mettreEnFile(texte)
    return
  }
  // `keepComposerDraft` : le clic sur la carte n'est pas un envoi depuis la saisie. Sans lui,
  // « Tout ici » (fil visé = fil affiché) emportait les pièces jointes en attente de l'utilisateur
  // et vidait le texte qu'il tapait (défaut 1 du juge).
  void send(premier, { targetConversationId: id, keepComposerDraft: true })
  for (const texte of suite) mettreEnFile(texte)
}

/**
 * « Traiter » DELEGUE, au lieu d'ouvrir une liste.
 *
 * L'utilisateur a clique, lu les quatorze lignes, et demande « et apres je fais quoi avec ca ? ».
 * La liste informait sans permettre d'agir : elle deplacait le probleme sur lui. Le bouton ecrit
 * desormais le prompt dans une conversation NEUVE et l'ENVOIE : l'utilisateur a deja decide en
 * cliquant, et le tri des travaux non publies est une lecture qui ne supprime rien.
 *
 * La liste reste accessible par « Voir la liste » : elle sert a LIRE un diff, et supprimer cet
 * acces aurait ete une perte silencieuse.
 */
export async function traiterTravauxNonPublies(ctx: GestesFilCtx): Promise<void> {
  const { newConv, send, setDraftInput } = ctx
  let prompt: string | null = null
  try {
    const agents = (await window.api.getWorktreeActivity?.()) ?? []
    prompt = promptTravauxNonPublies(agents)
  } catch {
    // Activite indisponible : on ne fabrique PAS un prompt qui parlerait de travaux inconnus.
    return
  }
  if (!prompt) return
  newConv()
  setDraftInput(NEW_DRAFT_KEY, prompt)
  /*
   * ENVOYE, pas depose. Le geste s'arretait au brouillon « l'utilisateur lit et decide » : il
   * n'avait plus rien a decider — il a clique « Traiter », le prompt est un `/salvage` que lui
   * seul pouvait envoyer, et il l'a envoye a la main a chaque fois. Demande du 2026-09-03 : « je
   * passe mon temps a envoyer des salvages alors que ca pourrait etre fait tout seul ». Le tri est
   * une LECTURE qui juge par contenu et ne supprime rien sans SHA consigne : sur, borne, reversible.
   * Le prompt reste ECRIT dans le fil, donc visible et relisible.
   */
  requestAnimationFrame(() => void send(prompt))
}
