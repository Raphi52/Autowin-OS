import { memoriserBrouillon } from './brouillons-persistes'
import {
  cleNomTaille,
  MAX_ATTACHMENTS,
  texteFil,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_BYTES
} from './chat-view-outils'
import { encodeAttachment } from './chat-attachments'
import type { ComposerDraft, ChatAttachment } from './chat-view-types'
import type { ChatComposerHandle } from './ChatComposer'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les brouillons du composer et les pièces jointes lisent de ChatView. */
export type BrouillonsCtx = {
  activeRef: React.RefObject<string | null>
  composerDraftKeyRef: React.RefObject<string>
  composerDraftsRef: React.RefObject<Map<string, ComposerDraft>>
  composerRef: React.RefObject<ChatComposerHandle | null>
  composerSelectionGenerationRef: React.RefObject<number>
  composersMosaiqueRef: React.RefObject<Map<string, ChatComposerHandle>>
  convViewMode: 'list' | 'mosaic'
  getComposerDraft: (key: string) => ComposerDraft
  setAttachmentError: React.Dispatch<React.SetStateAction<string | null>>
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>
  setDraftAttachments: (
    key: string,
    update: (current: ChatAttachment[]) => ChatAttachment[]
  ) => void
  setDraftError: (key: string, error: string | null) => void
  setDraftsVersion: React.Dispatch<React.SetStateAction<number>>
}

export function setDraftInput(ctx: BrouillonsCtx, key: string, value: string): void {
  const { composerDraftKeyRef, composerDraftsRef, composerRef, getComposerDraft } = ctx
  composerDraftsRef.current.set(key, { ...getComposerDraft(key), input: value })
  // Le texte part AUSSI sur le stockage local, a chaque frappe : c'est le seul endroit ou il
  // survit a un rechargement de la fenetre. Un vide efface l'entree (envoi, nettoyage).
  memoriserBrouillon(key, value)
  if (composerDraftKeyRef.current === key) composerRef.current?.setInput(value)
}

export function setDraftAttachments(
  ctx: BrouillonsCtx,
  key: string,
  update: (current: ChatAttachment[]) => ChatAttachment[]
): void {
  const {
    composerDraftKeyRef,
    composerDraftsRef,
    getComposerDraft,
    setAttachments,
    setDraftsVersion
  } = ctx
  const draft = getComposerDraft(key)
  const next = update(draft.attachments)
  composerDraftsRef.current.set(key, { ...draft, attachments: next })
  if (composerDraftKeyRef.current === key) setAttachments(next)
  // Les brouillons vivent dans une REF (une frappe ne doit pas re-rendre la vue). La mosaique
  // affiche pourtant les pieces jointes de N brouillons a la fois : ce compteur est le SEUL
  // signal de rendu, et il ne bouge que sur une piece jointe, jamais sur une frappe.
  setDraftsVersion((n) => n + 1)
}

/**
 * Croix d'une pièce jointe du composer plein. La clé du brouillon se lit AU CLIC, comme avant la
 * mise en commun : le brouillon courant peut avoir changé depuis le rendu.
 */
export function retirerPieceJointeDuBrouillonCourant(ctx: BrouillonsCtx, fileIndex: number): void {
  const { composerDraftKeyRef, setDraftAttachments } = ctx
  setDraftAttachments(composerDraftKeyRef.current, (current) =>
    current.filter((_, index) => index !== fileIndex)
  )
}

export function setDraftError(ctx: BrouillonsCtx, key: string, error: string | null): void {
  const {
    composerDraftKeyRef,
    composerDraftsRef,
    getComposerDraft,
    setAttachmentError,
    setDraftsVersion
  } = ctx
  composerDraftsRef.current.set(key, { ...getComposerDraft(key), error })
  if (composerDraftKeyRef.current === key) setAttachmentError(error)
  setDraftsVersion((n) => n + 1)
}

export function switchComposerDraft(ctx: BrouillonsCtx, key: string): void {
  const {
    composerDraftKeyRef,
    composerDraftsRef,
    composerRef,
    composerSelectionGenerationRef,
    getComposerDraft,
    setAttachmentError,
    setAttachments
  } = ctx
  composerSelectionGenerationRef.current += 1
  composerDraftKeyRef.current = key
  const draft = getComposerDraft(key)
  composerDraftsRef.current.set(key, draft)
  composerRef.current?.setInput(draft.input)
  setAttachments(draft.attachments)
  setAttachmentError(draft.error)
  // Ouvrir une conversation (existante ou neuve) pose le curseur DANS le champ de saisie :
  // sans ça, chaque bascule coûtait un clic de plus (demandé le 2026-09-06).
  requestAnimationFrame(() => composerRef.current?.focus())
}

export async function addFiles(
  ctx: BrouillonsCtx,
  files: FileList | File[],
  cible?: string,
  cleDeDoublon: (fichier: { name: string; size: number }) => string = cleNomTaille
): Promise<void> {
  const { composerDraftKeyRef, getComposerDraft, setDraftAttachments, setDraftError } = ctx
  /*
   * PLUS DE REFUS SILENCIEUX PENDANT UN TOUR (2026-09-01).
   *
   * Ces deux lignes rendaient tout ajout de fichier inopérant tant qu'un tour tournait —
   * collage, dépôt, bouton fichier — sans un mot à l'écran : « ça la met juste dans la barre
   * comme si je la collais pas pendant un tour ». La pièce jointe s'attache donc maintenant
   * comme hors tour ; elle n'est PAS envoyée à l'agent en vol (le canal d'orientation ne porte
   * que du texte, `injectDirective`), elle attend le prochain message. Les plafonds ci-dessous
   * (nombre, 10 Mo par fichier, 20 Mo au total) restent les seuls refus, et ils PARLENT.
   */
  const originDraftKey = cible ?? composerDraftKeyRef.current
  const originDraft = getComposerDraft(originDraftKey)
  setDraftError(originDraftKey, null)
  const seen = new Set(originDraft.attachments.map(cleDeDoublon))
  const candidates = Array.from(files).filter((file) => {
    const key = cleDeDoublon(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (originDraft.attachments.length + candidates.length > MAX_ATTACHMENTS) {
    setDraftError(originDraftKey, texteFil('pj.maximum', { max: MAX_ATTACHMENTS }))
    return
  }
  const oversized = candidates.find((file) => file.size > MAX_ATTACHMENT_BYTES)
  if (oversized) {
    setDraftError(originDraftKey, texteFil('pj.tropGros', { nom: oversized.name }))
    return
  }
  /*
   * IMAGE VIDE (2026-10-17). Le presse-papiers peut annoncer une image sans en livrer les
   * octets : Chromium rend alors une `image.png` de 0 octet (`size: 0`, pas
   * de miniature, fichier vide dans chat-artifacts). Attachée, elle partait à l'agent comme une
   * vraie capture — l'utilisateur croyait l'avoir montrée, l'agent ne recevait rien. Ici, au seul
   * moment où l'utilisateur peut encore la recopier, on le lui dit.
   */
  const imageVide = candidates.find((file) => file.size === 0 && file.type.startsWith('image/'))
  if (imageVide) {
    setDraftError(originDraftKey, texteFil('pj.imageVide', { nom: imageVide.name }))
    return
  }
  const totalBytes =
    originDraft.attachments.reduce((sum, file) => sum + file.size, 0) +
    candidates.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_ATTACHMENTS_BYTES) {
    setDraftError(originDraftKey, texteFil('pj.totalTropGros'))
    return
  }
  try {
    const encoded = await Promise.all(candidates.map(encodeAttachment))
    // Dédoublonner AUSSI sur le brouillon ACTUEL : deux ajouts lancés avant la fin du
    // premier encodage se comparaient tous deux au brouillon d'AVANT (`originDraft`), et le même
    // instant vidéo pointé deux fois joignait deux PNG.
    // fix-ok: cause mesurée — le filtre ne comparait qu'à `originDraft`, lu avant l'await de l'encodage : sans ce second filtre, deux clics sans attente joignent 2 PNG et ChatView.pointer-video.test.tsx échoue (code 1) ; avec lui, 1 PNG (code 0).
    setDraftAttachments(originDraftKey, (current) => {
      const presents = new Set(current.map(cleDeDoublon))
      return [...current, ...encoded.filter((piece) => !presents.has(cleDeDoublon(piece)))]
    })
  } catch (error) {
    setDraftError(
      originDraftKey,
      texteFil('pj.lectureImpossible', {
        raison: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

/** Le texte en cours de frappe, lu dans la carte des brouillons (le composer y écrit à chaque touche). */
export function texteDuComposer(ctx: BrouillonsCtx): string {
  const { composerDraftKeyRef, getComposerDraft } = ctx
  return getComposerDraft(composerDraftKeyRef.current).input
}

/** La saisie qui reçoit un élément venu d'ailleurs : en mosaïque, une fenêtre à l'écran. */
export function brouillonVisible(ctx: BrouillonsCtx): string {
  const { activeRef, composerDraftKeyRef, composersMosaiqueRef, convViewMode } = ctx
  if (convViewMode !== 'mosaic') return composerDraftKeyRef.current
  const fenetres = [...composersMosaiqueRef.current.keys()]
  const actif = activeRef.current
  return actif && fenetres.includes(actif) ? actif : (fenetres[0] ?? composerDraftKeyRef.current)
}
