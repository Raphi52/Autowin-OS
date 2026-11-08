/**
 * Un objet à clés (ni `null`, ni tableau) : la garde partagée par le processus principal et
 * l'interface. Une seule version, pour qu'une correction n'oublie aucune copie.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Le même objet à clés, ou `null` : pour lire un champ facultatif d'un JSON reçu. */
export const objetOuNull = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * Tout objet, tableau COMPRIS, ou `undefined`. Plus large qu'`isRecord` : ses appelants lisent les
 * champs d'une donnée d'action sans exiger qu'elle ne soit pas un tableau.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/** Un champ texte facultatif : absent, ou une chaîne. */
export function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}
