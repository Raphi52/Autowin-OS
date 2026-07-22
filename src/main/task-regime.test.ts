import { describe, it, expect } from 'vitest'
import { classifyRegime, regimePhases, phasesForRegime } from './task-regime'

describe('classifyRegime', () => {
  it('classe une micro-édition ciblée et courte en trivial', () => {
    expect(classifyRegime('corrige la typo dans le commentaire')).toBe('trivial')
    expect(classifyRegime('bump version to 1.0.1')).toBe('trivial')
  })

  it('classe une tâche architecturale/transverse en critical', () => {
    expect(classifyRegime('refactor le pipeline orchestration')).toBe('critical')
    expect(classifyRegime('migrate le schema de la base en production')).toBe('critical')
    expect(classifyRegime('corrige un bug de sécurité auth')).toBe('critical')
  })

  it('classe le reste en standard (défaut sûr)', () => {
    expect(classifyRegime('ajoute un bouton export CSV à la vue liste')).toBe('standard')
    expect(classifyRegime('')).toBe('standard')
  })

  it('ne classe PAS trivial une tâche longue/multi-clauses même avec un mot trivial', () => {
    const long =
      'renomme la fonction foo en bar, puis mets à jour tous les appelants et vérifie que les tests passent encore correctement partout'
    expect(classifyRegime(long)).not.toBe('trivial')
  })

  it('doute → régime supérieur, jamais sous-traité (critical prime sur trivial)', () => {
    // Contient un signal trivial (renomme) ET un signal critical (architecture) → critical gagne.
    expect(classifyRegime('renomme le module architecture')).toBe('critical')
  })
})

describe('regimePhases', () => {
  it('trivial → build seul', () => {
    expect(regimePhases('corrige la typo')).toEqual(['build'])
  })

  it('standard → frame + build', () => {
    expect(regimePhases('ajoute un bouton export')).toEqual(['frame', 'build'])
  })

  it('critical → les 5 phases scout→clean', () => {
    expect(regimePhases('refactor architecture du pipeline')).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'clean'
    ])
  })
})

describe('phasesForRegime', () => {
  it('retourne une copie (pas de mutation partagée)', () => {
    const a = phasesForRegime('critical')
    a.push('judge')
    expect(phasesForRegime('critical')).toEqual(['scout', 'frame', 'terrain', 'build', 'clean'])
  })
})
