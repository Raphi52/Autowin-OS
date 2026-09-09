/**
 * LA LISTE DES MICROS DE LA MACHINE, côté décisions.
 *
 * Ce nommage vivait en dur dans `JarvisWidget.tsx`. Le widget « Enregistrements » a exactement le
 * même besoin — choisir SON micro — et le dupliquer donnerait deux règles de nommage divergentes
 * pour la même liste. Deux faits comptent, et ils viennent du navigateur, pas d'un choix de style :
 *  - avant l'autorisation micro, les libellés sont VIDES : on nomme alors par rang, sinon le menu
 *    affiche des lignes blanches indistinguables ;
 *  - les entrées non-`audioinput` (haut-parleurs, caméras) n'ont rien à faire dans un choix de micro.
 */

export interface MicroDisponible {
  id: string
  nom: string
}

interface PeripheriqueMedia {
  kind: string
  deviceId: string
  label?: string
}

export function microsDepuisPeripheriques(
  peripheriques: readonly PeripheriqueMedia[]
): MicroDisponible[] {
  return peripheriques
    .filter((p) => p.kind === 'audioinput')
    .map((p, index) => ({ id: p.deviceId, nom: p.label || `Micro ${index + 1}` }))
}

/** Énumère les micros RÉELS. Rend une liste vide plutôt que d'échouer : sans énumération possible
 * (permission refusée, environnement sans micro), le micro par défaut du système reste utilisable —
 * on n'affiche simplement aucun choix. */
export async function listerMicros(): Promise<MicroDisponible[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    return microsDepuisPeripheriques(await navigator.mediaDevices.enumerateDevices())
  } catch {
    return []
  }
}
