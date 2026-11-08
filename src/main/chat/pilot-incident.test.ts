import { describe, expect, it } from 'vitest'
import { incidentFromPilotEvent } from './pilot-incident'

/**
 * UN RUN VERT QUI ATTEND SA PUBLICATION N'EST PAS UN INCIDENT. Ce module réveille les règles de
 * surveillance : compté « bloqué par une gate », ce run vert déclenchait une alerte sur un travail
 * que la reprise automatique publie seule dès que l'opération git de l'arbre principal se termine.
 */
const issue = (code: string) => ({
  kind: 'result',
  name: 'orchestrate',
  ok: true,
  data: {
    status: 'failed',
    valid: false,
    gateBlocked: true,
    gateReasons: [
      'intégration locale non terminée',
      `blocage d’intégration: ${code} — cause: L’index utilisateur a changé pendant la publication.`
    ]
  }
})

describe('incidentFromPilotEvent et l’attente de publication', () => {
  it('aucun incident pour une opération git en cours ou les fichiers d’un autre fil', () => {
    expect(incidentFromPilotEvent(issue('base-in-progress'))).toBeUndefined()
    expect(incidentFromPilotEvent(issue('base-dirty'))).toBeUndefined()
  })

  it('témoin : un conflit de contenu reste un incident de gate', () => {
    expect(incidentFromPilotEvent(issue('conflict'))?.kind).toBe('gate-failed')
  })
})
