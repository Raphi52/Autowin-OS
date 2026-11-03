import { useEffect, useState } from 'react'
import {
  AFFICHAGE_LOCAL,
  attributsAffichage,
  type AffichageSession
} from '../../shared/affichage-session'
import './assets/affichage-session.css'

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
    appliquerAffichage(document.documentElement, affichage)
  }, [affichage])

  return affichage
}
