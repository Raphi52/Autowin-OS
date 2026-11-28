import { useMemo, useRef, useState, useEffect } from 'react'
import { buildMentionSources } from './chat-mentions'
import { useTenirRefAJour } from './tenir-ref-a-jour'
import { frictionEchecsRepetes } from '../../../shared/friction-echecs-repetes'
import { orchestrationOutcomesFromMessages } from './action-outcome-summary'
import { buildHomeSuggestions, usagesDesSkills } from './chat-home-suggestions'
import type { ChatAttachment, Msg, RunEntry } from './chat-view-types'
import type { Langue } from '../../../shared/langue'
import { useSkillsCatalog } from './useSkillsInventory'
import { skillSlashCommands, type SlashCommand } from './chat-view-model'
import { ghostDuFil, propositionsDuFil } from './chat-view-outils'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type SuggestionsDAccueilCtx = {
  attachments: ChatAttachment[]
  brouillonPresent: boolean
  langue: Langue
  messages: Msg[]
  runs: RunEntry[]
}

/** Les sources des mentions, la friction des échecs répétés et les suggestions de l'accueil. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSuggestionsDAccueil(ctx: SuggestionsDAccueilCtx) {
  const { attachments, brouillonPresent, langue, messages, runs } = ctx
  /**
   * Cibles mentionnables, dérivées de l'état DÉJÀ chargé (aucun nouvel IPC, aucun balayage disque).
   * Ne dépend PAS de `input` : taper dans le composer ne recalcule donc rien ici.
   */
  const mentionSources = useMemo(
    () =>
      buildMentionSources({
        runs,
        attachments,
        citedTexts: messages
          .filter((m) => m.role === 'user')
          .slice(-6)
          .map((m) => m.content)
      }),
    [runs, attachments, messages]
  )
  const mentionSourcesRef = useRef(mentionSources)
  useTenirRefAJour(mentionSourcesRef, mentionSources)
  /**
   * Suggestions d'accueil dérivées de l'état RÉEL (runs bloqués, brouillon repris) ; repli
   * statique si rien à dire. `AnimationAccueilChat` les écrit une à une.
   */
  /**
   * FRICTION sur une série d'orchestrations sans livraison. Mesuré (2026-08-18) : douze
   * runs d'affilée sur la même demande, plus de 20 $, et rien à l'écran ne disait qu'on était dans
   * une série — l'utilisateur a relancé neuf fois, ce qui est le comportement rationnel quand
   * personne ne lui montre le mur. Ce bandeau ne bloque RIEN : la relance reste à un geste, la
   * décision reste humaine. Il rend seulement la série et son coût lisibles avant le geste suivant.
   */
  const friction = useMemo(
    () => frictionEchecsRepetes(orchestrationOutcomesFromMessages(messages)),
    [messages]
  )
  const homeSuggestions = useMemo(
    // `brouillonPresent` et non le texte : `buildHomeSuggestions` ne teste que sa présence. Puces dans
    // la langue de l'interface : la puce cliquée part telle qu'affichée.
    () => buildHomeSuggestions({ runs, resumedDraft: brouillonPresent ? 'brouillon' : '' }, langue),
    [runs, brouillonPresent, langue]
  )
  const usagesAccueil = useMemo(() => usagesDesSkills(langue), [langue])
  const phrasesAccueil = useMemo(
    () => homeSuggestions.flatMap((groupe) => groupe.items.map((item) => item.label)),
    [homeSuggestions]
  )
  return { mentionSources, mentionSourcesRef, friction, usagesAccueil, phrasesAccueil }
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type SkillsEtDepotCtx = {
  messages: Msg[]
}

/** Les commandes de skills, la présence d'un dépôt git, le dossier par défaut et les suggestions de suite du fil. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSkillsEtDepot(ctx: SkillsEtDepotCtx) {
  const { messages } = ctx
  /**
   * Palette `/` déduite des skills réellement installées. MÊME source que l'exécutabilité et que la
   * palette de briques (`useSkillsInventory`) : deux lectures écrites à la main divergeraient, et
   * une vue proposerait ce qu'une autre déclare inconnu.
   */
  const skillsInstallees = useSkillsCatalog()
  const skillCommands = useMemo<SlashCommand[]>(
    () => skillSlashCommands(skillsInstallees ?? []),
    [skillsInstallees]
  )
  /*
   * Ghost-text (façon CLI) du DERNIER message assistant : placeholder grisé quand le champ est vide,
   * accepté par Tab.
   *
   * D'ABORD le PROMPT que le modèle a écrit POUR ce champ, ENSUITE seulement la rubrique
   * « 👉 Recommandé » en repli. Les deux ne disent pas la même chose : la rubrique est un état
   * adressé au lecteur (« passer en terrain »), donc la recopier ici donnait une phrase qu'il fallait
   * réécrire avant de l'envoyer. Le repli garantit qu'un tour sans prompt garde l'ancien comportement.
   */
  /*
   * LE DOSSIER DE TRAVAIL EST-IL UN DEPOT GIT ? Lu une fois : le dossier actif est fige au
   * demarrage cote main. `true` par defaut tant que la reponse n'est pas arrivee, pour ne jamais
   * relacher le garde-fou de publication sur une simple latence de lecture.
   */
  const [depotPresent, setDepotPresent] = useState(true)
  /**
   * Le depot selectionne dans la barre du haut : il sert d'EN-TETE de repli pour les fils qui n'ont
   * aucun rangement propre. Sans lui ils tombaient tous dans « Divers », alors qu'ils travaillent
   * dans ce depot-la (demande du 2026-09-17). Vide tant que la lecture n'a pas repondu -> « Divers »,
   * exactement le comportement d'avant.
   */
  const [dossierParDefaut, setDossierParDefaut] = useState('')
  useEffect(() => {
    // Canal ABSENT : on garde `true`, donc l'ancien comportement — jamais un relachement du
    // garde-fou de publication sur une simple indisponibilite de lecture.
    if (typeof window.api?.executionWorkspace !== 'function') return
    let vivant = true
    void window.api
      .executionWorkspace()
      .then((etat) => {
        if (!vivant) return
        setDepotPresent(etat.isGitRepo)
        setDossierParDefaut(etat.path ?? '')
      })
      .catch(() => {
        /* Lecture impossible : on garde le comportement d'avant, jamais un relachement. */
      })
    return () => {
      vivant = false
    }
  }, [])
  const ghostRecommendation = useMemo(
    () => ghostDuFil(messages, depotPresent),
    [messages, depotPresent]
  )
  const propositionsSuite = useMemo(
    () => propositionsDuFil(messages, depotPresent),
    [messages, depotPresent]
  )
  return { skillCommands, depotPresent, dossierParDefaut, ghostRecommendation, propositionsSuite }
}
