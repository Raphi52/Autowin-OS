import { describe, expect, it } from 'vitest'
import { classifyMutationConfidence } from './task-mutation-classifier'

// Mesure du 2026-09-18 (conv-690, run lance-judge-correctif-cibles-cible-src-mu6l123v) : « Lance le
// judge … en lecture seule, sans toucher aux autres fichiers modifiés » a été classée MUTATION ; le
// contrôle final a exigé une modification et refusé 4 fois une revue qui n'en demandait aucune.
describe('« Lance le judge / le scout » — une phase de lecture introduite par un verbe de lancement', () => {
  it.each([
    'Lance le judge sur le correctif CIBLES:/CIBLE: (src/main/scout-cible.ts, src/shared/scout-cible-lecture.ts, scout-cible.pluriel.test.ts, chat-auto-mode.cibles-runs.test.ts), en lecture seule, sans toucher aux autres fichiers modifiés.',
    'Lance le judge sur le correctif',
    'lancer le scout sur src/main',
    'Relance le judge sur ce run',
  ])('%s → read-only', (t) => {
    expect(classifyMutationConfidence(t)).toBe('read-only')
  })
  it.each([
    'Lance le judge puis corrige les findings',
    'Lance le scout et ajoute un test',
    'Lance le build sur le correctif',
  ])('%s → reste mutation', (t) => {
    expect(classifyMutationConfidence(t)).toBe('mutation')
  })
})

describe('« Relance la revue … » — une revue est une phase de lecture', () => {
  it.each([
    'Relance la revue finale du correctif, en lecture seule',
    'Relance la revue finale (orchestrate, phase judge) du correctif CIBLES:/CIBLE: dans D:\AutoWinOS, en lecture seule, sur 4 fichiers uniquement : src/main/scout-cible.ts, src/shared/scout-cible-lecture.ts, src/main/scout-cible.pluriel.test.ts, src/renderer/src/components/chat-auto-mode.cibles-runs.test.ts. Ne touche à aucun autre fichier modifié. Objectif : confirmer que le contrôle final n\'exige plus de modification pour une revue — la cause (src/main/task-mutation-classifier.ts classait « Lance le judge … sans toucher aux autres fichiers modifiés » comme mutation) a été corrigée avant ce redémarrage, test src/main/task-mutation-classifier.lance-judge.test.ts 7/7. Si le run finit vert : rapporte le verdict. S\'il est encore refusé : lis le RUN.md du run pour la ligne « Gate BLOQUÉ » et nomme la cause exacte.',
  ])('%s → read-only', (t) => {
    expect(classifyMutationConfidence(t)).toBe('read-only')
  })
  it('« Relance la revue puis corrige » reste une mutation', () => {
    expect(classifyMutationConfidence('Relance la revue puis corrige les findings')).toBe('mutation')
  })
})

describe('une correction RACONTÉE au passé n’est pas une demande de modification', () => {
  it.each([
    'Lance le judge sur le correctif, la cause a été corrigée avant',
    "judge le lecteur : j'ai modifié scout-cible.ts",
    'Lance le scout, le bug est déjà corrigé',
  ])('%s → read-only', (t) => {
    expect(classifyMutationConfidence(t)).toBe('read-only')
  })
  it.each([
    'Lance le judge, la cause a été corrigée, puis corrige le reste',
    'Corrige ce qui a été cassé',
  ])('%s → reste mutation', (t) => {
    expect(classifyMutationConfidence(t)).toBe('mutation')
  })
})
