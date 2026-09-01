import { useCallback, useEffect, useRef, useState } from 'react'
import { jouerBipEveil } from './jarvis-bip'
import { fabriqueMoteur } from './jarvis-moteur'
import { parler, taireJarvis } from './jarvis-parole'

/**
 * Décroissance de la crête par image d'affichage (~60/s) : ~1 s pour retomber d'une voix forte au
 * silence. Plus rapide, le verdict clignote entre les mots ; plus lent, il ment sur l'instant.
 */
const DECROISSANCE_CRETE = 0.96
import { type MoteurVocal } from './jarvis-moteur-whisper'
import { EVENEMENT_NOM_JARVIS, lireNomJarvis, NOM_JARVIS_DEFAUT } from './jarvis-nom'
import {
  MESSAGE_VERDICT,
  SEUIL_MAX,
  SEUIL_MIN,
  SEUIL_PAROLE,
  jaugeDepuisNiveau,
  verdictMicro,
  type VerdictMicro
} from './whisper-audio'
import type { EtatWhisper } from '../../../main/whisper-local'
import {
  basculerEcoute,
  ecouteInitiale,
  evenementsDirects,
  extraireCommandeEveil,
  messageErreurMoteur,
  phraseDeJarvis,
  reagirAParole,
  type EvenementDirect,
  type JarvisEcoute,
  type ModeEcoute,
  type SommaireDirect
} from './jarvis-voice'

/**
 * Le widget d'accueil pour PARLER a Jarvis, et pour voir ce qui se passe pendant qu'on lui parle.
 *
 * Deux choses seulement vivent ici, parce qu'elles ne sont pas testables hors navigateur : le moteur
 * de reconnaissance vocale et le sondage des conversations. Toutes les DECISIONS (une parole
 * compte-t-elle ? est-ce un ordre ? qu'est-ce qui a bouge ?) sont dans `jarvis-voice.ts`, ou elles
 * se prouvent sans micro.
 *
 * Deux gardes qui ne doivent pas etre « simplifiees » :
 *  - la relance sur `onend` est GARDEE par l'interrupteur : un moteur qui repart apres l'arret
 *    laisserait un micro ouvert a l'insu de l'utilisateur.
 *  - rien ne part vers un run sans le mot d'eveil : un micro continu entend toute la piece.
 */


interface ApiJarvis {
  conversations?: () => Promise<SommaireDirect[]>
  conversationsCreate?: (p: {
    title: string
    category: string
    provider: string
  }) => Promise<{ id: string }>
  routeConversationMessage?: (
    id: string,
    message: string,
    attachments: string[]
  ) => Promise<{ conversationId: string; routed?: boolean }>
  whisperEtat?: () => Promise<EtatWhisper>
  whisperInstaller?: () => Promise<EtatWhisper>
  whisperTranscrire?: (wav: Uint8Array) => Promise<string>
  pilotChat?: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    conversationId?: string
  ) => Promise<{ ok: boolean; cancelled: boolean; error?: string }>
}

const apiJarvis = (): ApiJarvis | undefined => (window as unknown as { api?: ApiJarvis }).api

/** Le direct se relit souvent : c'est ce qui le rend « direct ». Assez lent pour rester gratuit. */
const SONDAGE_MS = 4_000
const MAX_EVENEMENTS = 12

/** Longueur du debut de phrase repris dans le titre de la conversation Jarvis. */
const TITRE_MAX = 40

/**
 * Titre de la conversation ouverte par l'assistant : « <son nom> - <debut de l'ordre> ... ».
 * Le titre garde les MOTS de l'utilisateur, coupes sur un espace, jamais reformules.
 *
 * Le nom vient du REGLAGE, plus d'une constante : un utilisateur qui renomme son assistant
 * « Alfred » voyait quand meme arriver des conversations intitulees « Jarvis - ... », donc deux noms
 * pour un seul assistant.
 */
export function titreJarvis(texte: string, nom: string = NOM_JARVIS_DEFAUT): string {
  const propre = texte.replace(/\s+/g, ' ').trim()
  if (!propre) return nom
  if (propre.length <= TITRE_MAX) return `${nom} - ${propre}`
  const coupe = propre.slice(0, TITRE_MAX)
  const espace = coupe.lastIndexOf(' ')
  const debut = espace > TITRE_MAX / 2 ? coupe.slice(0, espace) : coupe
  return `${nom} - ${debut.trimEnd()} ...`
}

/**
 * Le nom regle, RELU EN DIRECT.
 *
 * Le reglage vit dans la meme fenetre que le widget : le navigateur n'y emet pas `storage`, donc
 * sans l'evenement de `jarvis-nom` le widget garderait l'ancien nom jusqu'au redemarrage — c'est
 * exactement « il ne connait pas son nom quand je le change ». Un `ref` accompagne l'etat parce que
 * la reconnaissance vocale lit le nom HORS rendu, dans ses rappels.
 */
function useNomJarvis(): { nom: string; nomRef: React.MutableRefObject<string> } {
  const [nom, setNom] = useState<string>(() => lireNomJarvis(window.localStorage))
  const nomRef = useRef(nom)
  useEffect(() => {
    // Le `ref` est ecrit ICI, jamais pendant le rendu : React interdit d'y toucher au rendu, et
    // c'est ce chemin-la qui doit rester juste puisque le micro lit le nom hors rendu.
    const relire = (): void => {
      const courant = lireNomJarvis(window.localStorage)
      nomRef.current = courant
      setNom(courant)
    }
    window.addEventListener(EVENEMENT_NOM_JARVIS, relire)
    // L'autre fenetre (ou un autre onglet) reste couverte par l'evenement standard.
    window.addEventListener('storage', relire)
    relire()
    return () => {
      window.removeEventListener(EVENEMENT_NOM_JARVIS, relire)
      window.removeEventListener('storage', relire)
    }
  }, [])
  return { nom, nomRef }
}

export function JarvisWidget(): React.JSX.Element {
  const { nom: nomJarvis, nomRef } = useNomJarvis()
  const [ecoute, setEcoute] = useState<JarvisEcoute>(ecouteInitiale)
  /**
   * L'ETAT D'ECOUTE LU HORS RENDU — parce qu'un envoi ne doit JAMAIS partir d'un updater.
   *
   * DEFAUT VECU le 2026-09-01 (conv-46) : une phrase dictee UNE fois lancait jusqu'a 6 tours en
   * 1,5 s. `reagirAParole` etait appelee DANS l'updater de `setEcoute`, et l'ordre partait de la.
   * Or React reexecute un updater a sa guise — deux fois d'office sous StrictMode, davantage
   * quand la file d'updates est rejouee — et chaque rejeu renvoyait la meme phrase au pilote.
   * L'updater redevient PUR : la reaction se calcule ici, sur cette reference, et l'effet de bord
   * (bip, envoi) part une seule fois, hors du rendu.
   */
  const ecouteRef = useRef(ecoute)
  const [flux, setFlux] = useState<EvenementDirect[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState<string | null>(null)
  const [whisper, setWhisper] = useState<EtatWhisper | null>(null)
  const moteurRef = useRef<MoteurVocal | null>(null)
  const whisperRef = useRef<EtatWhisper | null>(null)
  const actifRef = useRef(false)
  const conversationRef = useRef<string | null>(null)
  const precedentRef = useRef<SommaireDirect[]>([])
  const [peripheriques, setPeripheriques] = useState<Array<{ id: string; nom: string }>>([])
  const [peripherique, setPeripherique] = useState('')
  const [seuil, setSeuil] = useState(SEUIL_PAROLE)
  const peripheriqueRef = useRef('')
  const seuilRef = useRef(SEUIL_PAROLE)
  /**
   * LA JAUGE NE PASSE PAS PAR REACT. `auBloc` remonte un niveau ~12 fois par seconde : autant de
   * `setState` re-rendrait tout le direct et le flux à chaque bloc. Le niveau vit donc dans un
   * `ref`, et une boucle `requestAnimationFrame` écrit la largeur directement sur le noeud.
   */
  const niveauRef = useRef(0)
  /**
   * LA CRÊTE RÉCENTE, pas le niveau instantané : entre deux syllabes le RMS retombe à zéro, et un
   * verdict rendu sur l'instantané afficherait « aucun son » en plein milieu d'une phrase. La crête
   * décroît doucement (`DECROISSANCE_CRETE` par image) pour retomber en ~1 s après la parole.
   */
  const creteRef = useRef(0)
  const [verdict, setVerdict] = useState<VerdictMicro>('coupe')
  /**
   * LE VERDICT AFFICHE, derive de l'etat d'ecoute.
   *
   * Micro coupe => 'coupe', sans qu'aucun effet n'ecrive d'etat : un `setState` synchrone dans un
   * effet cascade les rendus (regle react-hooks refusee a la verification). Quand l'ecoute
   * reprend, la boucle d'affichage reecrit `verdict` des la premiere image.
   */
  const verdictAffiche: VerdictMicro = ecoute.active ? verdict : 'coupe'
  const barreRef = useRef<HTMLDivElement | null>(null)
  /** Vrai quand le micro tourne EN MODE ENREGISTREMENT : on note, Jarvis ne repond pas. */
  const enregistre = ecoute.active && ecoute.mode === 'enregistrement'
  const commande = ecoute.active && ecoute.mode === 'jarvis'

  /**
   * FAIT PARLER JARVIS, si tant est qu'il doive parler. L'etat lu est `ecouteRef` — jamais celui du
   * rendu : la reponse part d'un effet de bord asynchrone (fin de tour, echec d'envoi), et l'etat
   * capture par une cloture serait celui d'il y a plusieurs secondes. Micro coupe entre-temps =
   * silence, ce qui est exactement la garde attendue.
   */
  const dire = useCallback((evenement: Parameters<typeof phraseDeJarvis>[1]) => {
    const phrase = phraseDeJarvis(ecouteRef.current, evenement)
    if (phrase) parler(phrase)
  }, [])

  /** Envoie un ordre a Jarvis, dans SA conversation — creee au premier ordre, pas au montage. */
  const envoyer = useCallback(
    async (texte: string) => {
      const api = apiJarvis()
      if (!api?.routeConversationMessage) {
        setErreur('Passerelle des conversations indisponible')
        return
      }
      setEnvoi(texte)
      // JARVIS REPOND. La phrase se decide dans `jarvis-voice.ts` (muet si micro coupe ou en mode
      // enregistrement) ; ici on ne fait que la prononcer.
      dire({ genre: 'ordre' })
      try {
        if (!conversationRef.current) {
          const creee = await api.conversationsCreate?.({
            title: titreJarvis(texte, nomRef.current),
            category: 'chat',
            provider: 'claude'
          })
          conversationRef.current = creee?.id ?? null
        }
        if (!conversationRef.current) {
          setErreur(`Aucune conversation ${nomRef.current}`)
          dire({ genre: 'erreur' })
          return
        }
        const route = await api.routeConversationMessage(conversationRef.current, texte, [])
        // Le routage DESIGNE seulement la conversation cible : il n'ecrit rien et ne lance aucun tour.
        // Sans ce `pilotChat`, l'ordre etait bien entendu et affiche, puis il ne se passait RIEN —
        // exactement le defaut vecu (« il l'a bien note mais rien ne s'est passe »).
        const cible = route?.conversationId ?? conversationRef.current
        if (route?.routed && route.conversationId) conversationRef.current = route.conversationId
        if (!api.pilotChat) {
          setErreur('Passerelle du pilote indisponible : ordre non execute')
          dire({ genre: 'erreur' })
          return
        }
        const resultat = await api.pilotChat([{ role: 'user', content: texte }], cible)
        if (!resultat?.ok && !resultat?.cancelled) {
          setErreur(resultat?.error ?? 'Ordre non execute')
          dire({ genre: 'erreur' })
          return
        }
        setErreur(null)
      } catch (cause) {
        setErreur(cause instanceof Error ? cause.message : String(cause))
        dire({ genre: 'erreur' })
      } finally {
        setEnvoi(null)
      }
    },
    [dire]
  )

  const auResultat = useCallback(
    (event: unknown) => {
      const e = event as {
        resultIndex?: number
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
      }
      for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
        const resultat = e.results[i]
        const texte = resultat?.[0]?.transcript ?? ''
        const final = resultat?.isFinal === true
        const reaction = reagirAParole(
          ecouteRef.current,
          { texte, final, le: Date.now() },
          nomRef.current
        )
        ecouteRef.current = reaction.etat
        setEcoute(reaction.etat)
        // Le bip part sur le PARTIEL : c'est ce qui dit « je t'ai entendu, parle maintenant ».
        // Attendre la phrase figée le ferait arriver apres que l'utilisateur a deja parle.
        if (reaction.bip) jouerBipEveil()
        if (reaction.ordre && actifRef.current) void envoyer(reaction.ordre)
      }
    },
    [envoyer]
  )

  /**
   * ALLUMER / COUPER LE MICRO — ENTIEREMENT HORS DU RENDU.
   *
   * DEFAUT VECU le 2026-09-01 : « jarvis a encore lance 2x la conversation ». L'envoi de l'ordre
   * avait deja ete sorti de l'updater de `setEcoute`, mais la CREATION DU MOTEUR y etait restee.
   * React reexecute librement un updater — deux fois d'office sous StrictMode — donc UN clic
   * ouvrait DEUX micros, chacun entendait la phrase, et chacun envoyait son ordre. Ici tout est
   * calcule sur `ecouteRef` et `setEcoute` ne recoit qu'une VALEUR : un clic = un moteur.
   *
   * LA MESURE : conv-45 et conv-46 ont ete creees a 2 ms d'ecart (11:46:06.602 et .604) avec le
   * meme ordre dicte une seule fois. Meme motif pour conv-12/13 et conv-36/37.
   */
  const basculer = useCallback(
    (mode: ModeEcoute) => {
      const precedent = ecouteRef.current
      const suivant = basculerEcoute(precedent, Date.now(), mode)
      // Tout changement d'etat ferme le moteur courant : basculer de mode sans le fermer
      // laisserait le micro precedent ouvert.
      moteurRef.current?.stop()
      moteurRef.current = null
      // On coupe la parole EN MEME TEMPS que le micro : une phrase encore en cours apres l'arret
      // ferait parler Jarvis alors que l'utilisateur vient de l'eteindre.
      taireJarvis()
      actifRef.current = suivant.active
      if (!suivant.active) {
        ecouteRef.current = suivant
        setEcoute(suivant)
        return
      }
      const Fabrique = fabriqueMoteur(
        whisperRef.current?.installe === true,
        peripheriqueRef.current || undefined
      )
      if (!Fabrique) {
        actifRef.current = false
        setErreur(
          'Aucun moteur de reconnaissance disponible : installez la reconnaissance hors ligne ci-dessous.'
        )
        return
      }
      ecouteRef.current = suivant
      setEcoute(suivant)
      const moteur = new Fabrique()
      moteur.continuous = true
      moteur.interimResults = true
      moteur.lang = 'fr-FR'
      moteur.onresult = auResultat
      moteur.seuilParole = seuilRef.current
      moteur.onniveau = (rms) => {
        niveauRef.current = rms
      }
      moteur.onerror = (evenement) => {
        const code = String((evenement as { error?: unknown } | null)?.error ?? 'inconnue')
        // `no-speech` / `aborted` = fonctionnement normal d'un micro qui attend : `onend` relance.
        // Tout le reste EMPECHE d'entendre. L'avaler en silence laissait le widget afficher
        // « ecoute en cours » sur un moteur mort — c'est exactement le « il ne m'entend pas ».
        if (code === 'no-speech' || code === 'aborted') return
        actifRef.current = false
        moteurRef.current = null
        setErreur(messageErreurMoteur(code))
        const arrete = { ...ecouteRef.current, active: false, partiel: '' }
        ecouteRef.current = arrete
        setEcoute(arrete)
      }
      moteur.onend = () => {
        if (actifRef.current && moteurRef.current === moteur) moteur.start()
      }
      moteurRef.current = moteur
      setErreur(null)
      moteur.start()
    },
    [auResultat]
  )

  /** L'etat REEL de whisper, relu au montage : ni cache, ni supposition. */
  const relireWhisper = useCallback(async (): Promise<EtatWhisper | null> => {
    const api = apiJarvis()
    if (!api?.whisperEtat) return null
    try {
      const etat = await api.whisperEtat()
      whisperRef.current = etat
      setWhisper(etat)
      return etat
    } catch {
      return null
    }
  }, [])

  // L'etat est lu APRES le premier rendu, jamais pendant : le widget s'affiche sans attendre le
  // disque, puis l'offre d'installation apparait si l'ecoute locale manque.
  useEffect(() => {
    let vivant = true
    const lireEtat = async (): Promise<void> => {
      const etat = await relireWhisper()
      if (!vivant || !etat) return
    }
    void lireEtat()
    return () => {
      vivant = false
    }
  }, [relireWhisper])

  /**
   * L'installation, UNE fois. ~215 Mo descendus explicitement par l'utilisateur : rien ne se
   * telecharge dans son dos, et la progression est relue a la source pendant la descente.
   */
  const installerWhisper = useCallback(async () => {
    const api = apiJarvis()
    if (!api?.whisperInstaller) return
    setErreur(null)
    setWhisper((precedent) =>
      precedent
        ? {
            ...precedent,
            installation: { enCours: true, etape: 'demarrage', fraction: 0, erreur: null }
          }
        : precedent
    )
    const suivi = setInterval(() => void relireWhisper(), 1_000)
    try {
      const etat = await api.whisperInstaller()
      whisperRef.current = etat
      setWhisper(etat)
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
      await relireWhisper()
    } finally {
      clearInterval(suivi)
    }
  }, [relireWhisper])

  useEffect(() => {
    seuilRef.current = seuil
    if (moteurRef.current) moteurRef.current.seuilParole = seuil
  }, [seuil])

  useEffect(() => {
    peripheriqueRef.current = peripherique
  }, [peripherique])

  /** La liste des micros REELS de la machine. Les libellés n'existent qu'une fois l'autorisation
   * accordée : avant, le navigateur rend des entrées anonymes — on les nomme alors par rang. */
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let vivant = true
    const lire = async (): Promise<void> => {
      try {
        const tous = await navigator.mediaDevices.enumerateDevices()
        if (!vivant) return
        setPeripheriques(
          tous
            .filter((d) => d.kind === 'audioinput')
            .map((d, index) => ({ id: d.deviceId, nom: d.label || `Micro ${index + 1}` }))
        )
      } catch {
        // Pas d'énumération possible (permission refusée, environnement sans micro) : le micro par
        // défaut reste utilisable, on n'affiche simplement aucun choix.
      }
    }
    void lire()
    // Un micro branché ou débranché pendant la session doit apparaître sans recharger la vue.
    navigator.mediaDevices.addEventListener?.('devicechange', lire)
    return () => {
      vivant = false
      navigator.mediaDevices.removeEventListener?.('devicechange', lire)
    }
  }, [])

  // La boucle d'affichage de la jauge : elle ne tourne QUE pendant l'écoute, sinon elle brûlerait
  // une frame par seconde d'affichage pour peindre une barre vide.
  useEffect(() => {
    if (!ecoute.active) {
      niveauRef.current = 0
      creteRef.current = 0
      // Pas de `setVerdict` ICI : un `setState` synchrone dans un effet cascade les rendus. Micro
      // coupe => le verdict affiche est DERIVE de `ecoute.active` (voir `verdictAffiche`).
      if (barreRef.current) barreRef.current.style.width = '0%'
      return
    }
    let vivant = true
    let image = 0
    const peindre = (): void => {
      if (!vivant) return
      const barre = barreRef.current
      if (barre) {
        const fraction = jaugeDepuisNiveau(niveauRef.current)
        barre.style.width = `${Math.round(fraction * 100)}%`
        barre.dataset.parle = niveauRef.current >= seuilRef.current ? 'true' : 'false'
      }
      creteRef.current = Math.max(niveauRef.current, creteRef.current * DECROISSANCE_CRETE)
      // `setVerdict` ne re-rend QUE si le verdict change : React abandonne un état identique.
      // C'est ce qui autorise cet appel dans une boucle à 60 images/s sans rallumer le rendu.
      setVerdict(verdictMicro(true, creteRef.current, seuilRef.current))
      image = requestAnimationFrame(peindre)
    }
    image = requestAnimationFrame(peindre)
    return () => {
      vivant = false
      cancelAnimationFrame(image)
    }
  }, [ecoute.active])

  // Le micro ne survit pas au demontage de la vue.
  useEffect(
    () => () => {
      actifRef.current = false
      moteurRef.current?.stop()
      moteurRef.current = null
    },
    []
  )

  useEffect(() => {
    let vivant = true
    const lire = async (): Promise<void> => {
      const api = apiJarvis()
      if (!api?.conversations) return
      try {
        const sommaires = await api.conversations()
        if (!vivant) return
        const maintenant = Date.now()
        const evenements = evenementsDirects(precedentRef.current, sommaires, maintenant)
        precedentRef.current = sommaires
        if (evenements.length > 0) {
          setFlux((precedent) =>
            [...[...evenements].reverse(), ...precedent].slice(0, MAX_EVENEMENTS)
          )
          // UNE seule annonce par releve, meme si deux tours finissent ensemble : deux phrases
          // simultanees s'annulent l'une l'autre (`parler` coupe la precedente) et on n'entendrait
          // que la derniere, tronquee.
          const finie = evenements.find((e) => e.genre === 'fin')
          if (finie) dire({ genre: 'fin', sujet: finie.titre })
        }
      } catch {
        // Un sondage rate n'efface pas le fil d'activite deja affiche : mieux vaut un releve
        // d'il y a 4 s qu'un vide qui se lirait « il ne se passe rien ».
      }
    }
    void lire()
    const timer = setInterval(() => void lire(), SONDAGE_MS)
    return () => {
      vivant = false
      clearInterval(timer)
      taireJarvis()
    }
  }, [dire])

  return (
    <div className="jarvis" data-ecoute={ecoute.active ? 'true' : undefined}>
      <div className="jarvis__barre">
        <button
          type="button"
          data-testid="jarvis-bascule"
          className="jarvis__bascule"
          aria-pressed={commande}
          onClick={() => basculer('jarvis')}
        >
          {commande ? '● Écoute en cours — couper' : 'Activer l’écoute'}
        </button>
        {/*
          L'ENREGISTREMENT A SON PROPRE WIDGET (« Enregistrements ») : il ECRIT sur le disque et
          montre les fichiers déjà écrits. Le bouton n'est plus ici, mais le mode l'est encore :
          basculer sur l'enregistrement ne doit toujours RIEN envoyer à Jarvis.
        */}
        <span className="jarvis__aide">
          {!ecoute.active
            ? 'Micro coupé'
            : enregistre
              ? `⏺ Enregistrement du transcript — ${nomJarvis} ne répond pas`
              : ecoute.eveille
                ? '🔊 Je vous écoute — dites votre demande'
                : `Dites « ${nomJarvis} » : un bip vous répondra`}
        </span>
      </div>

      {erreur ? <p className="home-error">{erreur}</p> : null}

      {/*
        L'INSTALLATION, visible tant que l'ecoute locale n'existe pas sur cette machine. Sans elle,
        le seul moteur disponible est celui de Chromium — qui rend `network` dans Electron, donc un
        micro ouvert qui n'entend jamais rien.
      */}
      {whisper && !whisper.installe && apiJarvis()?.whisperInstaller ? (
        <div className="jarvis__whisper">
          <button
            type="button"
            data-testid="jarvis-installer-whisper"
            className="jarvis__whisper-bouton"
            disabled={whisper.installation?.enCours === true}
            onClick={() => void installerWhisper()}
          >
            {whisper.installation?.enCours
              ? `Installation ${whisper.installation.etape}${
                  whisper.installation.fraction !== null
                    ? ` — ${Math.round(whisper.installation.fraction * 100)} %`
                    : '…'
                }`
              : `Installer l’écoute hors ligne (≈ ${whisper.megaoctets} Mo, une seule fois)`}
          </button>
          <span className="jarvis__aide">
            Reconnaissance locale (whisper.cpp) : téléchargée une fois, puis plus aucun réseau.
          </span>
        </div>
      ) : null}
      {whisper?.installe ? (
        <p className="jarvis__aide" data-testid="jarvis-moteur">
          Écoute locale prête — hors ligne
        </p>
      ) : null}

      {/*
        LA PREUVE QUE LE MICRO ENTEND. Sans elle, un micro trop faible produit un silence qui
        ressemble trait pour trait à une panne : rien à l'écran ne distinguait « je parle dans le
        vide » de « Jarvis est cassé ». La barre montre le niveau BRUT, et change d'état dès qu'il
        dépasse le seuil de parole retenu.
      */}
      {ecoute.active ? (
        <div className="jarvis__jauge" data-testid="jarvis-jauge">
          <div className="jarvis__jauge-piste">
            <div className="jarvis__jauge-barre" ref={barreRef} data-testid="jarvis-jauge-barre" />
            <span
              className="jarvis__jauge-seuil"
              style={{ left: `${Math.round(jaugeDepuisNiveau(seuil) * 100)}%` }}
            />
          </div>
          <span className="jarvis__aide" data-testid="jarvis-verdict" data-verdict={verdictAffiche}>
            {MESSAGE_VERDICT[verdictAffiche]}
          </span>
        </div>
      ) : null}

      <details className="jarvis__audio" data-testid="jarvis-audio">
        <summary>Paramètres audio</summary>
        <label className="jarvis__audio-champ">
          <span>Micro</span>
          <select
            data-testid="jarvis-peripherique"
            value={peripherique}
            onChange={(e) => setPeripherique(e.target.value)}
          >
            <option value="">Micro par défaut du système</option>
            {peripheriques.map((micro) => (
              <option key={micro.id} value={micro.id}>
                {micro.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="jarvis__audio-champ">
          <span>Seuil de déclenchement</span>
          <input
            type="range"
            data-testid="jarvis-seuil"
            min={SEUIL_MIN}
            max={SEUIL_MAX}
            step={0.001}
            value={seuil}
            onChange={(e) => setSeuil(Number(e.target.value))}
          />
        </label>
        <span className="jarvis__aide">
          Un changement de micro s’applique à la prochaine activation de l’écoute.
        </span>
      </details>

      <p className="jarvis__partiel" data-testid="jarvis-partiel">
        {ecoute.partiel || (ecoute.active ? '…' : '')}
      </p>

      {envoi ? <p className="jarvis__envoi">Envoi à {nomJarvis} : « {envoi} »</p> : null}

      <ul className="jarvis__paroles" data-testid="jarvis-paroles">
        {/* En enregistrement, la liste EST le transcript : la tronquer a 5 lignes le perdrait. */}
        {ecoute.commandes.slice(0, enregistre ? ecoute.commandes.length : 5).map((parole) => (
          <li
            key={parole.id}
            data-eveil={
              !enregistre && extraireCommandeEveil(parole.texte, nomJarvis) ? 'true' : undefined
            }
          >
            {parole.texte}
          </li>
        ))}
      </ul>

      {flux.length > 0 ? (
        <ul className="jarvis__flux" data-testid="jarvis-flux">
          {flux.map((evenement, index) => (
            <li key={`${evenement.conversationId}-${evenement.le}-${index}`}>
              {evenement.genre === 'message' ? '＋' : '✓'} {evenement.titre}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
