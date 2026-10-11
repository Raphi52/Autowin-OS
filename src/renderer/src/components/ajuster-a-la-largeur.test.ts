// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ajusterALaLargeur, facteurPourTenir } from './ajuster-a-la-largeur'

/** Un bloc dont on impose les largeurs mesurees (happy-dom ne fait aucune mise en page). */
function blocMesure(visible: number, contenu: number): HTMLElement {
  const bloc = document.createElement('div')
  Object.defineProperty(bloc, 'clientWidth', { get: () => visible })
  Object.defineProperty(bloc, 'scrollWidth', { get: () => contenu })
  return bloc
}

describe('un bloc du fil tient dans sa colonne sans defiler en largeur', () => {
  it('reduit un contenu trop large juste assez pour qu il tienne (mesure conv-248)', () => {
    const facteur = facteurPourTenir(329, 1709)
    expect(facteur).toBeLessThan(1)
    expect(1709 * facteur).toBeLessThanOrEqual(329)
    expect(1709 * (facteur + 0.002)).toBeGreaterThan(329)
  })

  it('ne touche ni un contenu qui tient, ni un bloc non mesure', () => {
    expect(facteurPourTenir(600, 600)).toBe(1)
    expect(facteurPourTenir(600, 601)).toBe(1)
    expect(facteurPourTenir(600, 320)).toBe(1)
    expect(facteurPourTenir(0, 0)).toBe(1)
  })

  it('pose le zoom sur le bloc qui deborde et le retire quand il tient de nouveau', () => {
    const large = blocMesure(327, 1366)
    ajusterALaLargeur(large)
    expect(Number(large.style.zoom)).toBeCloseTo(327 / 1366, 2)

    const tient = blocMesure(327, 300)
    tient.style.zoom = '0.5'
    ajusterALaLargeur(tient)
    expect(tient.style.zoom).toBe('')
  })
})
