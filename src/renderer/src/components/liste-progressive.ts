import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * DESSINER LA LISTE DES CONVERSATIONS PAR TRANCHES. Un démarrage qui charge toute la base monte
 * chaque fil dans UN seul passage de rendu : ce passage dépasse la seconde, et c'est le gel
 * `renderer:vue-chat-liste`.
 *
 * On pose d'abord ce que la zone visible peut montrer, puis une tranche de plus à chaque tâche,
 * jusqu'à la liste entière. Entre deux tranches, la fenêtre peint et traite les clics. Même principe
 * que `fil-progressif.ts` pour le fil.
 */

/** Plancher du premier passage : la zone peut ne pas être mesurable (fenêtre cachée, banc de test). */
export const LIGNES_AU_PREMIER_RENDU = 40

/** Lignes en plus de la zone visible au premier passage : on défile sans attendre une tranche. */
export const MARGE_LIGNES = 10

/** Lignes ajoutées à chaque tâche, une fois le premier passage fait. */
export const TRANCHE_DE_LIGNES = 60

/**
 * Lignes à poser au premier passage : celles qui tiennent dans la zone visible, plus la marge, sans
 * jamais descendre sous le plancher. Une hauteur inconnue (0) garde le plancher.
 */
export function lignesPourLaZone(hauteurZone: number, hauteurLigne: number): number {
  if (hauteurZone <= 0 || hauteurLigne <= 0) return LIGNES_AU_PREMIER_RENDU
  return Math.max(LIGNES_AU_PREMIER_RENDU, Math.ceil(hauteurZone / hauteurLigne) + MARGE_LIGNES)
}

/**
 * Nombre de lignes à dessiner, en partant du haut, pour une liste de `total` lignes, et la ref de
 * la zone visible, à poser sur son conteneur.
 *
 * La zone se mesure une fois, à l'attache de son conteneur, quand une ligne existe déjà : sa hauteur
 * réelle fixe ce premier passage. Elle ne se refait pas, pour qu'une fenêtre qui change de taille ne
 * fasse pas reculer la liste. Le nombre ne baisse jamais : une liste déjà dessinée ne masque pas ses
 * lignes quand un fil arrive ou qu'une recherche se referme.
 */
export function useLignesDessinees(total: number): {
  dessinees: number
  refZone: (zone: HTMLElement | null) => void
} {
  // fix-ok: cause mesurée — monter la base entière en un seul passage est le gel au démarrage ; le premier passage reste borné.
  const [dessinees, setDessinees] = useState(LIGNES_AU_PREMIER_RENDU)
  const mesuree = useRef(false)
  useEffect(() => {
    if (dessinees >= total) return
    const tranche = setTimeout(() => setDessinees((n) => n + TRANCHE_DE_LIGNES), 0)
    return () => clearTimeout(tranche)
  }, [dessinees, total])
  // React rappelle cette ref quand la liste change de total, une fois ses lignes posées : la zone a
  // alors sa hauteur réelle, et une ligne existe. Sans fil, rien à mesurer.
  const refZone = useCallback(
    (zone: HTMLElement | null): void => {
      if (mesuree.current || total === 0 || !zone) return
      const ligne = zone.querySelector<HTMLElement>('.conv-item')
      // Sans mise en page (zone cachée, banc de test) : le plancher reste, et la mesure se retente
      // au prochain changement de `total`.
      if (!ligne || zone.clientHeight <= 0 || ligne.offsetHeight <= 0) return
      mesuree.current = true
      const voulues = lignesPourLaZone(zone.clientHeight, ligne.offsetHeight)
      setDessinees((n) => Math.max(n, voulues))
    },
    [total]
  )
  return { dessinees, refZone }
}
