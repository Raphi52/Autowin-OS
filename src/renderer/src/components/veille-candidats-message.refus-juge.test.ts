import { describe, expect, it } from 'vitest'
import { tourRefusePourAutoLancer } from './veille-candidats-message'

// conv-690, tour dc63d3ea-7d64-472b-a6db-773f81ee5d82 : juge refusé, puis clic auto sur 5 candidats.
describe('clic automatique après un refus du juge', () => {
  it('ne part pas d’un tour échoué', () => {
    expect(tourRefusePourAutoLancer('failed', ['## Cible\npiste 1'])).toBe(true)
  })
  it('ne part pas quand le contrôle final a arrêté le workflow', () => {
    expect(
      tourRefusePourAutoLancer('completed', [
        '⛔ Workflow ARRÊTÉ au contrôle final — résultat non validé · statut échoué'
      ])
    ).toBe(true)
    expect(
      tourRefusePourAutoLancer('completed', ['⚠️ Workflow terminé mais le juge a REFUSÉ le résultat'])
    ).toBe(true)
  })
  it('part sur un tour vert', () => {
    expect(tourRefusePourAutoLancer('completed', ['✅ Workflow terminé · statut succeeded'])).toBe(
      false
    )
  })
})
