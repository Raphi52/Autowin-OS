import { useCallback, useRef, useEffect, useState, useMemo, Fragment } from 'react'
import {
  newestNotice,
  texteFil,
  traceSilentFailure,
  type LienDeLot,
  liensDesPlans,
  memesLiens,
  chefDeLaSuperConv,
  deposable,
  rangerSousLeurChef,
  LigneConversation
} from './chat-view-outils'
import type { Conv } from './chat-view-types'
import { estCheminDeDossier, canonicalProjectPath } from '../../../shared/project-path'
import { lireDossiersRetires } from './dossiers-du-chat'
import { fusionnerDossiersImportes } from './chat-dossiers-import'
import { usePlanDuChef } from './lots-mesures'
import { ongletDuFil } from './frise-des-lots'
import { filsDuPanneau, useGuetBureauxDuFil } from './guet-bureaux-du-fil'
import { lotsSousOnglets, activiteDesLots } from './lots-dans-la-liste'
import { signesDesSuperConvs } from './signe-super-conv'
import {
  groupeRecent,
  ordonnerGroupes,
  groupesVisibles,
  grouperConversations,
  estReplie
} from './conversation-groups'
import { recenceUtilisateur } from './conversation-search'
import { type ScopedLiveRun, type OrchStep } from './chat-view-model'
import { type HarnessTraceEvent, buildHarnessTimelineFromTrace } from './harness-timeline-model'
import {
  type TurnRuntimeIdentity,
  scopedRunsFromTimeline,
  mergeLiveAndPersisted
} from './subagent-thread-from-trace'
import { presenceDepuisRunsVivants } from './run-presence'
import { visibleScopedRuns } from './workflows-panel-sections'
import { useDebutProgressif } from './fil-progressif'
import { useLignesDessinees } from './liste-progressive'
import {
  messageKey,
  askReponseDuFil,
  tourDuMessageEnCours,
  finDuRaisonnementRelaye,
  lastUserPromptBefore
} from './chat-message-keys'
import { ChatMessageRow, DirectiveReceiptRow } from './ChatMessageRow'
import { noterDeclencheursListe, declencheursDeListe } from './rendu-long'
import { estNonVue } from './conversation-seen'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type ListeDesConversationsCtx = {
  active: import('./chat-view-types').Conv | undefined
  activeDirectiveReceiptsByMessage: Map<number, import('./chat-view-types').DirectiveReceipt[]>
  activeId: string | null
  annulerEnvoi: (receipt: import('./chat-view-types').DirectiveReceipt) => void
  answerAsk: (prompt: string) => void
  appNotice: import('./chat-view-outils').AppNotice | null
  basculerDansMosaique: (id: string) => Promise<void>
  basculerGroupe: (key: string, replieActuel: boolean) => void
  busy: boolean
  busyConversations: Set<string>
  conversationDateOrder: 'desc' | 'asc'
  conversationHits: import('./conversation-search').ConversationSearchHit<
    import('./chat-view-types').Conv
  >[]
  conversationsVues: import('./conversation-seen').ConversationsVues
  convQuery: string
  convs: import('./chat-view-types').Conv[]
  convSelectionMode: boolean
  convStatusFilter: 'toutes' | 'actives' | 'inactives'
  convViewMode: 'list' | 'mosaic'
  correspondancesContenu: Map<string, string>
  doitAutoLancerCandidats: (cle: string, dernier: boolean, fini: boolean) => boolean
  dossierParDefaut: string
  dossiersMemorises: string[]
  groupesReplies: Record<string, boolean>
  handleFork: (messageId: string) => undefined
  handleModifier: (messageId: string) => undefined
  handleRevenir: (messageId: string) => undefined
  isActive: boolean
  langue: import('../../../shared/langue').Langue
  liveRuns: Record<
    string,
    import('./chat-view-model').ScopedLiveRun<import('./chat-view-model').OrchStep>
  >
  loadConv: (
    c: import('./chat-view-types').Conv,
    filDeRepli?: readonly import('./chat-view-types').Msg[] | undefined
  ) => Promise<void>
  memoriserDossier: (chemin: string) => void
  messages: import('./chat-view-types').Msg[]
  mosaicIds: string[]
  onInspectTurn: ((target: import('../observatory-focus').InspectTurnTarget) => void) | undefined
  ouvrirLogin: () => void
  pickSuggestion: (prompt: string, suite?: readonly string[] | undefined) => void
  planSelection: (
    selection: import('../../../shared/plan-de-lots').SelectionAPlanifier
  ) => Promise<import('./CandidatsPickPanel').IssuePlanDeSelection>
  rangerDans: (conversationId: string, chemin?: string | null | undefined) => Promise<void>
  refineResumeDraft: (
    prompt: string,
    status: import('./chat-resume-refine').TerminalStatus,
    reason?: string | null | undefined
  ) => void
  refreshConvs: () => Promise<void>
  revealLiveAction: (mode?: 'live' | 'history', runId?: string | undefined) => void
  runs: import('./chat-view-types').RunEntry[]
  selectedConvIds: ReadonlySet<string>
  setAppNotice: React.Dispatch<React.SetStateAction<import('./chat-view-outils').AppNotice | null>>
  setConvMenu: React.Dispatch<
    React.SetStateAction<{
      conv: import('./chat-view-types').Conv
      top: number
      left: number
    } | null>
  >
  setConvSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  setDossierNouveauFil: React.Dispatch<React.SetStateAction<string | null>>
  setDossiersMemorises: React.Dispatch<React.SetStateAction<string[]>>
  setOpenImage: React.Dispatch<React.SetStateAction<{ src: string; name: string } | null>>
  setPanneauOutil: React.Dispatch<React.SetStateAction<'navigateur' | 'bureaux' | null>>
  setSelectedConvIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  setSurvole: React.Dispatch<React.SetStateAction<string | null>>
  showRuns: boolean
  surviole: string | null
  toggleConvSelection: (id: string) => void
}

/**
 * Un groupe replié cache ses fils, sauf pendant une recherche : chercher, c'est vouloir voir. Une
 * seule règle, pour le rendu comme pour le compte des lignes à dessiner.
 */
function groupeReplie(
  cle: string,
  requete: string,
  replies: Readonly<Record<string, boolean>>
): boolean {
  return !requete.trim() && estReplie(cle, replies)
}

// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useListeDesConversations(ctx: ListeDesConversationsCtx) {
  const {
    active,
    activeDirectiveReceiptsByMessage,
    activeId,
    annulerEnvoi,
    answerAsk,
    appNotice,
    basculerDansMosaique,
    basculerGroupe,
    busy,
    busyConversations,
    conversationDateOrder,
    conversationHits,
    conversationsVues,
    convQuery,
    convs,
    convSelectionMode,
    convStatusFilter,
    convViewMode,
    correspondancesContenu,
    doitAutoLancerCandidats,
    dossierParDefaut,
    dossiersMemorises,
    groupesReplies,
    handleFork,
    handleModifier,
    handleRevenir,
    isActive,
    langue,
    liveRuns,
    loadConv,
    memoriserDossier,
    messages,
    mosaicIds,
    onInspectTurn,
    ouvrirLogin,
    pickSuggestion,
    planSelection,
    rangerDans,
    refineResumeDraft,
    refreshConvs,
    revealLiveAction,
    runs,
    selectedConvIds,
    setAppNotice,
    setConvMenu,
    setConvSelectionMode,
    setDossierNouveauFil,
    setDossiersMemorises,
    setOpenImage,
    setPanneauOutil,
    setSelectedConvIds,
    setSurvole,
    showRuns,
    surviole,
    toggleConvSelection
  } = ctx
  /**
   * Pose ou retire le repère visuel d'une conversation, puis relit la liste : c'est cette relecture
   * qui fait apparaître la couleur, l'état vit sur le disque et non dans le composant.
   *
   * L'appel n'est PAS écrit `window.api.conversationsSetHighlight?.(…)`. Mesure du 2026-09-09
   * L'affichage se recharge à chaud, le processus principal NON — l'entrée de menu
   * existait donc avant le canal qui la sert. L'appel « si ça existe » ne faisait alors rien du
   * tout, sans message ni erreur : l'utilisateur a cliqué sur un bouton mort et n'avait aucun moyen
   * de le savoir. Un pont absent est un ÉTAT DE L'APPLICATION, pas un cas à ignorer : il se dit, et
   * il dit ce qui répare.
   */
  const marquerInactive = useCallback(
    async (conversationId: string, on: boolean): Promise<void> => {
      const poser = window.api.conversationsSetInactive
      if (!poser) {
        setAppNotice((current) =>
          newestNotice(current, {
            text: texteFil('statut.indisponible')
          })
        )
        return
      }
      try {
        await poser(conversationId, on)
      } catch (erreur) {
        setAppNotice((current) =>
          newestNotice(current, {
            text: texteFil('statut.nonEnregistre', {
              raison: erreur instanceof Error ? erreur.message : String(erreur)
            })
          })
        )
        return
      }
      await refreshConvs()
    },
    [refreshConvs]
  )

  /**
   * Fil privé du village commun (D6) : le tanuki reste chez les collègues, sans titre.
   * Même contrat que `marquerInactive` : un pont absent (preload d'avant redémarrage) se dit.
   */
  const marquerPrive = useCallback(
    async (conversationId: string, on: boolean): Promise<void> => {
      const poser = window.api.conversationsSetPrive
      if (!poser) {
        setAppNotice((current) => newestNotice(current, { text: texteFil('prive.indisponible') }))
        return
      }
      try {
        await poser(conversationId, on)
      } catch (erreur) {
        setAppNotice((current) =>
          newestNotice(current, {
            text: texteFil('statut.nonEnregistre', {
              raison: erreur instanceof Error ? erreur.message : String(erreur)
            })
          })
        )
        return
      }
      await refreshConvs()
    },
    [refreshConvs]
  )

  const surligner = useCallback(
    async (conversationId: string, on: boolean): Promise<void> => {
      const poser = window.api.conversationsSetHighlight
      if (!poser) {
        setAppNotice((current) =>
          newestNotice(current, {
            text: texteFil('surlignage.indisponible')
          })
        )
        return
      }
      try {
        await poser(conversationId, on)
      } catch (erreur) {
        setAppNotice((current) =>
          newestNotice(current, {
            text: texteFil('surlignage.nonEnregistre', {
              raison: erreur instanceof Error ? erreur.message : String(erreur)
            })
          })
        )
        return
      }
      await refreshConvs()
    },
    [refreshConvs]
  )
  /**
   * LE MEME menu sert deux cibles : une conversation existante (on la range tout de suite) et le
   * PROCHAIN fil, quand aucune conversation n'est ouverte (on garde l'intention, elle sera posee a
   * la creation). Un seul aiguillage, sinon les deux chemins divergent.
   */
  const choisirDossier = useCallback(
    (cible: Conv | null, chemin: string | null): void => {
      if (cible) {
        void rangerDans(cible.id, chemin)
        return
      }
      if (chemin) memoriserDossier(chemin)
      setDossierNouveauFil(chemin)
    },
    [rangerDans, memoriserDossier]
  )
  /**
   * Aiguillage du menu de rangement : un LOT (mode sélection) est rangé conversation par
   * conversation par le même canal que `rangerDans`, puis la liste n'est relue qu'UNE fois.
   * Sans lot, c'est `choisirDossier` inchangé.
   */
  const appliquerRangement = useCallback(
    (menu: { conv: Conv | null; ids?: string[] }, chemin: string | null): void => {
      if (!menu.ids) {
        choisirDossier(menu.conv, chemin)
        return
      }
      const ids = menu.ids
      void (async () => {
        if (chemin) memoriserDossier(chemin)
        for (const id of ids) await window.api.conversationsSetProject?.(id, chemin)
        setConvSelectionMode(false)
        setSelectedConvIds(new Set())
        await refreshConvs()
      })()
    },
    [choisirDossier, memoriserDossier, refreshConvs]
  )
  /**
   * AMORCAGE unique : au tout premier chargement, la memoire est vide alors que des conversations
   * sont deja rangees. On l'amorce avec ces dossiers-la. Ensuite la memoire fait autorite -- sinon
   * un dossier retire par la croix reviendrait tant qu'une conversation le porte encore.
   */
  const amorce = useRef(false)
  useEffect(() => {
    if (amorce.current || convs.length === 0) return
    amorce.current = true
    // `projectPath` seulement, jamais `categorie` : un libellé de classement n'est pas un dossier
    // de travail, et l'amorçage est justement par où ils entraient dans la liste.
    const utilises = convs
      .map((conv) => conv.projectPath?.trim())
      .filter((chemin): chemin is string => estCheminDeDossier(chemin))
    // fix-ok: cause mesurée — cet amorçage ignorait la mémoire des retraits : un dossier ôté par
    // la croix mais porté par une conversation (ex. scratch claude.exe importé) revenait à chaque
    // lancement. Même fusion que l'import claude.exe, donc même respect des retraits.
    if (utilises.length > 0) {
      const retires = lireDossiersRetires()
      setDossiersMemorises(
        (connus) => fusionnerDossiersImportes(connus, utilises, retires) ?? connus
      )
    }
  }, [convs])

  /**
   * IMPORT claude.exe (2026-09-23) : les projets déjà ouverts dans le CLI Claude
   * rejoignent la liste des dossiers de travail, À CHAQUE lancement — un projet commencé demain
   * dans claude.exe arrivera seul. Le main lit et filtre le profil (`~/.claude.json`) ; ici on
   * fusionne, et la mémoire des retraits garantit qu'un dossier ôté par la croix ne revient pas.
   * fix-ok: cause mesurée — l'amorçage existant (effet ci-dessus) ne connaissait QUE les dossiers
   * portés par des conversations passées ; les projets claude.exe n'y arrivaient jamais. Et comme
   * cet amorçage ré-ajoute à chaque lancement, l'import a SA propre mémoire des retraits
   * (autowin.conv-folders.retires), sinon la croix serait un bouton mort — prouvé par les 7 tests
   * de chat-dossiers-import.test.ts.
   */
  useEffect(() => {
    // Pont absent = version chargée avant redémarrage : l'import attendra le prochain démarrage.
    // Pas de bandeau ici, contrairement au surlignage : rien n'a été CLIQUÉ, rien n'est perdu.
    const lireProjetsClaude = window.api.dossiersClaudeCli
    if (!lireProjetsClaude) return
    let demonte = false
    void lireProjetsClaude()
      .then((importes) => {
        if (demonte || !Array.isArray(importes) || importes.length === 0) return
        const retires = lireDossiersRetires()
        setDossiersMemorises(
          (connus) => fusionnerDossiersImportes(connus, importes, retires) ?? connus
        )
      })
      .catch((error) => {
        // Profil illisible : la liste locale suffit, l'import est un confort, jamais une panne.
        traceSilentFailure('import-dossiers-claude', error)
      })
    return () => {
      demonte = true
    }
  }, [])

  /*
    « THIS COMPUTER » (2026-10-16 : « en CWD ajoute This computer dans les choix ») :
    travailler sur la machine, sans projet — claude.exe lancé depuis le dossier personnel. Seul le
    main connaît ce dossier ; pont absent (preload d'avant redémarrage) = pas d'entrée, jamais une
    panne.
  */
  const [dossierPersonnel, setDossierPersonnel] = useState<string | null>(null)
  useEffect(() => {
    const lire = window.api.dossierPersonnel
    if (!lire) return
    let demonte = false
    void lire()
      .then((chemin) => {
        if (!demonte && estCheminDeDossier(chemin)) setDossierPersonnel(chemin.trim())
      })
      .catch((error) => traceSilentFailure('dossier-personnel', error))
    return () => {
      demonte = true
    }
  }, [])
  /** Ce chemin est-il le dossier personnel ? Comparaison canonique, sans casse (Windows). */
  const estDossierPersonnel = useCallback(
    (chemin: string | null | undefined): boolean => {
      if (!dossierPersonnel || !chemin) return false
      return (
        canonicalProjectPath(chemin)?.toLowerCase() ===
        canonicalProjectPath(dossierPersonnel)?.toLowerCase()
      )
    },
    [dossierPersonnel]
  )

  const dossiersConversations = useMemo(
    () =>
      [...new Set(dossiersMemorises.map((chemin) => chemin.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' })
      ),
    [dossiersMemorises]
  )

  /**
   * Les CATEGORIES deja utilisees, lues sur les conversations elles-memes.
   *
   * Elles ne sont pas memorisees en local comme les dossiers : une categorie n'existe QUE portee
   * par au moins un fil, donc la liste se deduit et ne peut pas se desynchroniser. Depuis la
   * separation des deux roles, le menu « Ranger dans… » ne proposait plus que des
   * chemins : classer sous « Fiches Team » etait devenu impossible a la souris.
   */
  const categoriesConnues = useMemo(
    () =>
      [
        ...new Set(
          convs
            .map((conv) => conv.categorie?.trim())
            .filter((libelle): libelle is string => !!libelle)
        )
      ].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })),
    [convs]
  )
  /** Saisie en cours d'une categorie neuve dans le menu (null = le champ n'est pas ouvert). */
  const [saisieCategorie, setSaisieCategorie] = useState<string | null>(null)

  /*
   * À QUEL CHEF APPARTIENT CHAQUE FIL DE LOT (lot 5). UNE lecture groupée,
   * `plansDeLots('tous')`, rend tous les plans gardés : le chef, et le fil, le rang et le total de
   * chaque lot. Plus de repérage par le titre « Lot N/M — » : un fil de lot renommé reste rangé.
   * Relue en UN appel à chaque événement `plans-de-lots` (le coordinateur le signale à chaque
   * changement de plan, fil de lot neuf compris), jamais sur un rafraîchissement de la liste. La
   * relecture passe par une ref et ne touche l'état que si un lien change : un lot qui avance ne
   * re-rend pas toute la vue. Mesure : ChatView.fils-de-lots.test.tsx (1 000 fils, 2 plans → 1 appel).
   */
  const [liensDeLots, setLiensDeLots] = useState<ReadonlyMap<string, LienDeLot>>(() => new Map())
  const liensDeLotsRef = useRef<ReadonlyMap<string, LienDeLot>>(liensDeLots)
  /** Relit tous les plans ; appelée par l'abonnement unique de la vue sur `plans-de-lots`. */
  const relirePlansRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (typeof window.api?.plansDeLots !== 'function') return
    let vivant = true
    let derniere = 0
    const relire = (): void => {
      const numero = ++derniere
      window.api.plansDeLots('tous').then(
        (reponse) => {
          // Une réponse dépassée par une relecture plus récente ne s'applique pas.
          if (!vivant || numero !== derniere) return
          if (!reponse.ok) {
            console.warn('[liste] plans de lots illisibles :', reponse.erreur)
            return
          }
          const liens = liensDesPlans(reponse.plans ?? [])
          if (memesLiens(liens, liensDeLotsRef.current)) return
          liensDeLotsRef.current = liens
          setLiensDeLots(liens)
        },
        // Le rangement n'est qu'un confort d'affichage : la liste reste à plat, l'erreur se voit.
        (erreur: unknown) => console.warn('[liste] plans de lots illisibles :', erreur)
      )
    }
    relirePlansRef.current = relire
    relire()
    return () => {
      vivant = false
      relirePlansRef.current = () => {}
    }
  }, [])

  /*
   * LA SUPER CONV DU FIL OUVERT : sur un fil chef ou un de ses lots, le panneau de chat
   * porte les mêmes onglets et la même frise que la case de mosaïque (`SuperConvDuChat`).
   */
  const chefDuFilOuvert = useMemo(
    () => chefDeLaSuperConv(activeId, liensDeLots),
    [activeId, liensDeLots]
  )
  const planDuFilOuvert = usePlanDuChef(chefDuFilOuvert)
  const ongletDuFilOuvert =
    planDuFilOuvert && activeId ? ongletDuFil(planDuFilOuvert, activeId) : null
  /*
   * LES BUREAUX CACHÉS DU CHANTIER (2026-10-31) : le panneau s'ouvre quand le fil lance un
   * bureau, et il remplace le bloc qui s'affichait dans le fil. Toute la super conv compte : un lot
   * ouvre son bureau dans son propre fil. Vide en mosaïque : plusieurs fils à l'écran, le panneau les
   * montre tous et rien ne s'ouvre seul, faute de place à côté d'eux.
   */
  const filsDesBureaux = useMemo(
    () => filsDuPanneau(convViewMode === 'mosaic' ? null : activeId, chefDuFilOuvert, liensDeLots),
    [activeId, chefDuFilOuvert, convViewMode, liensDeLots]
  )
  useGuetBureauxDuFil({
    actif: isActive,
    fils: filsDesBureaux,
    onBureauLance: () => setPanneauOutil('bureaux')
  })
  /*
   * Les titres des onglets de la super conv. La signature garde la MÊME Map tant
   * qu'aucun titre ne change : `convs` est refait à chaque rafraîchissement de la liste, et une Map
   * neuve redessinerait onglets et frise, que leur `memo` protège du flux.
   */
  const signatureDesTitres = useMemo(
    () => JSON.stringify(convs.map((c) => [c.id, c.title])),
    [convs]
  )
  const titresDesFils = useMemo<ReadonlyMap<string, string>>(
    () => new Map(JSON.parse(signatureDesTitres) as [string, string][]),
    [signatureDesTitres]
  )
  // Une recherche montre tout, lots compris : chercher, c'est vouloir voir.
  const rechercheEnCours = convQuery.trim() !== ''
  const lotsMasques = useMemo<ReadonlySet<string>>(
    () => (rechercheEnCours ? new Set() : lotsSousOnglets(liensDeLots, titresDesFils)),
    [rechercheEnCours, liensDeLots, titresDesFils]
  )
  const { chefsActifs, chefsEnQuestion, lotsEnQuestion } = useMemo(
    () => activiteDesLots(convs, liensDeLots, busyConversations),
    [convs, liensDeLots, busyConversations]
  )
  // Le signe de chaque fil chef dans la liste : des chaînes, pour que la ligne mémorisée
  // ne se redessine que si SON signe change.
  const signesSuperConv = useMemo(
    () => signesDesSuperConvs(convs, liensDeLots, busyConversations),
    [convs, liensDeLots, busyConversations]
  )
  // Même garde que les titres : `convs` est refait à chaque rafraîchissement de la liste, et un Set
  // neuf redessinerait les onglets que leur `memo` protège du flux.
  const signatureDesQuestions = [...lotsEnQuestion].sort().join('\n')
  const questionsDesLots = useMemo<ReadonlySet<string>>(
    () => new Set(signatureDesQuestions ? signatureDesQuestions.split('\n') : []),
    [signatureDesQuestions]
  )
  // Le lot ouvert n'a pas de ligne : c'est son chef qui dit où l'on est dans la liste.
  const filSurligne =
    activeId && lotsMasques.has(activeId) ? (liensDeLots.get(activeId)?.chef ?? activeId) : activeId

  /**
   * Les résultats de recherche, groupés. On transporte le HIT entier (`snippet` compris) plutôt que
   * d'aplatir la conversation dedans : l'aplatissement faisait collisionner des champs homonymes et
   * rendait impossible de savoir, à la lecture, d'où venait chaque valeur.
   */
  const groupes = useMemo(() => {
    // Retirés ICI, avant tout regroupement : « Récent » et les compteurs ne les voient pas non plus.
    const entrees = conversationHits
      .filter((hit) => !lotsMasques.has(hit.conversation.id))
      .map((hit) => ({
        id: hit.conversation.id,
        projectPath: hit.conversation.projectPath,
        categorie: hit.conversation.categorie,
        autoKaizen: hit.conversation.autoKaizen,
        hit
      }))
    /**
     * « Récent » est un RACCOURCI, pas une catégorie : il duplique les fils déjà rangés ailleurs et
     * reste TOUJOURS en tête, hors du tri par date entre groupes (le trier n'aurait aucun sens : il
     * contient par construction la conversation la plus récente).
     */
    // `langue` : « Récent » et « Divers » suivent la langue de l'interface.
    const recent = groupeRecent(
      entrees,
      (entree) => recenceUtilisateur(entree.hit.conversation),
      undefined,
      langue
    )
    return [
      ...(recent ? [recent] : []),
      ...ordonnerGroupes(
        groupesVisibles(
          grouperConversations(entrees, dossierParDefaut, langue),
          // Pendant une recherche, aucun repli ne masque un resultat : chercher, c'est vouloir voir.
          convQuery.trim() ? {} : groupesReplies
        ),
        // La date n'arbitre qu'entre FRERES : un `.sort()` a plat ecrasait le rang par nature
        // (« Auto-kaizen » remontait en tete) et l'ordre parent-avant-enfant (un sous-dossier
        // s'affichait au-dessus de son parent, indente comme s'il y etait niche).
        //
        // MEME CLE que le tri a plat (`recenceUtilisateur`) : ce second tri portait encore sur
        // `updatedAt` et ECRASAIT donc le premier — mesure le 2026-08-18, la liste affichee ne
        // suivait pas l'ordre calcule juste au-dessus. Deux tris, une seule verite.
        (groupe) => recenceUtilisateur(groupe.items[0].hit.conversation),
        conversationDateOrder
      )
    ]
  }, [
    conversationHits,
    lotsMasques,
    groupesReplies,
    conversationDateOrder,
    convQuery,
    dossierParDefaut,
    langue
  ])

  const openRunsCount = runs.filter((r) => r.summary.status === 'open').length
  /**
   * Fils de sous-agents RELUS depuis la trace persistée — la même source que le graphe. Sans eux, le
   * panneau affichait « Aucune orchestration » dès que la vue se remontait, alors que son propre
   * message vide promet que le fil RESTE une fois la tâche terminée.
   */
  const [persistedRuns, setPersistedRuns] = useState<ScopedLiveRun<OrchStep>[]>([])
  useEffect(() => {
    // Chargement PARESSEUX : la trace n'est lue qu'a l'ouverture de la section (garde testee).
    // Le fil n’est plus derrière un onglet : il s’ouvre depuis n’importe quel nœud du graphe.
    // La garde reste PARESSEUSE sur l’ouverture du panneau, elle ne peut plus l’être sur un onglet
    // disparu — sinon le fil ne se chargerait jamais.
    if (!isActive || !activeId || !showRuns) return
    let alive = true
    void (async () => {
      try {
        const trace = (await window.api.causalTrace?.(activeId)) as HarnessTraceEvent[] | undefined
        if (!alive || !trace) return
        const runtimeByTurn = new Map<string, TurnRuntimeIdentity>()
        for (const message of active?.messages ?? []) {
          if (message.role === 'assistant' && message.turnId && message.runtime) {
            runtimeByTurn.set(message.turnId, message.runtime)
          }
        }
        setPersistedRuns(
          scopedRunsFromTimeline(
            buildHarnessTimelineFromTrace(trace),
            activeId,
            runtimeByTurn
          ) as ScopedLiveRun<OrchStep>[]
        )
      } catch (error) {
        /* trace illisible : on garde le direct, jamais d'écran vide à cause de la relecture */
        traceSilentFailure('live-action-trace', error)
      }
    })()
    return () => {
      alive = false
    }
  }, [isActive, activeId, showRuns, liveRuns, active])

  /**
   * PRÉSENCE SYSTÈME : la fenêtre est le seul endroit qui sait quels runs tournent — elle le dit au
   * process principal, qui pose la jauge de barre des tâches et le texte de l'icône de notification.
   * Envoi best-effort : un pont absent (tests, fenêtre de question) ne doit rien casser.
   */
  useEffect(() => {
    const pont = (
      globalThis as {
        api?: { signalerRunsVivants?: (e: ReturnType<typeof presenceDepuisRunsVivants>) => unknown }
      }
    ).api
    if (!pont?.signalerRunsVivants) return
    try {
      void pont.signalerRunsVivants(presenceDepuisRunsVivants(liveRuns))
    } catch (error) {
      traceSilentFailure('presence-systeme', error)
    }
  }, [liveRuns])

  const visibleLiveRuns = mergeLiveAndPersisted<OrchStep>(
    visibleScopedRuns<OrchStep>(liveRuns, activeId ?? undefined, 'conv'),
    persistedRuns.filter((run) => run.convId === activeId)
  )

  /**
   * FIL RENDU, MÉMOÏSÉ. Mesuré : chaque caractère tapé dans le composer re-rendait la
   * liste ENTIÈRE, et `askReponseDuFil`/`lastUserPromptBefore` balaient le fil pour CHAQUE
   * message → O(n²) balayages par touche (400 pour 5 caractères sur 80 messages, mesuré par
   * `ChatView.frappe-cout.test.tsx`). D'où le gel à la frappe sur une conversation longue.
   * `input` n'est VOLONTAIREMENT pas une dépendance : le composer ne touche pas au fil.
   */
  // Un long fil s'ouvre par sa fin puis se complète par tranches (fil-progressif.ts, cause des
  // gels `vue-chat`) ; les index restent ceux du fil ENTIER, clés et balayages compris.
  const debutFil = useDebutProgressif(activeId, messages.length)
  // Tes messages pas encore rendus en haut du fil : l'ascenseur à crans les compte pour garder la
  // numérotation du fil ENTIER pendant le rendu par tranches.
  const messagesUtilisateurAvantDebut = useMemo(
    () => messages.slice(0, debutFil).filter((message) => message.role === 'user').length,
    [messages, debutFil]
  )
  const filRendu = useMemo(
    () =>
      messages.slice(debutFil).map((message, rang) => {
        const index = debutFil + rang
        return (
          <Fragment key={messageKey(message, index)}>
            <ChatMessageRow
              onPickSuggestion={pickSuggestion}
              onPlanSelection={planSelection}
              autoLancerCandidats={
                message.role === 'assistant' &&
                doitAutoLancerCandidats(
                  // La cle porte la conversation : `role:index` seul se RECOUVRE d'un fil a l'autre.
                  `${activeId ?? ''}#${messageKey(message, index)}`,
                  index === messages.length - 1,
                  message.done === true
                )
              }
              onAnswerAsk={answerAsk}
              /* VERROU DURABLE : seule une VRAIE reponse (le texte que le bloc envoie) ferme la
             question. Derive du fil, donc vrai apres un remontage comme apres un redemarrage.
             Se fermer sur n'importe quel message posterieur avalait le clic. Le TEXTE
             de la reponse dit aussi au bloc quelle ligne encadrer. */
              askReponse={
                message.role === 'assistant' ? askReponseDuFil(messages, index) : undefined
              }
              message={message}
              tourEnCours={
                message.role === 'user' ? tourDuMessageEnCours(messages, index, busy) : undefined
              }
              finDuRaisonnement={finDuRaisonnementRelaye(messages, index)}
              conversationId={activeId}
              onInspectTurn={onInspectTurn}
              onFork={handleFork}
              onModifier={handleModifier}
              onRevenir={handleRevenir}
              onOpenImage={setOpenImage}
              onOpenLiveAction={revealLiveAction}
              retryPrompt={
                message.role === 'assistant' ? lastUserPromptBefore(messages, index) : undefined
              }
              onResend={pickSuggestion}
              onRefineResume={refineResumeDraft}
              onLogin={ouvrirLogin}
              directiveReceipts={
                message.role === 'assistant'
                  ? activeDirectiveReceiptsByMessage.get(index)
                  : undefined
              }
              onAnnulerEnvoi={annulerEnvoi}
            />
            {message.role === 'user' &&
              (activeDirectiveReceiptsByMessage.get(index) ?? []).map((receipt) => (
                <DirectiveReceiptRow
                  key={`directive-receipt-${receipt.id}`}
                  receipt={receipt}
                  onAnnuler={annulerEnvoi}
                />
              ))}
          </Fragment>
        )
      }),
    [
      debutFil,
      messages,
      busy,
      doitAutoLancerCandidats,
      activeId,
      activeDirectiveReceiptsByMessage,
      pickSuggestion,
      planSelection,
      answerAsk,
      onInspectTurn,
      handleFork,
      handleModifier,
      revealLiveAction,
      refineResumeDraft,
      ouvrirLogin
    ]
  )

  /**
   * LES LIGNES DE LA LISTE, memorisees (heal gels vue chat, 2026-09-18). Sans cela, chaque morceau
   * de texte recu pendant un tour re-rendait ChatView, et donc recreait les ~600 lignes de la liste
   * alors que rien de ce qu'elles affichent n'avait change. Mesure (test profile, 600 conversations,
   * 30 morceaux) : 3,1 s des 5 s passees dans le corps de ChatView venaient de ce seul bloc.
   * Les actions qui ne sont pas stables passent par `actionsListeRef` : toujours les dernieres,
   * sans invalider la memoire.
   */
  /*
   * LE GEL DE LA LISTE NOMME SON DÉCLENCHEUR (2026-10-23) : les données de la liste qui
   * ont changé depuis son dernier rendu validé partent avec le gel (`rendu-long.ts`). La référence
   * n'avance qu'APRÈS validation : un double rendu (StrictMode) recalcule les mêmes noms.
   */
  const entreesDeListe = {
    conversations: convs,
    recherche: convQuery,
    'recherche-contenu': correspondancesContenu,
    'filtre-statut': convStatusFilter,
    replis: groupesReplies,
    'dossier-par-defaut': dossierParDefaut,
    'survol-depot': surviole,
    'fils-occupes': busyConversations,
    'fil-ouvert': activeId,
    'fils-vus': conversationsVues,
    'mode-selection': convSelectionMode,
    'mode-vue': convViewMode,
    selection: selectedConvIds,
    mosaique: mosaicIds
  }
  const entreesDeListeValideesRef = useRef<typeof entreesDeListe | null>(null)
  noterDeclencheursListe(declencheursDeListe(entreesDeListeValideesRef.current, entreesDeListe))
  useEffect(() => {
    entreesDeListeValideesRef.current = entreesDeListe
  })
  const actionsListeRef = useRef({
    loadConv,
    basculerDansMosaique,
    toggleConvSelection,
    rangerDans
  })
  actionsListeRef.current = { loadConv, basculerDansMosaique, toggleConvSelection, rangerDans }
  const lignesAffichables = useMemo(
    () =>
      groupes.reduce(
        (total, groupe) =>
          groupeReplie(groupe.key, convQuery, groupesReplies) ? total : total + groupe.items.length,
        0
      ),
    [groupes, convQuery, groupesReplies]
  )
  const lignesDessinees = useLignesDessinees(lignesAffichables)
  // Combien de fils chaque groupe dessine : les premiers de la liste, dans l'ordre d'affichage
  // (« Récent » d'abord). Le reste attend la tranche suivante ; l'en-tête du groupe reste affiché.
  const quotasDeGroupe = useMemo(() => {
    let restant = lignesDessinees
    return groupes.map((groupe) => {
      if (groupeReplie(groupe.key, convQuery, groupesReplies)) return 0
      const quota = Math.min(groupe.items.length, restant)
      restant -= quota
      return quota
    })
  }, [groupes, convQuery, groupesReplies, lignesDessinees])
  const lignesListe = useMemo(
    () =>
      groupes.map((groupe, indexGroupe) => {
        // Une RECHERCHE en cours deplie tout : un resultat cache dans un dossier replie
        // faisait croire que la conversation n'existait plus (« je tape 170, ca me montre rien »).
        const replie = groupeReplie(groupe.key, convQuery, groupesReplies)
        const quota = quotasDeGroupe[indexGroupe] ?? 0
        return (
          <Fragment key={groupe.key}>
            {/*
                  L'en-tête est AUSSI la zone de dépôt : viser un titre est plus facile que viser un
                  interstice, et ça évite d'inventer une cible invisible. On ne dépose pas sur un
                  groupe dérivé (« Auto-kaizen » vient du champ `autoKaizen`, « Divers » est l'absence
                  de dossier) — y traîner une conversation ne voudrait rien dire.
                */}
            <div
              className={`conv-group${replie ? ' is-collapsed' : ''}${
                surviole === groupe.key ? ' is-drop' : ''
              }`}
              data-testid={`conv-group-${groupe.key}`}
              data-depth={groupe.depth}
              onDragOver={(e) => {
                if (!deposable(groupe.kind)) return
                e.preventDefault()
                setSurvole(groupe.key)
              }}
              onDragLeave={() => setSurvole((c) => (c === groupe.key ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setSurvole(null)
                const id = e.dataTransfer.getData('text/autowin-conversation')
                if (id && deposable(groupe.kind))
                  void actionsListeRef.current.rangerDans(id, groupe.key)
              }}
            >
              <button
                className="conv-group-head"
                onClick={() => basculerGroupe(groupe.key, replie)}
                aria-expanded={!replie}
                title={deposable(groupe.kind) ? groupe.key : groupe.label}
                style={{ paddingLeft: 8 + groupe.depth * 14 }}
              >
                <span className="conv-group-chevron" aria-hidden="true">
                  {replie ? '▸' : '▾'}
                </span>
                <span className="conv-group-label">{groupe.label}</span>
                <span className="conv-group-count tnum">{groupe.items.length}</span>
              </button>
            </div>
            {!replie &&
              rangerSousLeurChef(groupe.items, liensDeLots, langue).map(
                ({ entree, niveau, lot }, rang) => {
                  if (rang >= quota) return null
                  const { conversation: c, snippet } = entree.hit
                  return (
                    <LigneConversation
                      key={c.id}
                      c={c}
                      snippet={snippet}
                      depth={groupe.depth + niveau}
                      lot={lot}
                      actif={c.id === filSurligne}
                      occupe={busyConversations.has(c.id) || chefsActifs.has(c.id)}
                      nonVue={c.id !== activeId && estNonVue(c, conversationsVues)}
                      questionDUnLot={chefsEnQuestion.has(c.id)}
                      superConv={signesSuperConv.get(c.id)}
                      selectionnee={selectedConvIds.has(c.id)}
                      mosaiqueOuverte={mosaicIds.includes(c.id)}
                      convQuery={convQuery}
                      convSelectionMode={convSelectionMode}
                      convViewMode={convViewMode}
                      actionsRef={actionsListeRef}
                      setConvMenu={setConvMenu}
                    />
                  )
                }
              )}
          </Fragment>
        )
      }),
    [
      groupes,
      liensDeLots,
      langue,
      convQuery,
      groupesReplies,
      surviole,
      busyConversations,
      chefsActifs,
      chefsEnQuestion,
      signesSuperConv,
      activeId,
      filSurligne,
      conversationsVues,
      convSelectionMode,
      convViewMode,
      selectedConvIds,
      mosaicIds,
      basculerGroupe,
      quotasDeGroupe
    ]
  )

  /*
   * L'AVIS DE L'APPLICATION, DANS LES DEUX VUES (2026-10-21). Il ne vivait que dans la
   * vue du fil unique : en mosaïque, rien ne l'affichait. Mesuré sur « Essaie 3 façons », qui bascule
   * en mosaïque PUIS écrit son avis (copies ouvertes, coût en tours) — l'utilisateur ne le voyait
   * jamais. En mosaïque, il flotte au-dessus des fenêtres, dans `.chat-avis-mosaique` (ChatMosaic.css).
   */
  const avisApp = appNotice ? (
    <div className="chat-workflow-notice fade-in" data-testid="chat-workflow-notice" role="alert">
      <span>{appNotice.text}</span>
      <button type="button" onClick={() => setAppNotice(null)} aria-label={texteFil('avis.fermer')}>
        ×
      </button>
    </div>
  ) : null
  return {
    marquerInactive,
    marquerPrive,
    surligner,
    appliquerRangement,
    dossierPersonnel,
    estDossierPersonnel,
    dossiersConversations,
    categoriesConnues,
    saisieCategorie,
    setSaisieCategorie,
    liensDeLots,
    relirePlansRef,
    planDuFilOuvert,
    ongletDuFilOuvert,
    filsDesBureaux,
    questionsDesLots,
    openRunsCount,
    visibleLiveRuns,
    messagesUtilisateurAvantDebut,
    filRendu,
    lignesListe,
    avisApp
  }
}
