import { describe, expect, it } from 'vitest'
import { causeNommee, raisonDeLaCloture, raisonDuGit } from './raison-d-echec'

describe('raisonDuGit — pourquoi le travail du run n’a pas été publié', () => {
  it('traduit base-dirty en clair et nomme les fichiers en cause (conv-916)', () => {
    expect(
      raisonDuGit({
        outcome: 'blocked',
        reason: 'base-dirty',
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']
      })
    ).toBe(
      'Travail non publié : des fichiers non committés de la base bloquent la publication — fichiers en cause : src/a.ts, src/b.ts, src/c.ts (+2)'
    )
  })

  it('une cause observée par Git passe avant la traduction du code', () => {
    expect(
      raisonDuGit({ outcome: 'blocked', reason: 'merge-failed', detail: 'refusé : hook pre-commit' })
    ).toBe('Travail non publié : refusé : hook pre-commit')
  })

  it('nomme un conflit, et un code inconnu tel quel plutôt que de le taire', () => {
    expect(raisonDuGit({ outcome: 'conflict' })).toBe(
      'Travail non publié : conflit de contenu entre le travail du run et la base'
    )
    expect(raisonDuGit({ outcome: 'blocked', reason: 'code-neuf' })).toBe(
      'Travail non publié : blocage « code-neuf »'
    )
  })

  it('une publication réussie ou gardée n’a pas de raison d’échec', () => {
    expect(raisonDuGit({ outcome: 'merged' })).toBeUndefined()
    expect(raisonDuGit({ outcome: 'kept' })).toBeUndefined()
    expect(raisonDuGit(undefined)).toBeUndefined()
  })
})

describe('raisonDeLaCloture — pourquoi le run est rouge', () => {
  const rouge = { status: 'red' as const, totalDurationMs: 1, totalCostUsd: 0 }

  it('reprend les raisons du contrôle final quand il y en a', () => {
    expect(
      raisonDeLaCloture(
        { ...rouge, gateReasons: ['verdict REFUSE', ' intégration locale non terminée '] },
        { etapeEnEchec: 'ignorée' }
      )
    ).toBe('verdict REFUSE · intégration locale non terminée')
  })

  it('sans raison (run arrêté avant le contrôle final), dit quelle étape l’a arrêté', () => {
    expect(
      raisonDeLaCloture(rouge, {
        etapeEnEchec: 'Sous-agent · clean:subagent : You’ve hit your session limit'
      })
    ).toBe(
      'Run arrêté avant le contrôle final — Sous-agent · clean:subagent : You’ve hit your session limit'
    )
  })

  it('une publication refusée passe avant l’étape en échec', () => {
    expect(
      raisonDeLaCloture(rouge, { git: 'Travail non publié : x', etapeEnEchec: 'y' })
    ).toBe('Travail non publié : x')
  })

  it('n’invente rien quand rien n’a été écrit, et le dit', () => {
    expect(raisonDeLaCloture(rouge, {})).toBe('Run en échec : aucune raison n’a été enregistrée')
  })

  it('une clôture verte, dégradée ou ouverte n’a pas de raison d’échec', () => {
    expect(raisonDeLaCloture({ ...rouge, status: 'green' }, { etapeEnEchec: 'x' })).toBeUndefined()
    expect(raisonDeLaCloture({ ...rouge, status: 'degraded-closed' }, {})).toBeUndefined()
    expect(raisonDeLaCloture({ ...rouge, status: 'open' }, {})).toBeUndefined()
  })
})

describe('causeNommee', () => {
  it('préfixe la cause du nom de l’étape, et avoue une cause absente', () => {
    expect(causeNommee('Orchestrateur', ' quota atteint ')).toBe('Orchestrateur : quota atteint')
    expect(causeNommee('Orchestrateur', undefined)).toBe(
      'Orchestrateur a échoué sans écrire de cause'
    )
    expect(causeNommee(undefined, undefined)).toBe('une étape a échoué sans écrire de cause')
  })
})
