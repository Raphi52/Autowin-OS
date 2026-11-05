import { useEffect, useMemo, useState } from 'react'
import {
  AFFICHAGE_LOCAL,
  attributsAffichage,
  type AffichageSession
} from '../../shared/affichage-session'
import './assets/affichage-session.css'

/**
 * LA FENÊTRE ÉTROITE PREND LA MISE EN PAGE TÉLÉPHONE (demande de l'utilisateur, 2026-11-05) : une
 * fenêtre de PC réduite en largeur doit utiliser la même mise en page étroite que le téléphone, pas
 * seulement une session distante sur petit écran. Point de rupture en pixels CSS de la fenêtre.
 */
export const LARGEUR_FENETRE_ETROITE = 720
export const REQUETE_FENETRE_ETROITE = `(max-width: ${LARGEUR_FENETRE_ETROITE}px)`

/**
 * L'AFFICHAGE SELON LA CONNEXION (conv-1442) — le côté interface : le moteur dit si la session est
 * à distance et si l'écran est celui d'un téléphone (`main/affichage-session.ts`) ; on le pose sur
 * <html> (`data-session="distante"`, `data-ecran="telephone"`), que lit `affichage-session.css`.
 */
export function appliquerAffichage(racine: Element, affichage: AffichageSession): void {
  for (const [nom, valeur] of Object.entries(attributsAffichage(affichage))) {
    if (valeur) racine.setAttribute(nom, valeur)
    else racine.removeAttribute(nom)
  }
}

type ApiAffichage = {
  affichageSession?: () => Promise<AffichageSession>
  onAffichageSession?: (cb: (etat: AffichageSession) => void) => () => void
}

export function useAffichageSession(): AffichageSession {
  const [affichage, setAffichage] = useState<AffichageSession>(AFFICHAGE_LOCAL)
  const [fenetreEtroite, setFenetreEtroite] = useState<boolean>(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(REQUETE_FENETRE_ETROITE).matches : false
  )

  // Suit la largeur de la fenêtre en direct : on la réduit, la mise en page passe en étroit ; on
  // l'élargit, elle revient.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const requete = window.matchMedia(REQUETE_FENETRE_ETROITE)
    const suivre = (): void => setFenetreEtroite(requete.matches)
    requete.addEventListener('change', suivre)
    return () => requete.removeEventListener('change', suivre)
  }, [])

  // Une fenêtre étroite se règle comme un téléphone : même barre du bas, même tiroir des fils.
  const effectif = useMemo<AffichageSession>(
    () => (fenetreEtroite && !affichage.telephone ? { ...affichage, telephone: true } : affichage),
    [affichage, fenetreEtroite]
  )

  useEffect(() => {
    // Absent dans les bancs d'essai de l'interface (pas de moteur) : on reste en affichage local.
    const api = (window as unknown as { api?: ApiAffichage }).api
    if (typeof api?.affichageSession !== 'function') return
    let vivant = true
    const arreter = api.onAffichageSession?.((etat) => setAffichage(etat))
    api
      .affichageSession()
      .then((etat) => {
        if (vivant) setAffichage(etat)
      })
      .catch((erreur: unknown) => {
        // L'affichage local reste : c'est l'interface complète, jamais une interface cassée.
        console.warn('[affichage-session] état de la connexion illisible :', erreur)
      })
    return () => {
      vivant = false
      arreter?.()
    }
  }, [])

  useEffect(() => {
    appliquerAffichage(document.documentElement, effectif)
  }, [effectif])

  return effectif
}
