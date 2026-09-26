/**
 * Heure d'écriture d'un message, montrée au survol à côté de « Toi ».
 * Court : « 14:32 » aujourd'hui, « hier 09:15 », sinon « 12 sept. 16:40 » (année ajoutée si autre).
 */
function hhmm(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function memeJour(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

export function formaterHeureMessage(ts: number, maintenant: number = Date.now()): string {
  const d = new Date(ts)
  const now = new Date(maintenant)
  if (memeJour(d, now)) return hhmm(d)
  const hier = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (memeJour(d, hier)) return `hier ${hhmm(d)}`
  const jour = d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' })
  })
  return `${jour} ${hhmm(d)}`
}

/** Date complète pour l'infobulle : « mercredi 24 septembre 2026 à 14:32:07 ». */
export function formaterHeureComplete(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'medium' })
}
