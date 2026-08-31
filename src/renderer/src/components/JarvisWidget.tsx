import { useCallback, useEffect, useRef, useState } from 'react'
import { jouerBipEveil } from './jarvis-bip'
import {
  basculerEcoute,
  conversationsEnDirect,
  ecouteInitiale,
  evenementsDirects,
  extraireCommandeEveil,
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

interface MoteurVocal {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: unknown) => void) | null
  onend: (() => void) | null
  onerror: ((e: unknown) => void) | null
  start(): void
  stop(): void
  abort?(): void
}

type FabriqueMoteur = new () => MoteurVocal

function fabriqueMoteur(): FabriqueMoteur | null {
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
}

const apiJarvis = (): ApiJarvis | undefined => (window as unknown as { api?: ApiJarvis }).api

/** Le direct se relit souvent : c'est ce qui le rend « direct ». Assez lent pour rester gratuit. */
const SONDAGE_MS = 4_000
const MAX_EVENEMENTS = 12

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
  const moteurRef = useRef<MoteurVocal | null>(null)
  const actifRef = useRef(false)
  const conversationRef = useRef<string | null>(null)
  const precedentRef = useRef<SommaireDirect[]>([])

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
        return suivant
      }
      const Fabrique = fabriqueMoteur()
      if (!Fabrique) {
        actifRef.current = false
        setErreur('La reconnaissance vocale n’est pas disponible dans cette fenêtre')
        return precedent
      }
      const moteur = new Fabrique()
      moteur.continuous = true
      moteur.interimResults = true
      moteur.lang = 'fr-FR'
      moteur.onresult = auResultat
      moteur.onerror = () => {
        // Une erreur ponctuelle (silence, reseau) n'eteint pas le widget : `onend` suit et relance.
      }
      moteur.onend = () => {
        if (actifRef.current && moteurRef.current === moteur) moteur.start()
      }
      moteurRef.current = moteur
      setErreur(null)
      moteur.start()
      return suivant
    })
  }, [auResultat])

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

      {erreur ? <p className="home-error">{erreur}</p> : null}

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
