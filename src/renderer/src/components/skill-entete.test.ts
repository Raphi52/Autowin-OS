import { describe, expect, it } from 'vitest'
import { decouperSkill } from './skill-entete'

const skills = [{ id: 'draft', description: 'boucle de maquettes' }, { id: 'scout' }]

describe('decouperSkill', () => {
  it('reconnait une skill installee et retire le prefixe', () => {
    expect(decouperSkill('/draft le F5', skills)).toEqual({
      skill: 'draft',
      description: 'boucle de maquettes',
      reste: 'le F5'
    })
  })
  it('laisse un /truc inconnu en texte normal', () => {
    expect(decouperSkill('/truc bidule', skills)).toBeNull()
  })
  it('ignore un message sans prefixe ou un prefixe colle', () => {
    expect(decouperSkill('fais un draft', skills)).toBeNull()
    expect(decouperSkill('/drafty x', skills)).toBeNull()
  })
  it('accepte la skill seule et sans description', () => {
    expect(decouperSkill('/scout', skills)).toEqual({ skill: 'scout', description: undefined, reste: '' })
  })
  it('ne conclut rien tant que l inventaire n est pas lu', () => {
    expect(decouperSkill('/draft x', null)).toBeNull()
  })
})
