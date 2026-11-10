import { useEffect, useState } from 'react'

/**
 * RENDRE LA LISTE DES CONVERSATIONS PAR TRANCHES — gel `renderer:vue-chat-liste` au démarrage
 * (10/11/2026 : 1 349 lignes dessinées dans UN seul passage, 1 261 ms).
 *
 * Même principe que `fil-progressif.ts` pour le fil : on dessine d'abord le haut de la liste, ce que
 * l'utilisateur regarde, puis une tranche de plus par tâche, jusqu'à la liste entière. Entre deux
 * tranches, la fenêtre peint et traite les clics.
 */

/** Lignes dessinées au premier passage : de quoi remplir la barre latérale, avec de la marge. */
export const LIGNES_AU_PREMIER_RENDU = 40

/** Lignes ajoutées à chaque tâche, une fois le premier passage fait. */
export const TRANCHE_DE_LIGNES = 60

/**
 * Nombre de lignes à dessiner, en partant du haut, pour une liste de `total` lignes.
 *
 * Il ne baisse jamais : une liste déjà dessinée ne masque pas ses lignes quand un fil arrive ou
 * qu'une recherche se referme.
 */
export function useLignesDessinees(total: number): number {
  const [dessinees, setDessinees] = useState(LIGNES_AU_PREMIER_RENDU)
  useEffect(() => {
    if (dessinees >= total) return
    const tranche = setTimeout(() => setDessinees((n) => n + TRANCHE_DE_LIGNES), 0)
    return () => clearTimeout(tranche)
  }, [dessinees, total])
  return dessinees
}
