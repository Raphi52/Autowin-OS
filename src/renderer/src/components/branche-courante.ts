import { useEffect, useState } from 'react'

/**
 * LA BRANCHE AFFICHEE DOIT SUIVRE LA BRANCHE REELLE.
 *
 * DEFAUT MESURE le 2026-08-30 : le badge en tete de conversation lisait `getGitState()` dans un
 * `useEffect(..., [])` — UNE fois, au montage de la vue, c'est-a-dire au demarrage de l'app. Le
 * depot, lui, change de branche pendant la session (l'agent lui-meme en cree). L'ecran affichait
 * donc `main` alors que le travail se faisait sur `chore/route-confidence-threshold-097`.
 *
 * Ce n'est pas cosmetique : ce badge existe precisement pour dire « sur quelle branche je
 * m'autorise a demander quoi ». Un nom PERIME est pire que pas de nom — il fait croire a une
 * verification qui n'a pas eu lieu (exactement le faux vert que ce depot traque ailleurs).
 *
 * La lecture est relancee sur les trois evenements qui suivent un changement de branche : le
 * retour de focus sur la fenetre, le retour de visibilite de l'onglet, et un battement periodique
 * pour le cas ou la branche change pendant qu'on regarde l'ecran (un run Autowin le fait). La
 * lecture reste READ-ONLY et silencieuse en echec : mieux vaut rien qu'un nom invente.
 */
const PERIODE_RELECTURE_BRANCHE_MS = 5000

export function useBrancheCourante(
  lire: () => Promise<{ available?: boolean; state?: { branch?: string | null } } | undefined>,
  periodeMs: number = PERIODE_RELECTURE_BRANCHE_MS
): string | null {
  const [branche, setBranche] = useState<string | null>(null)
  useEffect(() => {
    let vivant = true
    const relire = (): void => {
      void Promise.resolve(lire())
        .then((resultat) => {
          if (!vivant) return
          setBranche(resultat?.available ? (resultat.state?.branch ?? null) : null)
        })
        .catch(() => {
          if (vivant) setBranche(null)
        })
    }
    relire()
    const battement = setInterval(relire, periodeMs)
    window.addEventListener('focus', relire)
    document.addEventListener('visibilitychange', relire)
    return () => {
      vivant = false
      clearInterval(battement)
      window.removeEventListener('focus', relire)
      document.removeEventListener('visibilitychange', relire)
    }
  }, [lire, periodeMs])
  return branche
}
