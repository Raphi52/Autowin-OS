import { langueCourante } from '../langue'
import { traduireChatPanneaux } from '../textes-ecrans/chat-panneaux'

/**
 * Libellés et ordre des crans d'effort, PARTAGÉS par le menu déroulant et la matrice
 * MODEL × EFFORT. Une seule source pour éviter deux tables divergentes.
 *
 * La liste des efforts REELLEMENT proposés vient toujours du catalogue
 * (`option.reasoningEfforts`) : ces tables ne servent qu'à nommer et ordonner.
 *
 * Les libellés suivent la langue de l'interface (conv-1170) : `effortLabel` est appelé pendant le
 * rendu, qui lit la langue. « Minimal », « Max », « Ultra » s'écrivent pareil dans les deux langues.
 */
const EFFORT_CLES: Record<string, Parameters<typeof traduireChatPanneaux>[0]> = {
  low: 'effort.leger',
  medium: 'effort.moyen',
  high: 'effort.eleve',
  xhigh: 'effort.tresEleve'
}
const EFFORT_IDENTIQUES: Record<string, string> = {
  minimal: 'Minimal',
  max: 'Max',
  ultra: 'Ultra'
}

/** Ordre canonique croissant. Un effort inconnu du catalogue reste affiché, à la fin. */
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

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
  const cle = EFFORT_CLES[effort]
  if (cle) return traduireChatPanneaux(cle, langueCourante())
  return EFFORT_IDENTIQUES[effort] ?? effort
}
