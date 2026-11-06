import { describe, expect, it } from 'vitest'
import {
  hydrateStoredAssistant,
  indexDeLaBulleQuiPorte,
  porteUneOrchestrationOuverte
} from './chat-view-model'

/**
 * LE RÉCAPITULATIF « REPRISE DU FIL » NE CACHE PAS LE TOUR VIVANT (2026-10-30).
 *
 * Au redémarrage, le main rattache une orchestration encore vivante et pose SOUS sa bulle un
 * récapitulatif terminé (`Msg.repriseDuChantier`, `index.ts`). La recherche de « la bulle qui porte
 * l'action » remonte le fil et s'arrêtait à la première bulle terminée : ce récapitulatif. Tout ce
 * qui visait le travail repris — note d'activité, lignes de phase, raisonnement — tombait dans le
 * récapitulatif ou se perdait. Vécu : 35 min de travail, fil figé, spinner allumé.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : un marqueur perdu à la relecture, ou un récapitulatif
 * qui arrête encore la recherche.
 */
const fil = [
  { role: 'user' },
  hydrateStoredAssistant({
    content: '',
    turnId: 'tour-lot-3',
    status: 'streaming',
    parts: [{ kind: 'action', actionId: 'route:0', name: 'orchestrate', args: { task: 'lot 3' } }]
  }),
  hydrateStoredAssistant({
    content: 'Reprise du fil — l’agent a continué de travailler.',
    repriseDuChantier: 'run-7b7d533c318e-1'
  })
]

describe('récapitulatif de reprise et bulle du tour vivant', () => {
  it('garde à la relecture le chantier dont il est le récapitulatif', () => {
    expect(fil[2]).toMatchObject({ done: true, repriseDuChantier: 'run-7b7d533c318e-1' })
  })

  it('laisse la recherche passer au-dessus, jusqu’à l’orchestration ouverte', () => {
    expect(indexDeLaBulleQuiPorte(fil, porteUneOrchestrationOuverte)).toBe(1)
  })

  it('une bulle terminée ORDINAIRE arrête toujours la recherche', () => {
    const avecTourClos = [...fil.slice(0, 2), hydrateStoredAssistant({ content: 'fini' })]
    expect(indexDeLaBulleQuiPorte(avecTourClos, porteUneOrchestrationOuverte)).toBe(-1)
  })
})
