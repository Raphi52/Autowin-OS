import { useCallback, useEffect, useRef, useState } from 'react'
import { fabriqueMoteur } from './jarvis-moteur'
import type { MoteurVocal } from './jarvis-moteur-whisper'
import { messageErreurMoteur } from './jarvis-voice'
import type { EtatWhisper } from '../../../main/whisper-local'
import {
  ajouterLigneAffichee,
  formaterDuree,
  formaterQuand,
  formaterTaille,
  ligneAttribuee,
  titreEnregistrement,
  type FichierEnregistre,
  type Voix
} from './enregistrements'
import { listerMicros, type MicroDisponible } from './micro-peripheriques'

/**
 * ENREGISTRER LA PAROLE, et voir où elle a atterri.
 *
 * Ce widget existe parce que le bouton « Enregistrer » de Jarvis n'écrivait RIEN : le texte dicté
 * restait en mémoire de fenêtre, plafonné à 40 lignes, effacé au rechargement — une réunion de
 * trois heures était donc perdue. Deux règles portent tout le reste :
 *
 *  - CHAQUE phrase figée part sur le disque immédiatement. Attendre l'arrêt reviendrait à perdre
 *    la séance au premier plantage, c'est-à-dire à déplacer le défaut d'origine.
 *  - Une écriture qui échoue ARRÊTE l'enregistrement et le DIT. Continuer à afficher « ⏺ » sur un
 *    disque muet serait la pire des sorties : on croirait avoir tout, on n'aurait rien.
 *
 * Jarvis n'est jamais appelé ici : le mot « Jarvis » prononcé pendant une réunion ne déclenche
 * aucun tour. C'est le sens même d'un widget à part.
 *
 * DEUX AJOUTS DEMANDÉS LE 2026-09-09, et ce qu'ils changent :
 *  - LE CHOIX DU MICRO, comme dans le widget Jarvis. Le micro par défaut de Windows est souvent
 *    celui d'une webcam : niveau trop bas, transcription en charabia. Le choix s'applique à la
 *    PROCHAINE mise en marche, jamais au flux déjà ouvert.
 *  - LE MODE CONVERSATION TÉLÉPHONIQUE : deux flux transcrits en parallèle dans le MÊME fichier,
 *    le micro (moi) et le son que la machine joue (l'interlocuteur, via Teams ou autre). Deux
 *    contraintes portent tout : chaque ligne dit QUI parle, sinon le fichier est illisible relu ;
 *    et le son du système exige la reconnaissance hors ligne (le moteur du navigateur n'accepte
 *    aucun flux qu'il n'a pas ouvert lui-même), donc ce mode se REFUSE tant qu'elle n'est pas
 *    installée plutôt que de transcrire deux fois le micro.
 */

interface ApiEnregistrements {
  whisperEtat?: () => Promise<EtatWhisper>
  transcriptDemarrer?: () => Promise<{ id: string; nom: string; chemin: string }>
  transcriptAjouter?: (id: string, texte: string) => Promise<{ octets: number }>
  transcriptTerminer?: (id: string) => Promise<{ chemin: string } | null>
  transcriptLister?: (max?: number) => Promise<FichierEnregistre[]>
  transcriptRevealer?: (chemin: string) => Promise<{ ok: true }>
}

const api = (): ApiEnregistrements | undefined =>
  (window as unknown as { api?: ApiEnregistrements }).api

/** Combien de fichiers la liste montre : « les derniers », pas un explorateur de fichiers. */
const MAX_FICHIERS = 8
/** Le pas de l'horloge d'enregistrement affichée. */
const TIC_MS = 1_000

/** Ce qu'on enregistre : sa propre parole, ou un appel à deux voix. */
type ModeEnregistrement = 'dictee' | 'appel'

/** Les deux flux du mode appel, dans l'ordre d'affichage. */
const VOIX_APPEL: readonly Voix[] = ['moi', 'interlocuteur']

export function EnregistrementsWidget(): React.JSX.Element {
  const [enregistre, setEnregistre] = useState(false)
  const [lignes, setLignes] = useState<string[]>([])
  const [partiel, setPartiel] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [fichiers, setFichiers] = useState<FichierEnregistre[]>([])
  const [octets, setOctets] = useState(0)
  const [depuis, setDepuis] = useState<number | null>(null)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [fichierEnCours, setFichierEnCours] = useState<string | null>(null)
  const [mode, setMode] = useState<ModeEnregistrement>('dictee')
  const [micros, setMicros] = useState<MicroDisponible[]>([])
  const [micro, setMicro] = useState('')
  const [whisperInstalle, setWhisperInstalle] = useState(false)

  /** Un moteur PAR VOIX : le micro et le son du système sont deux flux distincts, ouverts et
   * arrêtés séparément. Une seule référence forcerait à en fermer un pour ouvrir l'autre. */
  const moteursRef = useRef<Partial<Record<Voix, MoteurVocal>>>({})
  const actifRef = useRef(false)
  const sessionRef = useRef<string | null>(null)
  const whisperRef = useRef<boolean>(false)
  const microRef = useRef('')
  const monteRef = useRef(true)

  const rafraichirListe = useCallback(async () => {
    const pont = api()
    if (!pont?.transcriptLister) return
    try {
      setFichiers(await pont.transcriptLister(MAX_FICHIERS))
      // La liste dit « il y a 3 min » : sans cette remise a l'heure, ces mots vieillissent a l'ecran.
      setMaintenant(Date.now())
    } catch {
      // Une liste qu'on n'a pas pu relire ne s'efface pas : l'ancienne reste vraie.
    }
  }, [])

  /** Coupe le micro et referme la session. Appelé par le bouton ET par une panne d'écriture. */
  const arreter = useCallback(async () => {
    actifRef.current = false
    for (const m of Object.values(moteursRef.current)) m?.stop()
    moteursRef.current = {}
    setEnregistre(false)
    setPartiel('')
    setDepuis(null)
    const id = sessionRef.current
    sessionRef.current = null
    const pont = api()
    if (id && pont?.transcriptTerminer) {
      try {
        await pont.transcriptTerminer(id)
      } catch {
        // La session est de toute façon close côté fenêtre ; le fichier, lui, est déjà écrit.
      }
    }
    await rafraichirListe()
  }, [rafraichirListe])

  /** Une phrase FIGÉE : elle s'affiche ET part sur le disque, dans cet ordre, sans attendre. */
  const noter = useCallback(
    async (voix: Voix, texte: string, attribuer: boolean) => {
      // L'ATTRIBUTION EST ÉCRITE, pas seulement affichée : le fichier doit rester lisible seul.
      const propre = attribuer ? ligneAttribuee(voix, texte) : texte.trim()
      if (propre === '') return
      setLignes((precedent) => ajouterLigneAffichee(precedent, propre))
      const pont = api()
      const id = sessionRef.current
      if (!id || !pont?.transcriptAjouter) return
      try {
        const ecrit = await pont.transcriptAjouter(id, propre)
        setOctets(ecrit.octets)
        setErreur(null)
      } catch (cause) {
        // ON ARRÊTE. Un enregistrement qui n'écrit plus doit se voir, pas se poursuivre.
        setErreur(
          `Écriture impossible : ${cause instanceof Error ? cause.message : String(cause)} — enregistrement arrêté`
        )
        void arreter()
      }
    },
    [arreter]
  )

  const auResultat = useCallback(
    (voix: Voix, attribuer: boolean) =>
      (evenement: unknown): void => {
        const e = evenement as {
          resultIndex?: number
          results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
        }
        for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
          const resultat = e.results[i]
          const texte = resultat?.[0]?.transcript ?? ''
          if (resultat?.isFinal === true) {
            setPartiel('')
            void noter(voix, texte, attribuer)
          } else {
            setPartiel(texte.trim())
          }
        }
      },
    [noter]
  )

  /**
   * OUVRE UN FLUX ET LE TIENT OUVERT. Un appel par voix : la seule différence est la SOURCE du son
   * (`micro` ou `haut-parleurs`) et l'étiquette écrite devant chaque phrase.
   */
  const ouvrirFlux = useCallback(
    (voix: Voix, attribuer: boolean): boolean => {
      const Fabrique = fabriqueMoteur(
        whisperRef.current,
        microRef.current || undefined,
        voix === 'interlocuteur' ? 'haut-parleurs' : 'micro'
      )
      if (!Fabrique) return false
      const moteur = new Fabrique()
      moteur.continuous = true
      moteur.interimResults = true
      moteur.lang = 'fr-FR'
      moteur.onresult = auResultat(voix, attribuer)
      moteur.onerror = (evenement) => {
        const code = String((evenement as { error?: unknown } | null)?.error ?? 'inconnue')
        // `no-speech` / `aborted` : un micro qui attend, pas une panne — `onend` relance.
        if (code === 'no-speech' || code === 'aborted') return
        // UN APPEL AMPUTÉ D'UNE VOIX EST UN FAUX TRANSCRIPT : on arrête tout et on le dit, plutôt
        // que de continuer à écrire un côté de la conversation en laissant croire qu'on a les deux.
        setErreur(
          voix === 'interlocuteur'
            ? `Le son du système s’est interrompu (${code}) — enregistrement arrêté`
            : messageErreurMoteur(code)
        )
        void arreter()
      }
      // La relance est GARDÉE par l'interrupteur : un moteur qui repart après l'arrêt laisserait le
      // micro ouvert à l'insu de l'utilisateur — et écrirait dans un fichier qu'il croit fermé.
      moteur.onend = () => {
        if (actifRef.current && moteursRef.current[voix] === moteur) moteur.start()
      }
      moteursRef.current[voix] = moteur
      moteur.start()
      return true
    },
    [arreter, auResultat]
  )

  const demarrer = useCallback(async () => {
    const pont = api()
    if (!pont?.transcriptDemarrer) {
      setErreur('Passerelle d’enregistrement indisponible')
      return
    }
    const appel = mode === 'appel'
    // LE REFUS ARRIVE AVANT LE FICHIER. Ouvrir une session pour découvrir ensuite qu'une voix est
    // impossible laisserait un fichier vide daté sur le disque.
    if (appel && !whisperRef.current) {
      setErreur(
        'Le mode conversation exige la reconnaissance hors ligne : installez-la depuis le widget Jarvis.'
      )
      return
    }
    if (!fabriqueMoteur(whisperRef.current, microRef.current || undefined)) {
      setErreur(
        'Aucun moteur de reconnaissance disponible : installez l’écoute hors ligne depuis le widget Jarvis.'
      )
      return
    }
    let session: { id: string; nom: string; chemin: string }
    try {
      session = await pont.transcriptDemarrer()
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
      return
    }
    sessionRef.current = session.id
    setFichierEnCours(session.nom)
    setLignes([])
    setOctets(0)
    setErreur(null)
    setDepuis(Date.now())
    setMaintenant(Date.now())
    setEnregistre(true)
    actifRef.current = true

    for (const voix of appel ? VOIX_APPEL : (['moi'] as const)) {
      if (!ouvrirFlux(voix, appel)) {
        setErreur(
          voix === 'interlocuteur'
            ? 'Le son du système n’a pas pu être capté — enregistrement arrêté'
            : 'Aucun moteur de reconnaissance disponible — enregistrement arrêté'
        )
        void arreter()
        return
      }
    }
    await rafraichirListe()
  }, [arreter, mode, ouvrirFlux, rafraichirListe])

  const basculer = useCallback(() => {
    if (actifRef.current) void arreter()
    else void demarrer()
  }, [arreter, demarrer])

  // L'état de l'écoute locale : elle décide seulement QUEL moteur ouvre le micro.
  useEffect(() => {
    let vivant = true
    const lire = async (): Promise<void> => {
      try {
        const etat = await api()?.whisperEtat?.()
        if (vivant && etat) {
          whisperRef.current = etat.installe === true
          setWhisperInstalle(etat.installe === true)
        }
      } catch {
        // Sans réponse, on retombe sur le moteur du navigateur : c'est déjà le comportement de Jarvis.
      }
      // La liste des fichiers se lit APRES le premier rendu, jamais pendant : la tuile s'affiche
      // sans attendre le disque.
      if (vivant) await rafraichirListe()
    }
    void lire()
    return () => {
      vivant = false
    }
  }, [rafraichirListe])

  // L'horloge d'enregistrement ne tourne QUE pendant l'enregistrement.
  useEffect(() => {
    if (depuis === null) return
    const timer = setInterval(() => setMaintenant(Date.now()), TIC_MS)
    return () => clearInterval(timer)
  }, [depuis])

  // Le micro ne survit pas au démontage de la vue.
  useEffect(
    () => () => {
      monteRef.current = false
      actifRef.current = false
      for (const m of Object.values(moteursRef.current)) m?.stop()
      moteursRef.current = {}
    },
    []
  )

  useEffect(() => {
    microRef.current = micro
  }, [micro])

  /** La liste des micros RÉELS, relue à chaque branchement : un casque branché en cours de séance
   * doit apparaître sans recharger la vue. */
  useEffect(() => {
    const lire = (): void => {
      void listerMicros().then((liste) => {
        if (monteRef.current) setMicros(liste)
      })
    }
    lire()
    navigator.mediaDevices?.addEventListener?.('devicechange', lire)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', lire)
    }
  }, [])

  return (
    <div className="enregistrements" data-enregistre={enregistre ? 'true' : undefined}>
      <div className="enregistrements__barre">
        <button
          type="button"
          data-testid="enregistrements-bascule"
          className="enregistrements__bouton"
          aria-pressed={enregistre}
          onClick={basculer}
        >
          {enregistre ? '■ Arrêter' : '⏺ Enregistrer'}
        </button>
        <span className="enregistrements__etat" data-testid="enregistrements-etat">
          {enregistre && depuis !== null
            ? `${formaterDuree(maintenant - depuis)} · ${lignes.length} phrase${lignes.length > 1 ? 's' : ''} · ${formaterTaille(octets)}`
            : 'Micro coupé — rien n’est écrit'}
        </span>
      </div>

      {/* LE MODE SE CHOISIT MICRO COUPÉ. Le changer en cours de séance devrait rouvrir les flux au
          milieu du fichier : la moitié des lignes serait attribuée, l'autre non. */}
      <label className="enregistrements__champ">
        <span>Mode</span>
        <select
          data-testid="enregistrements-mode"
          value={mode}
          disabled={enregistre}
          onChange={(e) => setMode(e.target.value as ModeEnregistrement)}
        >
          <option value="dictee">Dictée — ce que je dis</option>
          <option value="appel">Conversation — ce que je dis et ce que j’entends</option>
        </select>
      </label>
      {mode === 'appel' ? (
        <span className="enregistrements__aide" data-testid="enregistrements-aide-appel">
          {whisperInstalle
            ? 'Le son de Teams, Meet ou du navigateur est transcrit à part, sous « Interlocuteur ». Windows uniquement.'
            : 'Indisponible : ce mode exige la reconnaissance hors ligne, à installer depuis le widget Jarvis.'}
        </span>
      ) : null}

      <details className="enregistrements__audio" data-testid="enregistrements-audio">
        <summary>Paramètres audio</summary>
        <label className="enregistrements__champ">
          <span>Micro</span>
          <select
            data-testid="enregistrements-peripherique"
            value={micro}
            onChange={(e) => setMicro(e.target.value)}
          >
            <option value="">Micro par défaut du système</option>
            {micros.map((entree) => (
              <option key={entree.id} value={entree.id}>
                {entree.nom}
              </option>
            ))}
          </select>
        </label>
        <span className="enregistrements__aide">
          Un changement de micro s’applique au prochain enregistrement.
        </span>
      </details>

      {erreur ? (
        <p className="home-error" data-testid="enregistrements-erreur">
          {erreur}
        </p>
      ) : null}

      {enregistre ? (
        <>
          <p className="enregistrements__cible" data-testid="enregistrements-cible">
            Écriture au fil de l’eau dans {fichierEnCours ?? '…'}
          </p>
          <p className="enregistrements__partiel" data-testid="enregistrements-partiel">
            {partiel || '…'}
          </p>
          <ul className="enregistrements__lignes" data-testid="enregistrements-lignes">
            {lignes.map((ligne, index) => (
              <li key={`${index}-${ligne.slice(0, 12)}`}>{ligne}</li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="enregistrements__titre">Derniers enregistrements</p>
      {fichiers.length === 0 ? (
        <p className="enregistrements__vide" data-testid="enregistrements-vide">
          Aucun pour l’instant — appuyez sur Enregistrer.
        </p>
      ) : (
        <ul className="enregistrements__fichiers" data-testid="enregistrements-fichiers">
          {fichiers.map((fichier) => (
            <li key={fichier.chemin}>
              <button
                type="button"
                className="enregistrements__fichier"
                title={`Montrer ${fichier.chemin} dans l’explorateur`}
                onClick={() => void api()?.transcriptRevealer?.(fichier.chemin)}
              >
                <span className="enregistrements__fichier-nom">
                  {titreEnregistrement(fichier.nom)}
                </span>
                <span className="enregistrements__fichier-meta">
                  {formaterQuand(fichier.le, maintenant)} · {formaterTaille(fichier.octets)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
