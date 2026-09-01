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
  titreEnregistrement,
  type FichierEnregistre
} from './enregistrements'

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

  const moteurRef = useRef<MoteurVocal | null>(null)
  const actifRef = useRef(false)
  const sessionRef = useRef<string | null>(null)
  const whisperRef = useRef<boolean>(false)

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
    moteurRef.current?.stop()
    moteurRef.current = null
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
    async (texte: string) => {
      const propre = texte.trim()
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
    (evenement: unknown) => {
      const e = evenement as {
        resultIndex?: number
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
      }
      for (let i = e.resultIndex ?? 0; i < e.results.length; i += 1) {
        const resultat = e.results[i]
        const texte = resultat?.[0]?.transcript ?? ''
        if (resultat?.isFinal === true) {
          setPartiel('')
          void noter(texte)
        } else {
          setPartiel(texte.trim())
        }
      }
    },
    [noter]
  )

  const demarrer = useCallback(async () => {
    const pont = api()
    if (!pont?.transcriptDemarrer) {
      setErreur('Passerelle d’enregistrement indisponible')
      return
    }
    const Fabrique = fabriqueMoteur(whisperRef.current)
    if (!Fabrique) {
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

    const moteur = new Fabrique()
    moteur.continuous = true
    moteur.interimResults = true
    moteur.lang = 'fr-FR'
    moteur.onresult = auResultat
    moteur.onerror = (evenement) => {
      const code = String((evenement as { error?: unknown } | null)?.error ?? 'inconnue')
      // `no-speech` / `aborted` : un micro qui attend, pas une panne — `onend` relance.
      if (code === 'no-speech' || code === 'aborted') return
      setErreur(messageErreurMoteur(code))
      void arreter()
    }
    // La relance est GARDÉE par l'interrupteur : un moteur qui repart après l'arrêt laisserait le
    // micro ouvert à l'insu de l'utilisateur — et écrirait dans un fichier qu'il croit fermé.
    moteur.onend = () => {
      if (actifRef.current && moteurRef.current === moteur) moteur.start()
    }
    moteurRef.current = moteur
    moteur.start()
    await rafraichirListe()
  }, [arreter, auResultat, rafraichirListe])

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
        if (vivant && etat) whisperRef.current = etat.installe === true
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
      actifRef.current = false
      moteurRef.current?.stop()
      moteurRef.current = null
    },
    []
  )

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
