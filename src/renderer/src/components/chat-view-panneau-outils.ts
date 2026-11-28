import { useState, useCallback, useRef, useEffect } from 'react'
import {
  OUTILS_AU_REPOS,
  poserLesPanneaux,
  signalerDans,
  oublierPartout,
  placeDuPanneau,
  navigateurOuvertDans,
  bureauxOuvertsDans,
  nouveautesDans,
  basculerNavigateurDans,
  adopterLeFilNeuf,
  ouvrirDans,
  type PanneauxParFil,
  type OutilDuPanneau
} from './panneau-outil'
import { useTenirRefAJour } from './tenir-ref-a-jour'
import { useRaccourciQuestionACote } from './question-a-cote-outils'
import { apiNavigateur } from './navigateur-integre-outils'
import type { ReglagesNavigateur } from '../../../shared/navigateur'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type PanneauOutilsCtx = {
  activeId: string | null
  activeRef: React.RefObject<string | null>
  convViewMode: 'list' | 'mosaic'
  demandeBureaux: number
  isActive: boolean
}

/** Le panneau d'outils du fil : navigateur intégré, bureaux cachés, question à côté. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePanneauOutils(ctx: PanneauOutilsCtx) {
  const { activeId, activeRef, convViewMode, demandeBureaux, isActive } = ctx
  /*
   * NAVIGATEUR INTÉGRÉ DU CHAT (lot 3/5) : panneau ouvert ou fermé (Ctrl+Shift+B, bouton
   * de l'en-tête). Une page que l'agent ouvre dans le fil actif ne l'ouvre plus : elle ajoute 1 au
   * compteur rouge du globe (voir `panneau-outil.ts`). Les onglets déjà vus par fil vivent dans une
   * REF : un événement d'état (chargement, titre) ne re-rend pas la vue chat, seul un onglet neuf le fait.
   * UN SEUL PANNEAU À LA FOIS (2026-10-31) : navigateur et Bureaux cachés se partagent cette
   * valeur, parce qu'à 1280 px les deux ensemble ne laissent plus de place au fil. Une valeur unique
   * rend « les deux ouverts » impossible à écrire, là où deux booléens auraient dû se fermer l'un l'autre.
   * Chaque fil retient le sien : ouvert dans un fil, il ne suit pas l'utilisateur dans un autre
   * (voir `panneau-outil.ts`).
   */
  const [outils, setOutils] = useState(OUTILS_AU_REPOS)
  const { panneaux } = outils
  /** Toute ouverture passe ici : le panneau ouvert efface son compteur dans le même état. */
  const setPanneaux = useCallback(
    (changer: (ouverts: PanneauxParFil) => PanneauxParFil): void =>
      setOutils((avant) => poserLesPanneaux(avant, changer(avant.panneaux))),
    []
  )
  const signalerNouveaute = useCallback(
    (place: string, outil: OutilDuPanneau, cles: readonly string[]): void =>
      setOutils((avant) => signalerDans(avant, place, outil, cles)),
    []
  )
  const oublierNouveaute = useCallback(
    (outil: OutilDuPanneau, cle: string): void =>
      setOutils((avant) => oublierPartout(avant, outil, cle)),
    []
  )
  const placePanneau = placeDuPanneau(activeId, convViewMode === 'mosaic')
  const placePanneauRef = useRef(placePanneau)
  useTenirRefAJour(placePanneauRef, placePanneau)
  const navigateurOuvert = navigateurOuvertDans(panneaux, activeId)
  const bureauxOuverts = bureauxOuvertsDans(panneaux, placePanneau)
  const pagesNonVues = nouveautesDans(outils, activeId, 'navigateur')
  const bureauxNonVus = nouveautesDans(outils, placePanneau, 'bureaux')
  const basculerNavigateur = (): void =>
    setPanneaux((ouverts) => basculerNavigateurDans(ouverts, activeRef.current))
  const adopterPanneauDuFilNeuf = (conversationId: string): void =>
    setPanneaux((ouverts) => adopterLeFilNeuf(ouverts, conversationId))
  // Une demande venue d'ailleurs (menu de commandes, agent) rouvre le panneau du fil affiché, même
  // refermé ; une référence à zéro et pas à la prop : une demande faite avant le montage compte aussi.
  // Elle attend que le montage ait rouvert le fil actif de l'app : servie avant, elle ouvrait le
  // panneau sur le fil neuf, que ce fil rouvert cachait aussitôt.
  const [filDuMontagePose, setFilDuMontagePose] = useState(false)
  const demandeBureauxVueRef = useRef(0)
  useEffect(() => {
    if (!filDuMontagePose || demandeBureaux === demandeBureauxVueRef.current) return
    demandeBureauxVueRef.current = demandeBureaux
    setPanneaux((ouverts) => ouvrirDans(ouverts, placePanneauRef.current, 'bureaux'))
  }, [demandeBureaux, filDuMontagePose, setPanneaux])
  // Question à côté : Ctrl+;, fil unique. Son état de saisie vit dans son composant.
  const [questionACoteOuverte, setQuestionACoteOuverte] = useState(false)
  useRaccourciQuestionACote(isActive && convViewMode !== 'mosaic' && Boolean(activeId), () =>
    setQuestionACoteOuverte((ouverte) => !ouverte)
  )
  const reglagesNavigateurRef = useRef<ReglagesNavigateur | null>(null)
  const ongletsConnusRef = useRef(new Map<string, Set<string>>())
  useEffect(() => {
    const api = apiNavigateur()
    if (!api) return
    void api.reglages.lire().then((lus) => {
      reglagesNavigateurRef.current = lus
    })
    return api.surEtat((etat) => {
      const connus = ongletsConnusRef.current.get(etat.conversationId)
      const ids = etat.onglets.map((onglet) => onglet.id)
      ongletsConnusRef.current.set(etat.conversationId, new Set(ids))
      // Fil pas encore relu : on apprend ses onglets sans compter — ce n'est pas une ouverture vue.
      if (!connus || etat.conversationId !== activeRef.current) return
      const neufs = ids.filter((id) => !connus.has(id))
      if (neufs.length) signalerNouveaute(etat.conversationId, 'navigateur', neufs)
    })
    // `activeRef` vient de `useRef` (ChatView.tsx) : stable, il ne relance rien.
  }, [signalerNouveaute, activeRef])
  useEffect(() => {
    const api = apiNavigateur()
    if (!api || !activeId) return
    void api.etat(activeId).then((etat) => {
      if (!ongletsConnusRef.current.has(activeId)) {
        ongletsConnusRef.current.set(activeId, new Set(etat.onglets.map((onglet) => onglet.id)))
      }
    })
  }, [activeId])
  useEffect(() => {
    // Fil unique seulement : en mosaïque, le panneau n'a pas de place à côté d'un fil.
    if (!isActive || convViewMode === 'mosaic') return
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return
      // Sans fil ouvert, pas d'onglets à montrer : le raccourci ne bascule rien d'invisible.
      if (event.key.toLowerCase() !== 'b' || !activeRef.current) return
      event.preventDefault()
      setPanneaux((ouverts) => basculerNavigateurDans(ouverts, activeRef.current))
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
    // `activeRef` vient de `useRef` (ChatView.tsx) : stable, il ne relance rien.
  }, [isActive, convViewMode, setPanneaux, activeRef])
  return {
    setPanneaux,
    signalerNouveaute,
    oublierNouveaute,
    placePanneau,
    navigateurOuvert,
    bureauxOuverts,
    pagesNonVues,
    bureauxNonVus,
    basculerNavigateur,
    adopterPanneauDuFilNeuf,
    setFilDuMontagePose,
    questionACoteOuverte,
    setQuestionACoteOuverte,
    reglagesNavigateurRef
  }
}
