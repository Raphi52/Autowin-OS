import { useState, useEffect, useCallback, useRef } from 'react'
import { CLE_MODE_AUTO_CONVS, EVT_ARMER_MODE_AUTO } from './chat-auto-convs'
import { useTenirRefAJour } from './tenir-ref-a-jour'
import { CLE_DOSSIER_NOUVEAU_FIL, type ModeleDuFil } from './chat-view-outils'
import { estCheminDeDossier } from '../../../shared/project-path'
import { lireToursAuto } from './tours-auto-persistes'
import { lireSeuilsChaine, CLE_SEUILS_CHAINE_AUTO } from './chat-auto-mode'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type ModeAutoDuChatCtx = {
  activeId: string | null
}

/** Le mode auto par fil, les réglages du prochain fil (auto, dossier, modèle, compte) et les relances automatiques. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useModeAutoDuChat(ctx: ModeAutoDuChatCtx) {
  const { activeId } = ctx
  /*
   * MODE AUTO — « renvoie tout seul la suite proposée jusqu'à ce qu'il ne reste rien ».
   *
   * Cadrage utilisateur (2026-09-02) : l'interrupteur est dans la barre de gauche et le mode reste
   * ACTIF jusqu'à ce qu'on le coupe — pas de plafond de tours, pas d'extinction au changement de
   * fil. Il s'applique donc à la conversation qu'on a sous les yeux, quelle qu'elle soit.
   * Toute la décision d'envoyer vit dans `chat-auto-mode.ts` (fonction pure testée).
   */
  /**
   * L'INTERRUPTEUR SURVIT AU REDÉMARRAGE (demande utilisateur du 2026-09-02 : « fais que le mode
   * auto survive à un redémarrage de l'app »). Il vivait en mémoire seule, donc un rafraîchissement
   * de l'interface l'éteignait EN SILENCE — indistinguable d'un arrêt légitime sur « rien ».
   *
   * Aucun tour payant n'est déclenché par cette reprise : au premier passage dans un fil, la boucle
   * marque le tour déjà présent comme traité (`autoAllumageManuelRef` reste faux au démarrage), donc
   * elle repart sur le PROCHAIN tour terminé, jamais sur une réponse d'avant la fermeture.
   */
  /**
   * REGLAGE PAR CONVERSATION (demande utilisateur du 2026-09-07 : « je veux pouvoir regler le mode
   * auto a l'echelle d'une conversation »). L'interrupteur ne vit plus en booleen unique : on
   * memorise l'ENSEMBLE des fils armes. Le bouton porte donc sur le fil AFFICHE, et un fil arme
   * continue d'enchainer en arriere-plan pendant qu'on regarde ailleurs.
   *
   * L'ancien reglage global est migre en joker `*` : « tous les fils », jusqu'a la premiere
   * extinction. Ainsi une session qui redemarre avec le mode global allume le retrouve allume.
   */
  const [autoConvs, setAutoConvs] = useState<Set<string>>(() => {
    const brut = window.localStorage.getItem(CLE_MODE_AUTO_CONVS)
    if (brut) {
      try {
        const lu = JSON.parse(brut)
        if (Array.isArray(lu)) return new Set(lu.filter((x): x is string => typeof x === 'string'))
      } catch {
        /* reglage illisible : on repart a vide plutot que de planter l'ecran */
      }
    }
    return window.localStorage.getItem('autowin.chat.modeAuto') === '1' ? new Set(['*']) : new Set()
  })
  useEffect(() => {
    window.localStorage.setItem(CLE_MODE_AUTO_CONVS, JSON.stringify([...autoConvs]))
  }, [autoConvs])
  // Un fil arme de l'exterieur (mode auto Tickets) rejoint l'ensemble sans etre ecrase.
  useEffect(() => {
    const armer = (e: Event): void => {
      const id = (e as CustomEvent<unknown>).detail
      if (typeof id === 'string' && id)
        setAutoConvs((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
    }
    window.addEventListener(EVT_ARMER_MODE_AUTO, armer)
    return () => window.removeEventListener(EVT_ARMER_MODE_AUTO, armer)
  }, [])
  const autoArmePour = useCallback(
    (id: string | null | undefined): boolean =>
      // `id`, PAS le fil affiche : cette fonction est appelee pour les fils d'ARRIERE-PLAN.
      autoConvs.has('*') || (!!id && autoConvs.has(id)),
    [autoConvs]
  )
  /** Vrai quand le fil AFFICHE est arme — c'est ce que montre le bouton. */
  const autoActif = autoArmePour(activeId)
  /**
   * MODE AUTO ARME SUR UN FIL PAS ENCORE CREE. Sans cela le bouton ne faisait RIEN dans un
   * nouveau fil : il n'y a pas encore d'identifiant a armer, donc le clic sortait en silence
   * — « quand j'ouvre un nouveau fil je peux pas toggle le mode auto » (2026-09-07).
   * L'intention est gardee ici, puis posee sur la conversation des sa creation.
   */
  const [autoNouveauFil, setAutoNouveauFil] = useState(false)
  const autoNouveauFilRef = useRef(false)
  useTenirRefAJour(autoNouveauFilRef, autoNouveauFil)
  /**
   * DOSSIER DE TRAVAIL ARME SUR UN FIL PAS ENCORE CREE. Meme defaut que le mode auto : le dossier
   * ne se choisissait que sur une conversation EXISTANTE (menu ⋮), donc le premier tour d'un fil
   * neuf tournait toujours dans le depot de repli. L'intention est gardee ici, puis posee sur la
   * conversation des sa creation — `dossierDeTravailDuTour` la lit alors des le premier tour.
   *
   * Un LIBELLE deja memorise ici est ignore : avant la separation, le menu proposait des
   * categories parmi les dossiers, et en choisir une armait le prochain fil sur un dossier qui
   * n'existe pas. La pastille du haut affichait alors ce libelle comme dossier de travail.
   *
   * Le choix RESTE apres la creation du fil, et d'une session a l'autre : chaque fil neuf part
   * dans le dernier dossier choisi, jusqu'au choix suivant. Le vider apres usage obligeait a le
   * rechoisir a chaque fil, le depot par defaut revenant sinon. La pastille l'annonce avant le
   * premier message : ce dossier ne se pose jamais sans etre affiche.
   */
  const [dossierNouveauFil, setDossierNouveauFil] = useState<string | null>(() => {
    try {
      const lu = window.localStorage.getItem(CLE_DOSSIER_NOUVEAU_FIL)
      return lu && estCheminDeDossier(lu) ? lu : null
    } catch {
      return null
    }
  })
  const dossierNouveauFilRef = useRef<string | null>(null)
  useTenirRefAJour(dossierNouveauFilRef, dossierNouveauFil)
  useEffect(() => {
    if (dossierNouveauFil) window.localStorage.setItem(CLE_DOSSIER_NOUVEAU_FIL, dossierNouveauFil)
    else window.localStorage.removeItem(CLE_DOSSIER_NOUVEAU_FIL)
  }, [dossierNouveauFil])
  /**
   * MODÈLE ARMÉ SUR UN FIL PAS ENCORE CRÉÉ (2026-10-11 : « rends le modèle propre à
   * chaque conversation »). Même logique que le dossier armé ci-dessus : l'intention est gardée
   * ici, posée sur la conversation dès sa création, puis vidée. Volontairement en MÉMOIRE seule —
   * pas de localStorage : un choix qui survit des jours et retombe sur un fil sans rapport est
   * exactement le défaut du dossier armé.
   */
  const [modeleNouveauFil, setModeleNouveauFil] = useState<ModeleDuFil | null>(null)
  const modeleNouveauFilRef = useRef<ModeleDuFil | null>(null)
  useTenirRefAJour(modeleNouveauFilRef, modeleNouveauFil)
  /**
   * LE COMPTE ARMÉ POUR LE FIL QUI VA NAÎTRE, même chemin que le modèle ci-dessus : un clic
   * sur une puce avant le premier message vaut pour ce fil, qui ne changera pas de compte tout seul.
   */
  const [compteNouveauFil, setCompteNouveauFil] = useState<string | null>(null)
  const compteNouveauFilRef = useRef<string | null>(null)
  useTenirRefAJour(compteNouveauFilRef, compteNouveauFil)
  /**
   * RELANCES DIFFÉRÉES PROGRAMMÉES, PAR CONVERSATION (« faudrait que le mode auto gère ce
   * cas au lieu de s'arrêter »). Le minuteur vit ici, pas dans l'effet du fil affiché : changer de
   * fil ne le tue pas. `differees` = nombre de relances différées d'affilée (borne dans
   * `deciderRelanceAuto`), remis à zéro au premier envoi ordinaire.
   */
  const autoProgrammeesRef = useRef(new Map<string, { minuteur: number; signature: string }>())
  const autoDiffereesRef = useRef(new Map<string, number>())
  const annulerRelanceProgrammee = useCallback((id: string): void => {
    const p = autoProgrammeesRef.current.get(id)
    if (p) window.clearTimeout(p.minuteur)
    autoProgrammeesRef.current.delete(id)
  }, [])
  /** Desarme un fil precis (le joker `*` disparait : eteindre ici eteint le reglage herite). */
  const desarmerAuto = useCallback(
    (id: string | null | undefined): void => {
      setAutoConvs((precedent) => {
        const suivant = new Set(precedent)
        suivant.delete('*')
        if (id) suivant.delete(id)
        return suivant
      })
      // Éteindre le mode annule aussi la relance différée qui attendait son heure dans ce fil.
      if (id) annulerRelanceProgrammee(id)
    },
    [annulerRelanceProgrammee]
  )
  /**
   * L'avancement de la boucle, PAR CONVERSATION — `tour` = dernier tour déjà traité (un re-rendu du
   * même tour ne renvoie rien), `prompt` = dernier texte envoyé (la même suite deux fois = boucle).
   *
   * DÉFAUT VÉCU le 2026-09-02 : « j'étais en mode auto et t'as pas enchaîné le workflow ». Les
   * horaires des journaux de tours le montrent — trois conversations tournaient en parallèle
   * et la boucle, tenue par des compteurs UNIQUES, ne pouvait suivre
   * que le fil affiché. Un état par conversation est la condition pour enchaîner les autres.
   */
  const autoEtatsRef = useRef(new Map<string, { tour: string | null; prompt: string | null }>())
  /*
   * GARDE-FOU DE LA CHAÎNE ∞ (2026-10-02) : quota hebdomadaire Claude relevé (cache 60 s
   * côté main) et tours automatiques d'affilée comptés par fil. La DÉCISION reste dans
   * `deciderRelanceAuto` : ici on ne fait que lui fournir ces deux chiffres et les seuils réglés.
   */
  const quotaHebdoRef = useRef<number | null>(null)
  /** Faux tant qu'aucun relevé n'a donné le quota : le fil le dit quand ∞ est allumé. */
  const [quotaHebdoConnu, setQuotaHebdoConnu] = useState(false)
  const toursAutoRef = useRef(lireToursAuto(window.localStorage))
  function gardeChaine(id: string): {
    quotaHebdoPct: number | null
    toursAutoDAffilee: number
    seuilsChaine: ReturnType<typeof lireSeuilsChaine>
  } {
    return {
      quotaHebdoPct: quotaHebdoRef.current,
      toursAutoDAffilee: toursAutoRef.current.get(id) ?? 0,
      seuilsChaine: lireSeuilsChaine(window.localStorage.getItem(CLE_SEUILS_CHAINE_AUTO))
    }
  }
  /**
   * Fils dont un tour a été VU tourner pendant que l'interrupteur est armé. C'est ce qui distingue
   * « un tour vient de finir sous mon autorité » (à enchaîner, même si l'écran est ailleurs) d'une
   * « vieille réponse d'un fil qu'on rouvre » (à ne JAMAIS relancer — le tour serait payé sans que
   * personne l'ait demandé, règle déjà figée par `ChatView.mode-auto-allumage.test.tsx`).
   */
  const autoSuiviesRef = useRef(new Set<string>())
  /** Nombre de repassages déjà faits sur un fil dont le texte n'était pas encore complet. */
  const autoEssaisRef = useRef(new Map<string, number>())
  /** Simple réveil de la boucle d'arrière-plan : rien d'autre ne change quand un fil est en retard. */
  const [autoTic, setAutoTic] = useState(0)
  /**
   * L'interrupteur vient d'être allumé À LA MAIN : ce clic PORTE sur la réponse affichée, donc la
   * suite proposée part tout de suite. Défaut vécu le 2026-09-02 (« j'ai mis le mode auto et je
   * dois encore faire tab+entrée ») : l'amorce anti-vieille-réponse, faite pour le CHANGEMENT de
   * fil, marquait aussi ce tour-là comme déjà traité, et il ne partait rien.
   */
  const autoAllumageManuelRef = useRef(false)
  /**
   * REDEMARRAGE VOULU PAR L'AGENT — ce n'est PAS l'ouverture d'un fil.
   *
   * Defaut vecu le 2026-09-05 : l'agent appelle `restart_app` au milieu d'une chaine en
   * mode auto. Au retour, le repere « premier passage dans ce fil » vit en memoire seule, donc il
   * est vide : la boucle croit ARRIVER dans la conversation, fige le dernier tour comme deja traite
   * et saute le maillon suivant. L'interrupteur reste allume, mais la chaine s'arrete en silence —
   * l'utilisateur voit une suite proposee qui ne part jamais et doit la renvoyer a la main.
   *
   * Une consigne de reprise POSEE SUR LE DISQUE prouve que le redemarrage etait volontaire et que
   * la chaine continue. On ne fige donc pas ce tour-la. Sans consigne (fermeture subie, simple
   * rafraichissement), le garde-fou d'origine s'applique tel quel : on ne relance pas un vieux fil.
   */
  const autoRepriseApresRedemarrageRef = useRef(false)
  /** Fil où la boucle a déjà pris son point de départ (anti-relance d'une vieille réponse). */
  const autoFilAmorceRef = useRef<string | null>(null)
  return {
    autoConvs,
    setAutoConvs,
    autoArmePour,
    autoActif,
    autoNouveauFil,
    setAutoNouveauFil,
    autoNouveauFilRef,
    dossierNouveauFil,
    setDossierNouveauFil,
    dossierNouveauFilRef,
    modeleNouveauFil,
    setModeleNouveauFil,
    modeleNouveauFilRef,
    compteNouveauFil,
    setCompteNouveauFil,
    compteNouveauFilRef,
    autoProgrammeesRef,
    autoDiffereesRef,
    annulerRelanceProgrammee,
    desarmerAuto,
    autoEtatsRef,
    quotaHebdoRef,
    quotaHebdoConnu,
    setQuotaHebdoConnu,
    toursAutoRef,
    gardeChaine,
    autoSuiviesRef,
    autoEssaisRef,
    autoTic,
    setAutoTic,
    autoAllumageManuelRef,
    autoRepriseApresRedemarrageRef,
    autoFilAmorceRef
  }
}
