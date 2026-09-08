import { describe, expect, it } from 'vitest'
import { verdictVivacite } from './verdict-vivacite'

describe('verdict de vivacite d une fenetre', () => {
  it('ne declare un gel que si l evaluation triviale ne repond pas', () => {
    expect(verdictVivacite({ repond: false })).toEqual({ etat: 'gelee' })
  })

  it('NE declare PAS un gel quand la page est cachee et ne rend aucune image', () => {
    expect(verdictVivacite({ repond: true, visibilite: 'hidden' })).toEqual({
      etat: 'vivante-non-mesurable',
      motif: 'page-cachee'
    })
  })

  it('juge la fluidite seulement sur une page visible', () => {
    expect(verdictVivacite({ repond: true, visibilite: 'visible', images: 89 })).toEqual({
      etat: 'vivante',
      fluide: true,
      images: 89
    })
  })

  it('signale une page visible mais poussive sans crier au gel', () => {
    expect(verdictVivacite({ repond: true, visibilite: 'visible', images: 4 })).toEqual({
      etat: 'vivante',
      fluide: false,
      images: 4
    })
  })
})
