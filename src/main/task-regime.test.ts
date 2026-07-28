import { describe, it, expect } from 'vitest'
import {
  classifyRegime,
  regimePhases,
  phasesForRegime,
  matchExplicitPhase
} from './task-regime'

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

describe('matchExplicitPhase (phase demandée explicitement)', () => {
  it('élit la phase scout sur les 4 formulations', () => {
    expect(matchExplicitPhase('scout')).toBe('scout')
    expect(matchExplicitPhase('scout le routing')).toBe('scout')
    expect(matchExplicitPhase('scoute-moi des candidats')).toBe('scout')
    expect(matchExplicitPhase('scout: trouve des candidats')).toBe('scout')
  })

  it('élit les autres phases du pipeline', () => {
    expect(matchExplicitPhase('frame ce besoin')).toBe('frame')
    expect(matchExplicitPhase('terrain: écris le SOP')).toBe('terrain')
    expect(matchExplicitPhase('build la feature')).toBe('build')
    expect(matchExplicitPhase('clean le dossier')).toBe('clean')
    expect(matchExplicitPhase('judge le livrable')).toBe('judge')
  })

  it('ne matche que le DÉBUT du message, et pas un mot qui englobe la phase', () => {
    expect(matchExplicitPhase('refactor le framework de build')).toBeNull()
    expect(matchExplicitPhase('cleanup du cache')).toBeNull()
    expect(matchExplicitPhase('ajoute un scout plus tard')).toBeNull()
    expect(matchExplicitPhase('')).toBeNull()
  })
})

describe('regimePhases — phase explicite court-circuite le régime', () => {
  it('phase scout élue directement (au lieu du pipeline de régime)', () => {
    expect(regimePhases('scout')).toEqual(['scout'])
    expect(regimePhases('scout le routing')).toEqual(['scout'])
    expect(regimePhases('scoute-moi des candidats')).toEqual(['scout'])
    expect(regimePhases('scout: trouve des candidats')).toEqual(['scout'])
  })

  it('gagne même sur un signal critical (la demande explicite est autoritaire)', () => {
    expect(classifyRegime('scout le pipeline architecture')).toBe('critical')
    expect(regimePhases('scout le pipeline architecture')).toEqual(['scout'])
  })

  it('sans phase explicite, le régime reste inchangé', () => {
    expect(regimePhases('ajoute un bouton export')).toEqual(['frame', 'build'])
  })
})

describe('phasesForRegime', () => {
  it('retourne une copie (pas de mutation partagée)', () => {
    const a = phasesForRegime('critical')
    a.push('judge')
    expect(phasesForRegime('critical')).toEqual(['scout', 'frame', 'terrain', 'build', 'clean'])
  })
})
