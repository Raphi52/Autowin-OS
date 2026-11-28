import {
  passageDuFil,
  ajouterAuBrouillon,
  texteDeLActionSurPassage,
  type ActionPassage
} from './passage-selectionne'
import {
  blocPourLeChat,
  apiNavigateur,
  lienAOuvrirDansLePanneau
} from './navigateur-integre-outils'
import { ouvrirDans, type OutilDuPanneau } from './panneau-outil'
import type { ElementChoisiNavigateur, ReglagesNavigateur } from '../../../shared/navigateur'
import type { ElementCible } from './alt-clic'
import type { ChatComposerHandle } from './ChatComposer'
import type { ComposerDraft } from './chat-view-types'
import type { PassageAffiche } from './BarrePassage'
import { useState, useEffect } from 'react'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les gestes sur un passage du fil et les liens vers le navigateur intégré lisent de ChatView. */
export type PassageCtx = {
  activeRef: React.RefObject<string | null>
  addFiles: (
    files: FileList | File[],
    cible?: string | undefined,
    cleDeDoublon?: (fichier: { name: string; size: number }) => string
  ) => Promise<void>
  brouillonVisible: () => string
  composerDraftKeyRef: React.RefObject<string>
  composerRef: React.RefObject<ChatComposerHandle | null>
  composersMosaiqueRef: React.RefObject<Map<string, ChatComposerHandle>>
  convViewMode: 'list' | 'mosaic'
  getComposerDraft: (key: string) => ComposerDraft
  ouvrirDansLeNavigateur: (conversationId: string, adresse: string) => Promise<void>
  reglagesNavigateurRef: React.RefObject<ReglagesNavigateur | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  setConvViewMode: React.Dispatch<React.SetStateAction<'list' | 'mosaic'>>
  setDraftError: (key: string, error: string | null) => void
  setDraftInput: (key: string, value: string) => void
  setPanneaux: (
    changer: (
      ouverts: Readonly<Record<string, OutilDuPanneau>>
    ) => Readonly<Record<string, OutilDuPanneau>>
  ) => void
  setPassageSelectionne: React.Dispatch<
    React.SetStateAction<(PassageAffiche & { fil: string | null }) | null>
  >
  texteDuComposer: () => string
}

/**
 * RÉPONDRE À UN PASSAGE (2026-10-21) : au relâchement de la souris dans le fil, une
 * sélection DANS un message fait apparaître sa barre, posée au-dessus du passage (coordonnées
 * dans le cadre du fil, celui du bouton « ↓ Dernier message »).
 */
export function surRelachementDansLeFil(ctx: PassageCtx): void {
  const { activeRef, scrollRef, setPassageSelectionne } = ctx
  const selection = window.getSelection()
  const texte = passageDuFil(selection, scrollRef.current)
  const cadre = scrollRef.current?.parentElement
  if (!texte || !selection || !cadre) {
    setPassageSelectionne(null)
    return
  }
  const zone = selection.getRangeAt(0).getBoundingClientRect()
  const bord = cadre.getBoundingClientRect()
  setPassageSelectionne({
    fil: activeRef.current,
    texte,
    gauche: Math.max(0, zone.left - bord.left),
    // La barre se pose AU-DESSUS du passage : jamais au ras du haut, où elle serait coupée.
    haut: Math.max(40, zone.top - bord.top)
  })
}

/** Le geste choisi pose son texte dans la saisie, SANS envoyer : l'utilisateur relit et envoie. */
export function agirSurPassage(ctx: PassageCtx, action: ActionPassage, texte: string): void {
  const {
    composerDraftKeyRef,
    composerRef,
    setDraftInput,
    setPassageSelectionne,
    texteDuComposer
  } = ctx
  setDraftInput(
    composerDraftKeyRef.current,
    ajouterAuBrouillon(texteDuComposer(), texteDeLActionSurPassage(action, texte))
  )
  window.getSelection()?.removeAllRanges()
  setPassageSelectionne(null)
  requestAnimationFrame(() => composerRef.current?.focusAt(-1))
}

/**
 * ÉLÉMENT CHOISI → SAISIE (lot 3/5) : même chemin que la référence d'Alt+clic (texte
 * ajouté au brouillon du fil, sans envoyer) et que l'instant de vidéo pointé (capture jointe par
 * `addFiles`, dédoublonnée par NOM : chaque nom porte l'id de l'élément).
 */
export function insererElementChoisi(ctx: PassageCtx, element: ElementChoisiNavigateur): void {
  const { addFiles, composerDraftKeyRef, composerRef, setDraftInput, texteDuComposer } = ctx
  const { texte, images } = blocPourLeChat(element)
  setDraftInput(composerDraftKeyRef.current, ajouterAuBrouillon(texteDuComposer(), texte))
  if (images.length > 0) void addFiles(images, undefined, (fichier) => fichier.name)
  requestAnimationFrame(() => composerRef.current?.focusAt(-1))
}

/**
 * LIENS DU FIL DANS LE NAVIGATEUR INTÉGRÉ (lot 3/5). Un serveur local (localhost,
 * 127.0.0.1, [::1]) s'ouvre dans le panneau ; les autres liens aussi quand le réglage « Ouvrir ici
 * les liens du chat » est actif, sinon ils gardent leur chemin actuel (`target=_blank` de
 * Markdown.tsx → navigateur du système). Un clic déjà traité (référence de fichier) ou modifié
 * (Ctrl, Maj, Cmd : « ailleurs ») n'est pas repris.
 */
export function surClicLienDuFil(ctx: PassageCtx, event: React.MouseEvent<HTMLElement>): void {
  const { activeRef, ouvrirDansLeNavigateur, reglagesNavigateurRef } = ctx
  if (event.defaultPrevented || event.button !== 0) return
  if (event.ctrlKey || event.shiftKey || event.metaKey || !(event.target instanceof Element)) return
  const lien = event.target.closest('a[href]')
  const conversationId = activeRef.current
  if (!lien || !conversationId || !apiNavigateur()) return
  const adresse = lienAOuvrirDansLePanneau(
    lien.getAttribute('href') ?? '',
    reglagesNavigateurRef.current?.ouvrirLiensDuChatIci === true
  )
  if (!adresse) return
  event.preventDefault()
  void ouvrirDansLeNavigateur(conversationId, adresse)
}

export async function ouvrirDansLeNavigateur(
  ctx: PassageCtx,
  conversationId: string,
  adresse: string
): Promise<void> {
  const { composerDraftKeyRef, setDraftError, setPanneaux } = ctx
  const api = apiNavigateur()
  if (!api) return
  setPanneaux((ouverts) => ouvrirDans(ouverts, conversationId, 'navigateur'))
  try {
    // Le même lien recliqué REPREND son onglet au lieu d'en empiler un de plus.
    const etat = await api.etat(conversationId)
    const deja = etat.onglets.find((onglet) => onglet.url === adresse)
    if (deja) await api.activerOnglet(deja.id)
    else await api.ouvrir(conversationId, adresse)
  } catch (erreur) {
    // Adresse refusée ou plafond d'onglets : dit sous la saisie, là où l'utilisateur regarde.
    setDraftError(
      composerDraftKeyRef.current,
      erreur instanceof Error ? erreur.message : String(erreur)
    )
  }
}

/**
 * L'ÉLÉMENT DÉSIGNÉ PAR ALT+CLIC (étendu à toute l'app, voir `alt-clic.ts`) :
 * sa référence s'AJOUTE au brouillon, sans envoyer, et sa capture arrive en pièce jointe. Recliqué
 * ou double-cliqué, le même élément n'est pas redit ; une image refusée (plafond de pièces jointes)
 * laisse le texte et s'explique sous la saisie (`addFiles`).
 */
export function recevoirElementCible(
  ctx: PassageCtx,
  { texte, image, fenetre }: ElementCible
): void {
  const {
    addFiles,
    brouillonVisible,
    composerRef,
    composersMosaiqueRef,
    convViewMode,
    getComposerDraft,
    setConvViewMode,
    setDraftInput
  } = ctx
  const cle = fenetre ?? brouillonVisible()
  // fix-ok: une mosaïque sans fenêtre n'a aucune saisie : le texte finissait dans un
  // brouillon que rien n'affichait. Le chat normal en a une, et l'effet de `convViewMode` l'y repose.
  if (convViewMode === 'mosaic' && composersMosaiqueRef.current.size === 0) setConvViewMode('list')
  const brouillon = getComposerDraft(cle).input
  if (!brouillon.includes(texte)) {
    const suite = ajouterAuBrouillon(brouillon, texte)
    setDraftInput(cle, suite)
    composersMosaiqueRef.current.get(cle)?.setInput(suite)
  }
  if (image) void addFiles([image], cle, (fichier) => fichier.name)
  requestAnimationFrame(() =>
    (composersMosaiqueRef.current.get(cle) ?? composerRef.current)?.focusAt(-1)
  )
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type PassageSelectionneCtx = {
  scrollRef: React.RefObject<HTMLDivElement | null>
}

/** Le passage sélectionné dans le fil et la fermeture de sa barre. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePassageSelectionne(ctx: PassageSelectionneCtx) {
  const { scrollRef } = ctx
  /**
   * Passage du fil sélectionné à la souris, où poser sa barre, et le fil où il a été pris
   * Changer de fil la fait disparaître sans effet de remise à zéro.
   */
  const [passageSelectionne, setPassageSelectionne] = useState<
    (PassageAffiche & { fil: string | null }) | null
  >(null)
  /*
   * La barre suit la sélection : elle disparaît quand la sélection se vide (clic ailleurs), quand
   * le fil défile (elle resterait à l'écran, plus collée au passage), et sur Échap.
   */
  const barrePassageOuverte = passageSelectionne !== null
  useEffect(() => {
    if (!barrePassageOuverte) return
    const fermer = (): void => setPassageSelectionne(null)
    const surSelection = (): void => {
      if (window.getSelection()?.isCollapsed !== false) fermer()
    }
    const surTouche = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') fermer()
    }
    const fil = scrollRef.current
    document.addEventListener('selectionchange', surSelection)
    document.addEventListener('keydown', surTouche)
    fil?.addEventListener('scroll', fermer, { passive: true })
    return () => {
      document.removeEventListener('selectionchange', surSelection)
      document.removeEventListener('keydown', surTouche)
      fil?.removeEventListener('scroll', fermer)
    }
    // `scrollRef` vient de `useRef` (ChatView.tsx) : stable, il ne relance rien.
  }, [barrePassageOuverte, scrollRef])
  return { passageSelectionne, setPassageSelectionne }
}
