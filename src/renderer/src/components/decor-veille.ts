import { useEffect, useState } from 'react'

/**
 * LE FOND 3D EN VEILLE HORS DE L'ACCUEIL, au lieu d'être détruit (conv-337, 2026-10-19).
 *
 * MESURE QUI LE MOTIVE (scripts/banc-decor-budget.mjs, copie d'origin/main) : chaque retour sur
 * l'Accueil reconstruisait tout — contexte WebGL, compilation des programmes, 19 Mo de passants
 * rechargés — et la première image revenait 2,2 à 3,7 s après le clic.
 *
 * CE QUI NE CHANGE PAS : le fond ne se DESSINE que sur l'Accueil (choix de l'utilisateur du
 * 2026-08-31, « enleve le fond 3d partout laisse le que sur accueil »). Hors de l'Accueil, la scène
 * reste en mémoire, cachée, sa boucle d'images arrêtée : aucun calcul, aucun dessin.
 *
 * LE PRIX, et sa borne : la mémoire graphique de la scène reste occupée. Après `DECOR_VEILLE_MS`
 * sans revenir sur l'Accueil, la scène est libérée comme avant — un passage bref au Chat ne coûte
 * plus de reconstruction, une après-midi entière ailleurs ne garde rien en mémoire.
 */
export const DECOR_VEILLE_MS = 5 * 60_000

/**
 * Faut-il garder le fond monté ? Oui tant que l'Accueil est affiché, et pendant `delaiMs` après
 * l'avoir quitté. Jamais avant la première visite de l'Accueil : le fond n'est pas construit pour
 * une session qui ne l'ouvre pas.
 */
export function useDecorEnVeille(actif: boolean, delaiMs = DECOR_VEILLE_MS): boolean {
  // « l'Accueil a été affiché et la veille n'a pas expiré »
  const [garde, setGarde] = useState(actif)
  // État dérivé ajusté pendant le rendu (motif React) : sans cela, le rendu où l'Accueil réapparaît
  // démonterait d'abord la scène.
  if (actif && !garde) setGarde(true)
  useEffect(() => {
    if (actif || !garde) return
    const minuteur = setTimeout(() => setGarde(false), delaiMs)
    return () => clearTimeout(minuteur)
  }, [actif, garde, delaiMs])
  return actif || garde
}
