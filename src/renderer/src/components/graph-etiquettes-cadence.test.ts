import { describe, expect, it } from 'vitest'
import { doitResynchroniser, signatureCamera } from './graph-etiquettes-cadence'

describe('cadence des etiquettes de themes', () => {
  const camera = { x: 10, y: -4, z: 120 }

  it('ne replace rien tant que la camera et la surface ne bougent pas', () => {
    const premiere = signatureCamera(camera, 800, 600, 17)
    const seconde = signatureCamera({ ...camera }, 800, 600, 17)
    expect(doitResynchroniser(seconde, premiere)).toBe(false)
  })

  it('replace des que la camera bouge', () => {
    const avant = signatureCamera(camera, 800, 600, 17)
    const apres = signatureCamera({ ...camera, z: 121 }, 800, 600, 17)
    expect(doitResynchroniser(apres, avant)).toBe(true)
  })

  it('replace des que la surface ou le nombre d ancres change', () => {
    const avant = signatureCamera(camera, 800, 600, 17)
    expect(doitResynchroniser(signatureCamera(camera, 900, 600, 17), avant)).toBe(true)
    expect(doitResynchroniser(signatureCamera(camera, 800, 600, 18), avant)).toBe(true)
  })

  it('replace au premier passage, sans pose precedente', () => {
    expect(doitResynchroniser(signatureCamera(camera, 800, 600, 3), null)).toBe(true)
  })

  it('tolere une camera absente sans jeter', () => {
    expect(signatureCamera(null, 800, 600, 0)).toBe('sans-camera:800x600:0')
  })
})
