/**
 * LA MINI-ADRESSE (/draft de conv-1317, proposition 6, 2026-10-30) : le bouton de l'en-tête du fil
 * qui ouvre le navigateur intégré. Un petit champ creusé qui dit où en est le navigateur sans
 * l'ouvrir : le site de l'onglet actif, ou le globe seul s'il n'y a rien à montrer. Il remplace
 * l'ovale gris « .btn », plus haut que Détails et sans information.
 *
 * Un composant à part parce qu'il écoute CHAQUE changement du navigateur (chargement, titre) : dans
 * la vue chat, cet état re-rendrait tout le fil à chaque événement, ce qu'elle évite exprès (voir
 * « NAVIGATEUR INTÉGRÉ DU CHAT » dans ChatView.tsx).
 *
 * DÉTAILS, SON VOISIN, EST LE MÊME BOUTON (conv-1317 : « le bouton détail met lui le meme look ») :
 * même classe, et le même repli à l'icône quand l'en-tête manque de place. Il a quitté ChatView.tsx
 * pour la même raison : mesurer l'en-tête là-bas re-rendrait le fil entier.
 */
import { useEffect, useRef, useState } from 'react'
import type { EtatNavigateur } from '../../../shared/navigateur'
import { PanelIcon } from './chat-view-icons'
import { apiNavigateur, siteDeLAdresse, texteNavigateur } from './navigateur-integre-outils'
import './BoutonCreux.css'

/**
 * Largeur intérieure d'en-tête (sans ses marges de 24 px) sous laquelle le site ne s'affiche plus :
 * 280 px pour ce bouton au plus large et Détails, plus 160 px gardés au titre du fil. Sans ce seuil,
 * l'en-tête débordait de 37 px à 1280 px de large, panneau ouvert (mesuré, conv-1317). Mesuré en
 * JavaScript et pas par une requête CSS de conteneur : celle-ci aurait exigé `container-type` sur
 * `.chat` ou `.chat-head`, donc un nouveau contexte d'empilement pour les menus de tout le fil.
 */
const ENTETE_MIN_POUR_LE_SITE = 440
/**
 * Même chose pour le libellé de Détails : 144 px pour le globe, l'écart et Détails, plus 26 px de
 * marge. Sans ce seuil, le passage de 92 à 103 px faisait déborder l'en-tête à 1180 px de large,
 * panneau ouvert (mesuré, conv-1317).
 */
const ENTETE_MIN_POUR_DETAILS = 170

/** Le bouton à poser dans l'en-tête, et si celui-ci atteint `seuil`. Vrai tant que rien n'est mesuré. */
function useEnteteAssezLarge(seuil: number): {
  refBouton: React.RefObject<HTMLButtonElement | null>
  assezLarge: boolean
} {
  const refBouton = useRef<HTMLButtonElement>(null)
  const [assezLarge, setAssezLarge] = useState(true)

  useEffect(() => {
    const entete = refBouton.current?.closest('.chat-head')
    if (!entete || typeof ResizeObserver === 'undefined') return
    const observateur = new ResizeObserver(([mesure]) => {
      setAssezLarge(mesure.contentRect.width >= seuil)
    })
    observateur.observe(entete)
    return () => observateur.disconnect()
  }, [seuil])

  return { refBouton, assezLarge }
}

export interface PropsBoutonNavigateur {
  /** Le fil affiché ; `null` sans fil ouvert : ses onglets lui appartiennent, rien à montrer. */
  conversationId: string | null
  ouvert: boolean
  onBasculer: () => void
}

export function BoutonNavigateur({
  conversationId,
  ouvert,
  onBasculer
}: PropsBoutonNavigateur): React.JSX.Element {
  const [etat, setEtat] = useState<EtatNavigateur | null>(null)
  const { refBouton, assezLarge: placePourLeSite } = useEnteteAssezLarge(ENTETE_MIN_POUR_LE_SITE)

  useEffect(() => {
    const api = apiNavigateur()
    if (!api || !conversationId) return
    let vivant = true
    const recevoir = (suivant: EtatNavigateur): void => {
      // `surEtat` pousse tous les fils confondus.
      if (vivant && suivant.conversationId === conversationId) setEtat(suivant)
    }
    const desabonner = api.surEtat(recevoir)
    void api.etat(conversationId).then(recevoir)
    return () => {
      vivant = false
      desabonner()
    }
  }, [conversationId])

  // Comparé au fil affiché : au changement de fil, l'ancien état n'est pas encore remplacé, et son
  // site ne doit pas s'afficher sur le nouveau fil le temps de la lecture.
  const etatDuFil = etat?.conversationId === conversationId ? etat : null
  const adresse = etatDuFil?.onglets.find((o) => o.id === etatDuFil.ongletActif)?.url ?? ''
  const site = siteDeLAdresse(adresse)
  const action = texteNavigateur(ouvert ? 'fermerPanneau' : 'ouvrirPanneau')

  return (
    <button
      ref={refBouton}
      type="button"
      className="bouton-creux"
      data-testid="chat-navigateur-toggle"
      // Les onglets appartiennent à un fil : sans fil ouvert, le clic n'aurait rien à montrer.
      // fix-ok: cause mesurée (conv-1286, 2026-10-29) — capture réelle sans conversation : clic sans effet visible ; sans cette ligne, NavigateurIntegre.test.tsx « aucun fil ouvert » échoue (code 1), avec elle 31/31 (code 0).
      disabled={!conversationId}
      aria-pressed={ouvert}
      aria-label={site ? `${action} : ${site}` : action}
      title={site ? `${action}\n${adresse}` : action}
      onClick={onBasculer}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
      {site && placePourLeSite && (
        <span className="bouton-creux-texte" data-testid="chat-navigateur-site">
          {site}
        </span>
      )}
    </button>
  )
}

export interface PropsBoutonDetails {
  ouvert: boolean
  libelle: string
  titre: string
  /** Runs encore ouverts du fil ; 0 = pas de compteur. */
  runsOuverts: number
  onBasculer: () => void
}

export function BoutonDetails({
  ouvert,
  libelle,
  titre,
  runsOuverts,
  onBasculer
}: PropsBoutonDetails): React.JSX.Element {
  const { refBouton, assezLarge } = useEnteteAssezLarge(ENTETE_MIN_POUR_DETAILS)
  // Plus de badge « N green » (conv-969, 2026-10-15 : « enlève le badge 2 green du bouton détail ») :
  // seuls les runs encore ouverts méritent un compteur ici.
  const compteur = runsOuverts > 0 ? `${runsOuverts} open` : null

  return (
    <button
      ref={refBouton}
      type="button"
      className="bouton-creux workflow-toggle"
      aria-pressed={ouvert}
      aria-label={compteur ? `${libelle}, ${compteur}` : libelle}
      title={titre}
      onClick={onBasculer}
    >
      <PanelIcon />
      {assezLarge && <span className="bouton-creux-texte">{libelle}</span>}
      {compteur && <span className="thinking-duree">{compteur}</span>}
    </button>
  )
}
