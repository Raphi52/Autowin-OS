/** Un nombre sur deux chiffres au moins (« 07 », « 12 ») : heures, minutes, jours et mois affichés. */
export const deuxChiffres = (n: number): string => String(n).padStart(2, '0')
