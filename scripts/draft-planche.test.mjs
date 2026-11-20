import { describe, expect, it } from 'vitest'
import { planche } from './draft-planche.mjs'

const spec = (reglages) => ({
  css: '.x{color:var(--ex-accent)}',
  reglages,
  propositions: [{ nom: 'Une', html: '<div class="x">a</div>' }]
})

describe('planche — les réglages sont posés à leur valeur de départ', () => {
  it('pose une jauge chiffrée avec son unité', () => {
    const html = planche(spec([{ nom: 'Rayon', variable: '--ex-rayon', min: 0, max: 20, pas: 2, valeur: 14, unite: 'px' }]), ['repos'])
    expect(html).toContain('.dkp{--ex-rayon:14px}')
  })

  // conv-2050 : un réglage de couleur ne porte que `couleur` (pas de `valeur`) ; la planche l'écartait,
  // et toutes les maquettes qui lisaient var(--sa-or) sans repli sortaient sans leur or.
  it('pose aussi un réglage de couleur, qui ne porte que `couleur`', () => {
    const html = planche(
      spec([
        { nom: 'Accent', variable: '--ex-accent', couleur: '#c8963e' },
        { nom: 'Rayon', variable: '--ex-rayon', min: 0, max: 20, pas: 2, valeur: 14, unite: 'px' }
      ]),
      ['repos']
    )
    expect(html).toContain('.dkp{--ex-accent:#c8963e;--ex-rayon:14px}')
  })
})
