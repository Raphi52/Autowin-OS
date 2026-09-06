import { describe, expect, it } from 'vitest'
import { doitRattraperApresReapparition } from './chat-view-model'

/**
 * Mesure du 2026-09-06 sur l'app vivante : fil masque pendant le tour (hauteur 0), reapparu a
 * 2293 px du bas, sans bouton. Ces cas verrouillent QUAND on rattrape — et surtout quand on ne
 * rattrape pas, pour ne pas confisquer au lecteur le droit d'etre remonte.
 */
describe('rattrapage a la reapparition du fil', () => {
  const loinDuBas = { scrollTop: 100, clientHeight: 750, scrollHeight: 3143 }

  it('rattrape un fil qui reapparait loin du bas alors qu on suivait', () => {
    expect(
      doitRattraperApresReapparition({
        suivaitLeBas: true,
        hauteurPrecedente: 0,
        metrics: loinDuBas
      })
    ).toBe(true)
  })

  it('ne rattrape pas si le lecteur avait choisi de remonter', () => {
    expect(
      doitRattraperApresReapparition({
        suivaitLeBas: false,
        hauteurPrecedente: 0,
        metrics: loinDuBas
      })
    ).toBe(false)
  })

  it('ne rattrape pas un simple redimensionnement : le fil n etait pas masque', () => {
    expect(
      doitRattraperApresReapparition({
        suivaitLeBas: true,
        hauteurPrecedente: 800,
        metrics: loinDuBas
      })
    ).toBe(false)
  })

  it('ne rattrape pas un fil deja au bas : rien a rattraper', () => {
    expect(
      doitRattraperApresReapparition({
        suivaitLeBas: true,
        hauteurPrecedente: 0,
        metrics: { scrollTop: 2393, clientHeight: 750, scrollHeight: 3143 }
      })
    ).toBe(false)
  })

  it('ne rattrape pas tant que le fil est ENCORE masque', () => {
    expect(
      doitRattraperApresReapparition({
        suivaitLeBas: true,
        hauteurPrecedente: 0,
        metrics: { scrollTop: 0, clientHeight: 0, scrollHeight: 0 }
      })
    ).toBe(false)
  })
})
