// Date relative en français, pour la bannière de mise à jour. Hors de UpdateBanner.tsx : un fichier
// de composant ne doit exporter que des composants (react-refresh/only-export-components).

/** « il y a 2 h » — une date ISO en relatif français ; la date brute si elle est illisible. */
export function depuis(dateIso: string, maintenant: number = Date.now()): string {
  const instant = Date.parse(dateIso)
  if (!Number.isFinite(instant)) return dateIso
  const secondes = Math.round((instant - maintenant) / 1000)
  const format = new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' })
  const paliers: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60]
  ]
  for (const [unite, duree] of paliers) {
    if (Math.abs(secondes) >= duree) return format.format(Math.round(secondes / duree), unite)
  }
  return 'à l’instant'
}
