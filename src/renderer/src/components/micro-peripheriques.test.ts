import { describe, expect, it } from 'vitest'
import { microsDepuisPeripheriques } from './micro-peripheriques'

describe('liste des micros', () => {
  it('ne garde que les ENTREES audio, jamais les sorties ni les cameras', () => {
    expect(
      microsDepuisPeripheriques([
        { kind: 'audioinput', deviceId: 'a', label: 'Casque' },
        { kind: 'audiooutput', deviceId: 'b', label: 'Haut-parleurs' },
        { kind: 'videoinput', deviceId: 'c', label: 'Webcam' }
      ])
    ).toEqual([{ id: 'a', nom: 'Casque' }])
  })

  it('NOMME PAR RANG les entrees encore anonymes : un menu de lignes vides ne se choisit pas', () => {
    expect(
      microsDepuisPeripheriques([
        { kind: 'audioinput', deviceId: 'a', label: '' },
        { kind: 'audioinput', deviceId: 'b' }
      ])
    ).toEqual([
      { id: 'a', nom: 'Micro 1' },
      { id: 'b', nom: 'Micro 2' }
    ])
  })
})
