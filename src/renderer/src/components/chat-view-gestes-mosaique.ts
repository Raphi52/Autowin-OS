import { hydraterFilStocke, NEW_DRAFT_KEY } from './chat-view-outils'
import { demandeDeSignalement } from './signaler-fils'
import type { Conv, Msg } from './chat-view-types'
import type { ChatComposerHandle } from './ChatComposer'
import type { ChatRuntimeIdentity } from './chat-view-model'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les gestes des fenêtres de la mosaïque et du nouveau fil lisent de ChatView. */
export type GestesMosaiqueCtx = {
  activeRef: React.RefObject<string | null>
  composerRef: React.RefObject<ChatComposerHandle | null>
  composersMosaiqueRef: React.RefObject<Map<string, ChatComposerHandle>>
  convsRef: React.RefObject<Conv[]>
  convViewModeRef: React.RefObject<'list' | 'mosaic'>
  dossierNouveauFilRef: React.RefObject<string | null>
  fermerFenetreMosaique: (id: string) => void
  followTailRef: React.RefObject<boolean>
  liveMessagesRef: React.RefObject<Map<string, Msg[]>>
  loadConv: (c: Conv, filDeRepli?: readonly Msg[] | undefined) => Promise<void>
  loadConversationRequestRef: React.RefObject<number>
  mosaicIdsRef: React.RefObject<string[]>
  newConv: () => void
  nouvelleFenetreMosaique: (brouillon?: string | undefined) => Promise<void>
  ouvrirDansMosaique: (id: string) => Promise<void>
  poserCompteArme: (conversationId: string) => Promise<void>
  poserDansFenetreMosaique: (id: string, texte: string) => void
  poserModeleArme: (conversationId: string) => Promise<void>
  refreshRuntimeIdentity: (forceModels?: boolean) => Promise<ChatRuntimeIdentity>
  resetConvLoad: () => void
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  setAtterrissageDemande: React.Dispatch<React.SetStateAction<number>>
  setConvs: React.Dispatch<React.SetStateAction<Conv[]>>
  setConvViewMode: React.Dispatch<React.SetStateAction<'list' | 'mosaic'>>
  setDraftInput: (key: string, value: string) => void
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setListeTelOuverte: React.Dispatch<React.SetStateAction<boolean>>
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>
  setMosaicFils: React.Dispatch<React.SetStateAction<Record<string, Msg[]>>>
  setMosaicIds: React.Dispatch<React.SetStateAction<string[]>>
  switchComposerDraft: (key: string) => void
}

/**
 * OUVRIR une conversation DE PLUS dans la mosaique (elle ne remplace pas l'active). Le fil vient
 * du cache vivant s'il existe, sinon du store : une fenetre vide le temps d'un aller-retour IPC
 * serait indiscernable d'une conversation reellement vide.
 */
export async function ouvrirDansMosaique(ctx: GestesMosaiqueCtx, id: string): Promise<void> {
  const { liveMessagesRef, mosaicIdsRef, setMosaicFils, setMosaicIds } = ctx
  if (!mosaicIdsRef.current.includes(id)) mosaicIdsRef.current = [...mosaicIdsRef.current, id]
  setMosaicIds((courant) => (courant.includes(id) ? courant : [...courant, id]))
  // UN CACHE VIDE EST UNE ABSENCE, PAS UN FIL — meme regle qu'au chat plein. Une
  // conversation ouverte alors qu'elle etait encore vide laisse un tableau vide ici ; l'agent la
  // remplit ensuite cote main, sans passer par ce cache. Un `if (cache)` laissait donc ce vide
  // gagner sur un store PLEIN et la fenetre revenait « creuse » (« Aucun message. »).
  const cache = liveMessagesRef.current.get(id)
  if (cache && cache.length > 0) {
    setMosaicFils((courant) => ({ ...courant, [id]: cache }))
    return
  }
  try {
    const detail = (await window.api.conversation(id)) as Conv | null
    const fil = hydraterFilStocke(detail?.messages ?? [])
    liveMessagesRef.current.set(id, fil)
    setMosaicFils((courant) => ({ ...courant, [id]: fil }))
  } catch {
    setMosaicFils((courant) => ({ ...courant, [id]: [] }))
  }
}

/**
 * NOUVELLE conversation DANS la mosaique. Elle est creee tout de suite cote store (au lieu d'un
 * brouillon sans identite) : une fenetre a besoin d'un id des sa premiere frappe — c'est lui qui
 * porte le brouillon, les pieces jointes, le tour et sa peinture. `brouillon` : texte posé dans
 * la saisie de la fenêtre neuve (« Signaler un problème »).
 */
export async function nouvelleFenetreMosaique(
  ctx: GestesMosaiqueCtx,
  brouillon?: string
): Promise<void> {
  const {
    dossierNouveauFilRef,
    liveMessagesRef,
    ouvrirDansMosaique,
    poserCompteArme,
    poserDansFenetreMosaique,
    poserModeleArme,
    refreshRuntimeIdentity,
    setConvs
  } = ctx
  const identity = await refreshRuntimeIdentity()
  const creee = await window.api.conversationsCreate({
    // Reste en français : titre PROVISOIRE que le stockage reconnaît pour le remplacer par le
    // premier message (voir plus bas, « provisoire « Nouvelle conversation » »).
    title: 'Nouvelle conversation',
    category: identity.provider,
    provider: identity.provider
  })
  // Le dossier de travail choisi pour un fil neuf se pose AVANT le premier tour.
  const dossierArme = dossierNouveauFilRef.current
  if (dossierArme) await window.api.conversationsSetProject?.(creee.id, dossierArme)
  // Le modèle et le compte armés, eux aussi, se posent AVANT le premier tour (le main les lit alors).
  await poserModeleArme(creee.id)
  await poserCompteArme(creee.id)
  setConvs((courant) =>
    courant.some((c) => c.id === creee.id)
      ? courant
      : [
          {
            ...creee,
            ...(dossierArme ? { projectPath: dossierArme } : {}),
            updatedAt: Date.now(),
            messages: []
          } as unknown as Conv,
          ...courant
        ]
  )
  liveMessagesRef.current.set(creee.id, [])
  await ouvrirDansMosaique(creee.id)
  if (brouillon) poserDansFenetreMosaique(creee.id, brouillon)
}

/**
 * Pose un brouillon dans la saisie d'une fenêtre de la mosaïque, curseur en fin de texte. La
 * fenêtre vient souvent d'être ajoutée : son composer peut n'être pas encore monté au premier
 * repaint. On retente quelques images avant d'abandonner, plutôt qu'un délai deviné.
 */
export function poserDansFenetreMosaique(ctx: GestesMosaiqueCtx, id: string, texte: string): void {
  const { composersMosaiqueRef, setDraftInput } = ctx
  setDraftInput(id, texte)
  let restantes = 5
  const poser = (): void => {
    const composer = composersMosaiqueRef.current.get(id)
    if (composer) {
      composer.setInput(texte)
      composer.focusAt(-1)
      return
    }
    if (--restantes > 0) requestAnimationFrame(poser)
  }
  requestAnimationFrame(poser)
}

/**
 * « Signaler un problème » sur un fil ou une sélection : un fil NEUF prérempli de
 * `/kaizen conv-N …` (`signaler-fils.ts`), jamais envoyé, car c'est à l'utilisateur de dire ce
 * qui n'a pas marché. En mosaïque, le fil neuf est une fenêtre de plus, comme « Nouveau fil ».
 */
export function signalerFils(ctx: GestesMosaiqueCtx, ids: readonly string[]): void {
  const { composerRef, convViewModeRef, newConv, nouvelleFenetreMosaique, setDraftInput } = ctx
  if (ids.length === 0) return
  const demande = demandeDeSignalement(ids)
  if (convViewModeRef.current === 'mosaic') {
    void nouvelleFenetreMosaique(demande)
    return
  }
  newConv()
  setDraftInput(NEW_DRAFT_KEY, demande)
  requestAnimationFrame(() => composerRef.current?.focusAt(-1))
}

/** Le MEME clic ouvre ou referme : en mosaique la liste est un jeu d'interrupteurs. */
export async function basculerDansMosaique(ctx: GestesMosaiqueCtx, id: string): Promise<void> {
  const { fermerFenetreMosaique, mosaicIdsRef, ouvrirDansMosaique } = ctx
  if (mosaicIdsRef.current.includes(id)) {
    fermerFenetreMosaique(id)
    return
  }
  await ouvrirDansMosaique(id)
}

/** Quitter la mosaique EN emportant la conversation cliquee : elle devient le fil unique actif. */
export async function ouvrirSeuleDepuisMosaique(ctx: GestesMosaiqueCtx, id: string): Promise<void> {
  const { convsRef, loadConv, setAtterrissageDemande, setConvViewMode } = ctx
  setConvViewMode('list')
  const cible = convsRef.current.find((c) => c.id === id)
  if (cible) await loadConv(cible)
  // Le fil plein ecran vient d'etre monte : il nait en haut. On demande explicitement son
  // atterrissage (bas du fil, ou reprise de lecture memorisee), car `loadConv` peut n'avoir
  // re-rendu AUCUN message quand la conversation ouverte etait deja l'active.
  setAtterrissageDemande((tour) => tour + 1)
}

export function fermerFenetreMosaique(ctx: GestesMosaiqueCtx, id: string): void {
  const { mosaicIdsRef, setMosaicFils, setMosaicIds } = ctx
  mosaicIdsRef.current = mosaicIdsRef.current.filter((autre) => autre !== id)
  setMosaicIds((courant) => courant.filter((autre) => autre !== id))
  setMosaicFils((courant) => {
    const suite = { ...courant }
    delete suite[id]
    return suite
  })
}

/** Referme TOUTES les fenetres d'un coup : la mosaique reste, elle redevient vide. */
export function fermerToutesFenetresMosaique(ctx: GestesMosaiqueCtx): void {
  const { mosaicIdsRef, setMosaicFils, setMosaicIds } = ctx
  mosaicIdsRef.current = []
  setMosaicIds([])
  setMosaicFils({})
}

export function newConv(ctx: GestesMosaiqueCtx): void {
  const {
    activeRef,
    followTailRef,
    loadConversationRequestRef,
    refreshRuntimeIdentity,
    resetConvLoad,
    setActiveId,
    setHasNewActivity,
    setListeTelOuverte,
    setMessages,
    switchComposerDraft
  } = ctx
  loadConversationRequestRef.current += 1
  resetConvLoad()
  followTailRef.current = true
  setHasNewActivity(false)
  activeRef.current = null
  setActiveId(null)
  setListeTelOuverte(false)
  setMessages([])
  switchComposerDraft(NEW_DRAFT_KEY)
  void refreshRuntimeIdentity(true)
}

/**
 * RE-HYDRATATION apres rafraichissement. `mosaicIds` persiste en localStorage, `mosaicFils` non :
 * au remontage, les fenetres revenaient avec leur titre mais un fil VIDE (« Aucun message. »),
 * indiscernable d'une perte de donnees. On recharge donc le fil de toute fenetre non peinte.
 */
export function repeindreLesFenetresVides(
  ctx: GestesMosaiqueCtx,
  ids: string[],
  fils: Record<string, Msg[]>
): void {
  const { ouvrirDansMosaique } = ctx
  for (const id of ids) {
    if (fils[id]) continue
    void ouvrirDansMosaique(id)
  }
}
