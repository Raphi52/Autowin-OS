import { describe, expect, it } from 'vitest'
import { rootDodLabels } from './root-execution-contract'
import { classifyMutationConfidence } from '../orchestration/task-mutation-classifier'
import { tacheAvecLectureRetenue } from '../chat/deux-lectures'

/**
 * LA COMPRÉHENSION AJOUTÉE À LA TÂCHE NE CRÉE AUCUNE OBLIGATION.
 *
 * Elle est une paraphrase du modèle et porte aussi la lecture écartée. Lue comme des mots de
 * l'utilisateur, elle classait une relecture en modification et semait des cases que personne
 * n'avait demandées : le travail était refusé pour une promesse qu'il n'avait jamais faite.
 */
describe('obligations lues dans les mots de l’utilisateur, pas dans la compréhension ajoutée', () => {
  const nue = "judge le panda que t'as fait"
  const avecComprehension = tacheAvecLectureRetenue(
    nue,
    "Lancer la commande judge sur le panda que t'as fait : panel de juges externes, notes par dimension, défauts avec preuve, corrections jusqu'au seuil.",
    "Juger le panda que t'as fait par un simple avis écrit, sans lancer la commande judge (ni panel de juges, ni corrections)."
  )

  it('la tâche d’origine garde le classement de la phrase tapée', () => {
    expect(classifyMutationConfidence(nue)).toBe('read-only')
    expect(classifyMutationConfidence(avecComprehension)).toBe('read-only')
  })

  it('aucune case n’est ajoutée par la compréhension', () => {
    expect(rootDodLabels(avecComprehension)).toEqual(rootDodLabels(nue))
    const tests = tacheAvecLectureRetenue(
      'analyse la mascotte',
      'Analyser la mascotte puis lancer les tests et commiter.'
    )
    expect(rootDodLabels(tests)).toEqual(rootDodLabels('analyse la mascotte'))
  })

  it('contrôle négatif : ce que l’utilisateur demande lui-même reste dû', () => {
    const demande = tacheAvecLectureRetenue(
      'corrige la mascotte et lance les tests',
      'Relire la mascotte.'
    )
    expect(classifyMutationConfidence(demande)).toBe('mutation')
    expect(rootDodLabels(demande)).toEqual(rootDodLabels('corrige la mascotte et lance les tests'))
    expect(rootDodLabels(demande).length).toBeGreaterThan(0)
  })
})
