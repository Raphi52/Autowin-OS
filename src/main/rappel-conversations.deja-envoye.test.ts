import { describe, expect, it } from 'vitest'
import { rappelSansDejaEnvoye } from './rappel-conversations'

const rappel = [
  'EN-TETE',
  '— conv-627 « couts »',
  '  > « extrait A » (demande)',
  '  > « extrait B » (réponse)',
  '— conv-624 « prompt »',
  '  > « extrait C » (demande)'
].join('\n')

describe('rappel en session reprise', () => {
  it("n'envoie pas deux fois un extrait deja present dans la session", () => {
    const vus = new Set<string>()
    expect(rappelSansDejaEnvoye(rappel, vus)).toBe(rappel)
    expect(rappelSansDejaEnvoye(rappel, vus)).toBe('')
  })

  it('garde seulement les extraits nouveaux, sous leur conversation', () => {
    const vus = new Set<string>()
    rappelSansDejaEnvoye(rappel, vus)
    const suivant = rappel + '\n  > « extrait D » (réponse)'
    expect(rappelSansDejaEnvoye(suivant, vus)).toBe(
      ['EN-TETE', '— conv-624 « prompt »', '  > « extrait D » (réponse)'].join('\n')
    )
  })
})
