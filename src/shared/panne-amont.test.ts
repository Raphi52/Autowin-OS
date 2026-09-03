import { describe, expect, it } from 'vitest'
import { isUpstreamOutage } from './panne-amont'

describe('panne du fournisseur de modèle', () => {
  it('reconnaît le vocabulaire des fournisseurs et de la couche réseau', () => {
    expect(isUpstreamOutage('overloaded_error', '')).toBe(true)
    expect(isUpstreamOutage('', 'HTTP 503 service unavailable')).toBe(true)
    expect(isUpstreamOutage('fetch failed', '')).toBe(true)
  })

  it('ne prend pas un échec ordinaire pour une panne', () => {
    expect(isUpstreamOutage('tests rouges', '3 assertions en échec')).toBe(false)
    expect(isUpstreamOutage('fichier introuvable', 'ENOENT')).toBe(false)
  })

  /**
   * Le message que NOTRE propre lecteur du CLI produit quand les reprises internes sont épuisées
   * (`src/main/providers/claude.ts`). Il ne contenait aucun des mots surveillés : la panne était
   * donc invisible pour tout ce qui s'appuie sur ce test — reprise du chat comprise.
   */
  it('reconnaît le message d abandon 529 émis par le lecteur du CLI', () => {
    expect(
      isUpstreamOutage(
        'API Claude surchargée (529) — abandon après 10/10 tentatives, aucune réponse. Réessayez.',
        ''
      )
    ).toBe(true)
  })
})
