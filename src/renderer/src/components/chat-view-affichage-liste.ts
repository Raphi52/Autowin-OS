import { useState, useRef, useEffect } from 'react'
import {
  lireDensiteConversations,
  clampConversationPaneWidth,
  type DensiteConversation
} from './chat-view-model'
import type { Msg, Conv } from './chat-view-types'
import { useClampDansFenetre } from './useClampDansFenetre'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type AffichageDeLaListeCtx = {
  repeindreLesFenetresVides: (ids: string[], fils: Record<string, Msg[]>) => void
}

/** L'affichage de la liste des conversations : mosaïque (fenêtres et fils), mode, densité, largeur. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useAffichageDeLaListe(ctx: AffichageDeLaListeCtx) {
  const { repeindreLesFenetresVides } = ctx
  /**
   * Mode d'affichage du panneau conversations. PERSISTE en localStorage comme la largeur du
   * panneau : c'est une preference locale d'affichage, elle n'a rien a faire dans le store disque.
   */
  /**
   * Conversations OUVERTES en mosaique, dans l'ordre d'ouverture. Persiste : rouvrir l'app doit
   * rendre le meme plan de travail, comme le mode d'affichage lui-meme.
   */
  const [mosaicIds, setMosaicIds] = useState<string[]>(() => {
    try {
      const brut = window.localStorage.getItem('autowin.chat.mosaicOpenIds')
      const lu: unknown = brut ? JSON.parse(brut) : []
      return Array.isArray(lu) ? lu.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  })
  const mosaicIdsRef = useRef(mosaicIds)
  useEffect(() => {
    mosaicIdsRef.current = mosaicIds
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', JSON.stringify(mosaicIds))
  }, [mosaicIds])
  /** Fils PEINTS des fenetres ouvertes — le fil actif garde son propre etat `messages`. */
  const [mosaicFils, setMosaicFils] = useState<Record<string, Msg[]>>({})
  const repeindreLesFenetresVidesRef = useRef(repeindreLesFenetresVides)
  // Corps posé en fin de composant : voir `useTenirRefAJour(repeindreLesFenetresVidesRef, …)`.
  useEffect(
    () => repeindreLesFenetresVidesRef.current(mosaicIds, mosaicFils),
    [mosaicIds, mosaicFils]
  )
  const [convViewMode, setConvViewMode] = useState<'list' | 'mosaic'>(() =>
    window.localStorage.getItem('autowin.chat.conversationsViewMode') === 'mosaic'
      ? 'mosaic'
      : 'list'
  )
  /**
   * Le mode d'affichage lu depuis un ECOUTEUR monte une seule fois (`prefill`, deps []) : sans cette
   * ref, il verrait eternellement le mode du premier rendu et un message pre-ecrit atterrirait dans
   * le chat unique... qui n'est pas affiche en mosaique (bug mesure le 01/09, « Faire
   * reparer » semblait mort).
   */
  const convViewModeRef = useRef(convViewMode)
  useEffect(() => {
    convViewModeRef.current = convViewMode
    window.localStorage.setItem('autowin.chat.conversationsViewMode', convViewMode)
  }, [convViewMode])
  /**
   * DENSITE de la liste — cran CHOISI, independant de la largeur de la colonne, et memorise comme
   * elle. Avant ce reglage, le rendu serre n'etait atteignable qu'en tirant la colonne sous 170 px :
   * on ne pouvait pas avoir a la fois des titres larges et des lignes serrees (demande du
   * 2026-09-17). Le cran par defaut est celui d'AVANT, pour que personne ne voie sa liste changer
   * sans l'avoir demande.
   */
  const [convDensity, setConvDensity] = useState<DensiteConversation>(() =>
    lireDensiteConversations(window.localStorage.getItem('autowin.chat.conversationsDensity'))
  )
  useEffect(() => {
    window.localStorage.setItem('autowin.chat.conversationsDensity', convDensity)
  }, [convDensity])
  const [conversationsPaneWidth, setConversationsPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('autowin.chat.conversationsPaneWidth'))
    return clampConversationPaneWidth(Number.isFinite(saved) && saved > 0 ? saved : 232)
  })
  return {
    mosaicIds,
    setMosaicIds,
    mosaicIdsRef,
    mosaicFils,
    setMosaicFils,
    repeindreLesFenetresVidesRef,
    convViewMode,
    setConvViewMode,
    convViewModeRef,
    convDensity,
    setConvDensity,
    conversationsPaneWidth,
    setConversationsPaneWidth
  }
}

/** Les trois menus contextuels de la liste (conversation, dossier, branche), tenus dans la fenêtre. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useMenusDeLaListe() {
  // Menu ⋮ d'une conversation, rendu en position fixe (déborde du conteneur scrollable).
  const [convMenu, setConvMenu] = useState<{ conv: Conv; top: number; left: number } | null>(null)
  /*
    Menu de choix du dossier de travail. `conv: null` = la cible est le PROCHAIN fil, pas une
    conversation existante : la pastille de la barre du haut s'ouvre aussi quand aucun fil n'est
    ouvert, et le dossier choisi est alors garde puis pose sur la conversation des sa creation.
  */
  const convMenuRef = useRef<HTMLDivElement | null>(null)
  const brancheMenuRef = useRef<HTMLDivElement | null>(null)
  const convFolderMenuRef = useRef<HTMLDivElement | null>(null)
  const [convFolderMenu, setConvFolderMenu] = useState<{
    conv: Conv | null
    /**
     * LOT de conversations cochées (mode sélection). Champ DISTINCT de `conv` : `conv: null` veut
     * déjà dire « dossier du prochain fil » (voir `choisirDossier`) ; coder le lot par `null`
     * rangerait en silence le prochain fil au lieu des conversations cochées.
     */
    ids?: string[]
    top: number
    left: number
    /**
     * QUEL des deux rangements ce menu sert.
     *
     * `categorie` = le classement de la barre laterale (un libelle libre). `dossier` = le
     * repertoire de travail de l'agent (un vrai chemin). Les deux tenaient dans une seule liste :
     * on choisissait sa categorie sous une pile de chemins de depots qui n'avaient rien a y faire
     * (2026-09-17). Le choix se fait donc a l'etape D'AVANT — l'entree cliquee dans le
     * menu de la conversation dit lequel des deux on veut — et ce menu-ci n'en montre qu'un.
     */
    mode: 'categorie' | 'dossier'
  } | null>(null)
  /*
   * Menu de choix de la branche, ouvert depuis la barre du haut du chat.
   *
   * `branches: null` = la liste n'est pas encore lue. La lecture part a l'OUVERTURE du menu, en
   * asynchrone : recenser les branches pendant le dessin de la fenetre a deja fige l'interface
   * plusieurs secondes.
   */
  const [brancheMenu, setBrancheMenu] = useState<{
    top: number
    left: number
    branches: string[] | null
    /** Motif de refus rendu par l'application (arbre sale, branche absente). Affiche tel quel. */
    refus?: string
  } | null>(null)
  // Ces trois menus sont poses aux coordonnees de leur bouton : pres du bas ou du bord droit,
  // une partie sortait de la fenetre et devenait inatteignable. On les y ramene.
  useClampDansFenetre(convMenuRef, convMenu !== null)
  useClampDansFenetre(convFolderMenuRef, convFolderMenu !== null)
  useClampDansFenetre(brancheMenuRef, brancheMenu !== null)
  return {
    convMenu,
    setConvMenu,
    convMenuRef,
    brancheMenuRef,
    convFolderMenuRef,
    convFolderMenu,
    setConvFolderMenu,
    brancheMenu,
    setBrancheMenu
  }
}
