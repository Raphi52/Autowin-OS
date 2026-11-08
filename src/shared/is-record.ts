/**
 * Un objet à clés (ni `null`, ni tableau) : la garde partagée par le processus principal et
 * l'interface. Une seule version, pour qu'une correction n'oublie aucune copie.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
