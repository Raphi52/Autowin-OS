import { describe, expect, it } from 'vitest'
import { skillRoots } from './native-registry'
import { skillInstruction } from './skill-pipeline'

/**
 * CONTRAT DE TEXTE — mesuré au banc /arena residus v3 (2026-09-06).
 *
 * Le bras guidé par `residus` a servi DOUZE fois le même signal de retrait
 * (« `cdp-proof-validation.test.mjs` doit rester vert ») pour douze fichiers différents. Le juge
 * externe a vérifié : ce test ne NOMME que trois fichiers (l.73-75), il reste donc vert quoi qu'on
 * supprime. Un signal qui ne nomme pas le fichier retiré ne discrimine RIEN — il donne l'apparence
 * d'une preuve à un retrait non prouvé. Sans ce test, un remaniement du texte efface la règle sans
 * rien casser de visible.
 */
const residus = skillInstruction('residus', skillRoots())

describe('residus — le signal de retrait doit NOMMER le fichier retiré', () => {
  it('injecte bien la skill', () => {
    expect(residus).not.toBe('')
  })

  it('exige que le signal cite le fichier retiré, pas seulement une suite verte', () => {
    expect(residus).toMatch(/signal de retrait/i)
    expect(residus).toMatch(/NOMME|nomme explicitement/)
    expect(residus).toMatch(/fichier retiré|fichier que tu retires/i)
  })

  it('nomme le piège mesuré : un signal partagé par plusieurs items ne discrimine rien', () => {
    expect(residus).toMatch(/ne discrimine rien/i)
    expect(residus).toContain('cdp-proof-validation.test.mjs')
  })

  it('impose la vérification par ouverture du test invoqué', () => {
    expect(residus).toMatch(/ouvre le test|ouvrir le test/i)
  })
})
