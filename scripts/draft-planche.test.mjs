import { describe, expect, it } from 'vitest'
import { etatsParDefaut, planche } from './draft-planche.mjs'

// conv-2185 : seule la 6ᵉ proposition déclarait un état (« menu-ouvert ») ; la planche ne lisait que les
// états de la 1ʳᵉ et ne l'a jamais montré ouvert — il a fallu un scénario écrit à la main pour le relire.
describe('planche — les états propres à une proposition', () => {
  const avecEtatTardif = {
    propositions: [
      { nom: 'Une', html: '<p>une</p>' },
      { nom: 'Six', html: '<p>six</p>', etats: ['menu-ouvert'] }
    ]
  }

  it('relit par défaut les états de TOUTES les propositions, pas seulement de la 1ʳᵉ', () => {
    expect(etatsParDefaut(avecEtatTardif)).toEqual(['repos', 'menu-ouvert'])
  })

  it('garde l\'état de repos de la 1ʳᵉ en tête et ne répète pas un état partagé', () => {
    const themes = {
      propositions: [
        { nom: 'A', html: 'a', etatRepos: 'clair', etats: ['sombre', 'violet'] },
        { nom: 'B', html: 'b', etatRepos: 'clair', etats: ['sombre', 'violet'] }
      ]
    }
    expect(etatsParDefaut(themes)).toEqual(['clair', 'sombre', 'violet'])
  })

  it('ne montre une proposition dans un état que si elle le déclare, comme le carrousel', () => {
    const html = planche(avecEtatTardif, ['repos', 'menu-ouvert'])
    expect(html).toContain('menu-ouvert · <b>2 Six</b>')
    expect(html).not.toContain('menu-ouvert · <b>1 Une</b>')
    expect(html).toContain('repos · <b>1 Une</b>')
  })

  it('applique toujours à toutes un état demandé que personne ne déclare (--etats)', () => {
    const html = planche(avecEtatTardif, ['repos', 'sombre'])
    expect(html).toContain('sombre · <b>1 Une</b>')
    expect(html).toContain('sombre · <b>2 Six</b>')
  })
})

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
