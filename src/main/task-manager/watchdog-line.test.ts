import { describe, expect, it } from 'vitest'
import { lineSignature } from './watchdog-line'
import { DEFAULT_WATCHDOG_GUARDS, WatchdogGuardBook } from './watchdog-guards'

/**
 * Contextes RÉELS relevés sur l'instance canary le 2026-08-10. Deux orchestrations rouges de deux
 * runs différents : seuls le n° de conversation et le slug de workspace changent.
 */
const rouge = (conv: string, slug: string): string =>
  `Une orchestration s'est terminée en ROUGE. RUN : C:/Users/x/${conv}/${slug}-workspace/RUN.md Conversation : ${conv}`

describe('lineSignature — les jetons d’OCCURRENCE', () => {
  it('deux orchestrations rouges de runs DIFFÉRENTS ont la même signature', () => {
    expect(lineSignature(rouge('conv-1080', 'build-recuperation-msmz1b4i'))).toBe(
      lineSignature(rouge('conv-42', 'relaunch-scout-knowledge-a1b2c3d4'))
    )
  })

  it('neutralise le numéro de conversation et l’epoch', () => {
    expect(lineSignature('conv-1080 à 1786299971190')).toBe(lineSignature('conv-7 à 1786262386652'))
  })

  it('garde DISTINCTES deux pannes réellement différentes', () => {
    // Contre-test : neutraliser trop rendrait la règle sourde aux vrais incidents.
    expect(lineSignature('Orchestration ROUGE. RUN : aaaaaaaa-workspace/RUN.md')).not.toBe(
      lineSignature('Workflow terminé SANS PREUVE. RUN : aaaaaaaa-workspace/RUN.md')
    )
  })

  it('neutralise toujours horodatage et uuid', () => {
    expect(lineSignature('2026-08-10T10:39:00Z ERROR perdue')).toBe(
      lineSignature('2026-08-09T08:21:11Z ERROR perdue')
    )
  })
})

describe('la dédup MORD désormais sur une orchestration rouge répétée', () => {
  it('le second réveil sur la même panne est refusé', () => {
    // Le défaut observé : 6 réveils en 2 h 30 sur la même panne, dont 3 en une minute, alors que la
    // fenêtre d'apaisement valait 5 minutes. Elle ne pouvait rien : le texte ne se répétait jamais.
    const book = new WatchdogGuardBook(
      { ...DEFAULT_WATCHDOG_GUARDS, dedupWindowMs: 300_000 },
      () => 1_000_000
    )

    expect(book.admit(lineSignature(rouge('conv-1', 'run-aaaaaaaa')), 0).admitted).toBe(true)
    const second = book.admit(lineSignature(rouge('conv-2', 'run-bbbbbbbb')), 0)

    expect(second.admitted).toBe(false)
    expect(second.admitted === false && second.reason).toBe('dedup')
  })
})
