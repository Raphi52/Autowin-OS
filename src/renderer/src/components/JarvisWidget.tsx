import { useCallback, useEffect, useRef, useState } from 'react'
import { jouerBipEveil } from './jarvis-bip'
import { MESSAGE_VERDICT, fractionJauge, verdictMicro } from './jarvis-audio'
import { SEUIL_PAROLE } from './whisper-audio'
import {
  dependancesNavigateur,
  fabriqueWhisper,
  type FabriqueMoteur,
  type MoteurVocal
} from './jarvis-moteur-whisper'
import type { EtatWhisper } from '../../../main/whisper-local'
import {
  basculerEcoute,
  conversationsEnDirect,
  ecouteInitiale,
  evenementsDirects,
  extraireCommandeEveil,
  messageErreurMoteur,
  reagirAParole,
  type ConversationDirecte,
  type EvenementDirect,
  type JarvisEcoute,
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

/**
 * QUEL MOTEUR ECOUTE. MESURE sur cette application : `webkitSpeechRecognition` ouvre bien le micro
 * dans Electron, puis rend le code d erreur `network` — la branche `onerror` ci-dessous l affiche,
 * et une capture datee du 2026-08-31 le montre a l ecran (chemin cite dans l en-tete de
 * `src/main/whisper-local.ts`). La CAUSE de ce code n est PAS etablie dans ce depot : ne l ecris
 * pas comme un fait. Ce qui est etabli suffit — le moteur natif ne transcrit rien ici, et aucun
 * reglage du widget n y change quoi que ce soit. Whisper local, lui, tourne sur la machine et sans reseau ; il
 * passe donc D'ABORD des qu'il est installe, et Web Speech ne reste qu'un secours.
 */
function fabriqueMoteur(whisperInstalle: boolean): FabriqueMoteur | null {
  const api = apiJarvis()
  if (whisperInstalle && api?.whisperTranscrire) {
    const transcrire = api.whisperTranscrire.bind(api)
    return fabriqueWhisper(dependancesNavigateur((wav) => transcrire(wav)))
  }
  const w = window as unknown as {
    SpeechRecognition?: FabriqueMoteur
    webkitSpeechRecognition?: FabriqueMoteur
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

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
  ) => Promise<{ conversationId: string }>
  whisperEtat?: () => Promise<EtatWhisper>
  whisperInstaller?: () => Promise<EtatWhisper>
  whisperTranscrire?: (wav: Uint8Array) => Promise<string>
}

const apiJarvis = (): ApiJarvis | undefined => (window as unknown as { api?: ApiJarvis }).api

/** Le direct se relit souvent : c'est ce qui le rend « direct ». Assez lent pour rester gratuit. */
const SONDAGE_MS = 4_000
const MAX_EVENEMENTS = 12
/** Fenêtre de crête de la jauge : juger sur l'instant ferait clignoter « silence » entre deux syllabes. */
const FENETRE_CRETE_MS = 1_500

export function JarvisWidget({
  onNavigate
}: {
  onNavigate?: (destination: string) => void
}): React.JSX.Element {
  const [ecoute, setEcoute] = useState<JarvisEcoute>(ecouteInitiale)
  const [direct, setDirect] = useState<ConversationDirecte[]>([])
  const [flux, setFlux] = useState<EvenementDirect[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState<string | null>(null)
  const [whisper, setWhisper] = useState<EtatWhisper | null>(null)
  const [reglages, setReglages] = useState(false)
  const [micros, setMicros] = useState<{ id: string; nom: string }[]>([])
  const [micro, setMicro] = useState('')
  const [seuil, setSeuil] = useState(SEUIL_PAROLE)
  const [niveauAudio, setNiveauAudio] = useState(0)
  const [crete, setCrete] = useState(0)
  const creteRef = useRef<{ valeur: number; le: number }>({ valeur: 0, le: 0 })
  const seuilRef = useRef(SEUIL_PAROLE)
  const microRef = useRef('')
  const moteurRef = useRef<MoteurVocal | null>(null)
  const whisperRef = useRef<EtatWhisper | null>(null)
  const actifRef = useRef(false)
  const conversationRef = useRef<string | null>(null)
  const precedentRef = useRef<SommaireDirect[]>([])

  /**
   * LA JAUGE — ce qui répond à « est-ce que je parle dans le vide ? ». Le moteur remonte chaque bloc
   * de micro ; on garde la CRÊTE récente, parce qu'une voix passe par zéro entre deux syllabes.
   */
  const auNiveau = useCallback((mesure: { niveau: number }) => {
    const maintenant = Date.now()
    setNiveauAudio(mesure.niveau)
    const precedent = creteRef.current
    const expiree = maintenant - precedent.le > FENETRE_CRETE_MS
    const valeur = expiree || mesure.niveau >= precedent.valeur ? mesure.niveau : precedent.valeur
    creteRef.current = {
      valeur,
      le: expiree || mesure.niveau >= precedent.valeur ? maintenant : precedent.le
    }
    setCrete(valeur)
  }, [])

  /** La liste des micros. Les libellés n'existent qu'après autorisation : d'où le repli « Micro n ». */
  const listerMicros = useCallback(async () => {
    const media = navigator.mediaDevices as MediaDevices | undefined
    if (!media?.enumerateDevices) return
    try {
      const tous = await media.enumerateDevices()
      setMicros(
        tous
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ id: d.deviceId, nom: d.label || `Micro ${i + 1}` }))
      )
    } catch {
      // Une énumération refusée laisse simplement le micro système par défaut : ce n'est pas une panne.
    }
  }, [])

  /** Envoie un ordre a Jarvis, dans SA conversation — creee au premier ordre, pas au montage. */
  const envoyer = useCallback(async (texte: string) => {
    const api = apiJarvis()
    if (!api?.routeConversationMessage) {
      setErreur('Passerelle des conversations indisponible')
      return
    }
    setEnvoi(texte)
    try {
      if (!conversationRef.current) {
        const creee = await api.conversationsCreate?.({
          title: 'Jarvis',
          category: 'chat',
          provider: 'claude'
        })
        conversationRef.current = creee?.id ?? null
      }
      if (!conversationRef.current) {
        setErreur('Aucune conversation Jarvis')
        return
      }
      await api.routeConversationMessage(conversationRef.current, texte, [])
      setErreur(null)
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setEnvoi(null)
    }
  }, [])

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
        setEcoute((precedent) => {
          const reaction = reagirAParole(precedent, { texte, final, le: Date.now() })
          // Le bip part sur le PARTIEL : c'est ce qui dit « je t'ai entendu, parle maintenant ».
          // Attendre la phrase figée le ferait arriver apres que l'utilisateur a deja parle.
          if (reaction.bip) jouerBipEveil()
          if (reaction.ordre && actifRef.current) void envoyer(reaction.ordre)
          return reaction.etat
        })
      }
    },
    [envoyer]
  )

  const basculer = useCallback(() => {
    setEcoute((precedent) => {
      const suivant = basculerEcoute(precedent, Date.now())
      actifRef.current = suivant.active
      if (!suivant.active) {
        moteurRef.current?.stop()
        moteurRef.current = null
        setNiveauAudio(0)
        setCrete(0)
        creteRef.current = { valeur: 0, le: 0 }
        return suivant
      }
      void listerMicros()
      const Fabrique = fabriqueMoteur(whisperRef.current?.installe === true)
      if (!Fabrique) {
        actifRef.current = false
        setErreur(
          'Aucun moteur de reconnaissance disponible : installez la reconnaissance hors ligne ci-dessous.'
        )
        return precedent
      }
      const moteur = new Fabrique()
      moteur.continuous = true
      moteur.interimResults = true
      moteur.lang = 'fr-FR'
      moteur.onresult = auResultat
      // OPTIONNELS : Web Speech ignore ces champs, la jauge reste alors à zéro sans rien casser.
      moteur.onniveau = auNiveau
      moteur.seuilParole = seuilRef.current
      moteur.peripherique = microRef.current || undefined
      moteur.onerror = (evenement) => {
        const code = String((evenement as { error?: unknown } | null)?.error ?? 'inconnue')
        // `no-speech` / `aborted` = fonctionnement normal d'un micro qui attend : `onend` relance.
        // Tout le reste EMPECHE d'entendre. L'avaler en silence laissait le widget afficher
        // « ecoute en cours » sur un moteur mort — c'est exactement le « il ne m'entend pas ».
        if (code === 'no-speech' || code === 'aborted') return
        actifRef.current = false
        moteurRef.current = null
        setErreur(messageErreurMoteur(code))
        setEcoute((precedent) => ({ ...precedent, active: false, partiel: '' }))
      }
      moteur.onend = () => {
        if (actifRef.current && moteurRef.current === moteur) moteur.start()
      }
      moteurRef.current = moteur
      setErreur(null)
      moteur.start()
      return suivant
    })
  }, [auResultat, auNiveau, listerMicros])

  // Les réglages s'appliquent au moteur DÉJÀ en cours : sinon il faudrait couper puis relancer.
  useEffect(() => {
    seuilRef.current = seuil
    if (moteurRef.current) moteurRef.current.seuilParole = seuil
  }, [seuil])

  /** Changer de micro exige de rouvrir le flux : le périphérique est choisi à `getUserMedia`. */
  useEffect(() => {
    microRef.current = micro
    const moteur = moteurRef.current
    if (!moteur || !actifRef.current) return
    moteur.peripherique = micro || undefined
    moteur.stop()
    moteur.start()
  }, [micro])

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
        setDirect(conversationsEnDirect(sommaires, maintenant))
        if (evenements.length > 0) {
          setFlux((precedent) =>
            [...[...evenements].reverse(), ...precedent].slice(0, MAX_EVENEMENTS)
          )
        }
      } catch {
        // Un sondage rate n'efface pas le direct precedent : mieux vaut une liste d'il y a 4 s
        // qu'un vide qui se lirait « il ne se passe rien ».
      }
    }
    void lire()
    const timer = setInterval(() => void lire(), SONDAGE_MS)
    return () => {
      vivant = false
      clearInterval(timer)
    }
  }, [])

  const verdict = verdictMicro(ecoute.active, crete, seuil)
  const pourcentJauge = Math.round(fractionJauge(niveauAudio) * 100)

  return (
    <div className="jarvis" data-ecoute={ecoute.active ? 'true' : undefined}>
      <div className="jarvis__barre">
        <button
          type="button"
          data-testid="jarvis-bascule"
          className="jarvis__bascule"
          aria-pressed={ecoute.active}
          onClick={basculer}
        >
          {ecoute.active ? '● Écoute en cours — couper' : 'Activer l’écoute'}
        </button>
        <span className="jarvis__aide">
          {!ecoute.active
            ? 'Micro coupé'
            : ecoute.eveille
              ? '🔊 Je vous écoute — dites votre demande'
              : 'Dites « Jarvis » : un bip vous répondra'}
        </span>
      </div>

      <div className="jarvis__jauge-ligne">
        <div
          className="jarvis__jauge"
          data-testid="jarvis-jauge"
          data-verdict={verdict}
          role="meter"
          aria-label="Niveau du micro"
          aria-valuenow={pourcentJauge}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="jarvis__jauge-remplissage" style={{ width: `${pourcentJauge}%` }} />
          <span
            className="jarvis__jauge-seuil"
            style={{ left: `${Math.round(fractionJauge(seuil) * 100)}%` }}
          />
        </div>
        <button
          type="button"
          className="jarvis__reglages-bouton"
          data-testid="jarvis-reglages-bascule"
          aria-expanded={reglages}
          onClick={() => {
            setReglages((v) => !v)
            void listerMicros()
          }}
        >
          ⚙ Audio
        </button>
      </div>
      <p className="jarvis__aide" data-testid="jarvis-verdict">
        {MESSAGE_VERDICT[verdict]}
      </p>

      {reglages ? (
        <div className="jarvis__reglages" data-testid="jarvis-reglages">
          <label className="jarvis__reglage">
            <span>Micro</span>
            <select
              data-testid="jarvis-micro"
              value={micro}
              onChange={(e) => setMicro(e.target.value)}
            >
              <option value="">Micro système par défaut</option>
              {micros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="jarvis__reglage">
            <span>Sensibilité</span>
            <input
              type="range"
              data-testid="jarvis-seuil"
              min={0.002}
              max={0.08}
              step={0.002}
              value={seuil}
              onChange={(e) => setSeuil(Number(e.target.value))}
            />
            <span className="jarvis__aide">seuil {seuil.toFixed(3)}</span>
          </label>
          <span className="jarvis__aide">
            Barre pleine = son reçu. Le repère marque le seuil : sous lui, rien n’est transcrit.
          </span>
        </div>
      ) : null}

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

      <p className="jarvis__partiel" data-testid="jarvis-partiel">
        {ecoute.partiel || (ecoute.active ? '…' : '')}
      </p>

      {envoi ? <p className="jarvis__envoi">Envoi à Jarvis : « {envoi} »</p> : null}

      <ul className="jarvis__paroles" data-testid="jarvis-paroles">
        {ecoute.commandes.slice(0, 5).map((commande) => (
          <li
            key={commande.id}
            data-eveil={extraireCommandeEveil(commande.texte) ? 'true' : undefined}
          >
            {commande.texte}
          </li>
        ))}
      </ul>

      <h3 className="jarvis__titre">Conversations en direct</h3>
      <ul className="jarvis__direct" data-testid="jarvis-direct">
        {direct.length === 0 ? <li className="home-hint">Rien en cours</li> : null}
        {direct.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className="jarvis__lien"
              onClick={() => onNavigate?.('chat')}
              title="Ouvrir le chat"
            >
              <span data-encours={conversation.enCours ? 'true' : undefined}>
                {conversation.enCours ? '● ' : '○ '}
                {conversation.titre}
              </span>
            </button>
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
