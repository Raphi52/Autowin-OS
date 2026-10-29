import { describe, expect, it } from 'vitest'
import { skillNommeeEnTete } from './skill-nommee'

const noms = ['draft', 'kaizen', 'scout', 'think', 'salvage']

describe('skillNommeeEnTete', () => {
  it('reconnait la forme avec barre, comme avant', () => {
    expect(skillNommeeEnTete('/draft le F5', noms)).toEqual({
      skill: 'draft',
      reste: 'le F5',
      barre: true
    })
  })

  it('reconnait le nom NU en tete (conv-988)', () => {
    expect(skillNommeeEnTete('draft des animations pour quand je change de view', noms)).toEqual({
      skill: 'draft',
      reste: 'des animations pour quand je change de view',
      barre: false
    })
    expect(skillNommeeEnTete('KAIZEN', noms)).toEqual({ skill: 'kaizen', reste: '', barre: false })
    expect(skillNommeeEnTete('salvage.', noms)?.reste).toBe('')
    expect(skillNommeeEnTete('think : Brain injoignable', noms)?.reste).toBe('Brain injoignable')
  })

  it('ne prend ni une mention, ni un mot voisin, ni une skill inconnue', () => {
    expect(skillNommeeEnTete('fais un draft', noms)).toBeNull()
    expect(skillNommeeEnTete('drafty x', noms)).toBeNull()
    expect(skillNommeeEnTete('scouting des trucs', noms)).toBeNull()
    expect(skillNommeeEnTete('scouté hier', noms)).toBeNull()
    expect(skillNommeeEnTete('bonjour', noms)).toBeNull()
    expect(skillNommeeEnTete('/truc bidule', noms)).toBeNull()
    expect(skillNommeeEnTete('', noms)).toBeNull()
  })

  it('ne prend pas une reponse chiffree « draft = 6 » (conv-427)', () => {
    expect(skillNommeeEnTete('draft = 6 ask = 10', noms)).toBeNull()
  })

  it('ne corrige PAS une faute de frappe sur le nom nu', () => {
    expect(skillNommeeEnTete('darft un menu', noms)).toBeNull()
  })

  it('exige la barre pour git : « git status… » parle de la commande, pas de /git (conv-1250)', () => {
    const avecGit = [...noms, 'git']
    expect(skillNommeeEnTete('/git', avecGit)).toEqual({ skill: 'git', reste: '', barre: true })
    expect(skillNommeeEnTete('/git pr', avecGit)?.reste).toBe('pr')
    expect(skillNommeeEnTete('git status me dit que tout est propre ?', avecGit)).toBeNull()
    expect(skillNommeeEnTete('git push refusé, pourquoi', avecGit)).toBeNull()
  })
})
