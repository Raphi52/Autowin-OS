import { describe, expect, it } from 'vitest'
import { agirJusqua, attendreDansLaPage, attendreStabilite } from './cdp-attente.mjs'

describe('cdp-attente — attendre un ETAT, jamais une duree', () => {
  it('rend la main DES que la condition est vraie, sans dormir le plafond', async () => {
    let vues = 0
    const debut = Date.now()
    const ok = await attendreDansLaPage(
      () => {
        vues += 1
        return vues >= 3
      },
      'peu importe',
      8000,
      10
    )
    expect(ok).toBe(true)
    expect(vues).toBe(3)
    expect(Date.now() - debut).toBeLessThan(1000)
  })

  /*
   * LE point : une attente qui LEVE remplacerait un faux vert par un faux rouge. Elle rend
   * `false`, et c'est l'assertion de la sonde qui tranche — comme avant le portage.
   */
  it('rend false au plafond au lieu de lever', async () => {
    const ok = await attendreDansLaPage(() => false, 'jamais vrai', 60, 10)
    expect(ok).toBe(false)
  })

  it('teste la condition au moins une fois, meme avec un plafond nul', async () => {
    let vues = 0
    const ok = await attendreDansLaPage(
      () => {
        vues += 1
        return true
      },
      'vrai tout de suite',
      0
    )
    expect(ok).toBe(true)
    expect(vues).toBe(1)
  })

  it('la stabilite demande DEUX lectures identiques, pas une', async () => {
    const textes = ['Chargement…', 'Chargement…!', 'Posé', 'Posé']
    let i = 0
    const ok = await attendreStabilite(() => textes[Math.min(i++, textes.length - 1)], 8000, 10)
    expect(ok).toBe(true)
    expect(i).toBe(4)
  })

  it('rend false si le texte ne se stabilise jamais', async () => {
    let i = 0
    const ok = await attendreStabilite(() => `texte ${i++}`, 60, 10)
    expect(ok).toBe(false)
  })

  /*
   * `agirJusqua` remplace les boucles a compteur d'essais : la borne est un PLAFOND DE TEMPS.
   * Un compteur d'essais est un delai fixe deguise — il ne dit rien de l'etat de la page.
   */
  it("n'agit PAS si l'etat est deja atteint", async () => {
    let actions = 0
    const ok = await agirJusqua(() => true, 'deja vrai', () => (actions += 1), 8000, 10)
    expect(ok).toBe(true)
    expect(actions).toBe(0)
  })

  it("rejoue l'action jusqu'a ce que l'etat arrive, puis s'arrete", async () => {
    let actions = 0
    const ok = await agirJusqua(() => actions >= 3, 'overlay parti', () => (actions += 1), 8000, 10)
    expect(ok).toBe(true)
    expect(actions).toBe(3)
  })

  it('rend false au plafond au lieu de lever, comme les autres attentes', async () => {
    let actions = 0
    const ok = await agirJusqua(() => false, 'jamais vrai', () => (actions += 1), 60, 10)
    expect(ok).toBe(false)
    expect(actions).toBeGreaterThan(0)
  })
})
