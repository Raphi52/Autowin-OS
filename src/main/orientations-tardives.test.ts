import { describe, expect, it } from 'vitest'
import { avecAvisEnTete, avisOrientationsTardives } from './orientations-tardives'

describe('orientations tardives (conv-798, saisie ts 1790162150940)', () => {
  const q = "l'architecture que tu m'as proposé elle permet de lancer un max de scenarios en simultanés?"
  it('cite la question mot pour mot, en tete du compte-rendu', () => {
    const texte = avecAvisEnTete('✅ Workflow terminé\n\nlong résultat', avisOrientationsTardives([q]))
    expect(texte.startsWith('⚠️')).toBe(true)
    expect(texte).toContain(`> ${q}`)
    expect(texte.indexOf(q)).toBeLessThan(texte.indexOf('Workflow terminé'))
  })
  it('ne touche rien sans orientation', () => {
    expect(avecAvisEnTete('x', avisOrientationsTardives(['  ']))).toBe('x')
  })
})
