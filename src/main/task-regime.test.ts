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

  it("ne transforme pas une interdiction de refactorer en signal de chantier critique", () => {
    expect(
      classifyRegime(
        'Implémente les trois corrections ciblées. Ne pas refactorer ChatView ni renommer les API.'
      )
    ).toBe('standard')
  })

  it("ne transforme pas 'pas de refactor' en signal critique dans un périmètre strict", () => {
    expect(
      classifyRegime(
        'PÉRIMÈTRE STRICT : GraphView.tsx uniquement. Aucun autre fichier modifié (pas de refactor de cohérence).'
      )
    ).toBe('standard')
  })

  it("ne transforme pas 'aucun refactor' en signal critique dans une tâche générée", () => {
    expect(
      classifyRegime(
        'Périmètre STRICT : GraphView.tsx uniquement — aucun autre fichier, aucun refactor de cohérence.'
      )
    ).toBe('standard')
  })

  it("ne classe pas critique l'arrêt borné d'appels orchestrate", () => {
    expect(
      classifyRegime(
        'Aucun refactor. La boucle ne doit lancer ni les créations de conversations/orchestrations suivantes. Compter conversationsCreate/orchestrate : aucune nouvelle conversation ni orchestration ensuite.'
      )
    ).toBe('standard')
  })

  it('conserve les vrais signaux critiques présents après une contrainte négative', () => {
    expect(
      classifyRegime(
        'Ne pas refactorer ChatView ; migrer le schéma de production dans un lot séparé.'
      )
    ).toBe('critical')
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
  it('respecte une commande de skill explicite sans la remplacer par le régime', () => {
    expect(regimePhases('/scout trouve les risques du repo')).toEqual(['scout'])
    expect(regimePhases('/clean')).toEqual(['clean'])
    expect(regimePhases('/judge audite le résultat')).toEqual([])
    expect(regimePhases('/kaizen')).toEqual(['kaizen'])
  })

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

describe('classifyRegime — retouches d\'apparence (conv-210)', () => {
  it('classe une micro-retouche visuelle courte en trivial', () => {
    expect(classifyRegime('enleve la pastille verte')).toBe('trivial')
    expect(classifyRegime('met le nom de la conv en gris')).toBe('trivial')
    expect(classifyRegime('enleve la boite autour du cout')).toBe('trivial')
    expect(classifyRegime('met le titre plus gros et en blanc')).toBe('trivial')
    expect(classifyRegime('aligne le texte MAIN avec l\'icone de branche')).toBe('trivial')
  })

  it('ne rétrograde pas une tâche à risque contenant un mot d\'apparence', () => {
    expect(classifyRegime('enleve la couleur puis refactor le pipeline')).toBe('critical')
    expect(classifyRegime('masque le badge auth en production')).toBe('critical')
  })

  it('ne rétrograde pas une retouche visuelle longue ou multi-clauses', () => {
    expect(
      classifyRegime('enleve la pastille verte ; ensuite met le nom de la conv en gris')
    ).toBe('standard')
  })
})
