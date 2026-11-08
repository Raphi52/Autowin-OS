/**
 * Une durée en secondes, telle que le fil l'affiche : « 45 s », « 2 min 30 s », « 3 min ».
 * Arrondie à la seconde. Partagée par le processus principal et l'interface.
 */
export function dureeLisible(secondes: number): string {
  const total = Math.round(secondes)
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  const reste = total % 60
  return reste ? `${minutes} min ${reste} s` : `${minutes} min`
}
