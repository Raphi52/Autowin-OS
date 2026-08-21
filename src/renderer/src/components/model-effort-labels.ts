/**
 * Libellés et ordre des crans d'effort, PARTAGÉS par le menu déroulant et la matrice
 * MODEL × EFFORT. Une seule source pour éviter deux tables divergentes.
 *
 * La liste des efforts REELLEMENT proposés vient toujours du catalogue
 * (`option.reasoningEfforts`) : ces tables ne servent qu'à nommer et ordonner.
 */
export const EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Léger',
  medium: 'Moyen',
  high: 'Élevé',
  xhigh: 'Très élevé',
  max: 'Max',
  ultra: 'Ultra'
}

/** Ordre canonique croissant. Un effort inconnu du catalogue reste affiché, à la fin. */
export const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export function sortEfforts(efforts: string[]): string[] {
  return [...efforts].sort((a, b) => {
    const ia = EFFORT_ORDER.indexOf(a)
    const ib = EFFORT_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort
}
