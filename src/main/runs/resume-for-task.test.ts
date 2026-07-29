import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeTaskKey,
  pickResumeForTask,
  type OrchestrationRunState
} from './orchestration-state'

/**
 * REPRENDRE SANS REPAYER.
 *
 * Constaté le 2026-07-29 : le chemin de reprise n'existait qu'au REDÉMARRAGE de l'app. Quand
 * l'utilisateur écrit « reprend » dans une conversation, la commande `orchestrate` relançait de zéro et
 * REPAYAIT les phases déjà produites — à ~1 $ la phase, ce n'est pas un défaut de lisibilité.
 *
 * Les conditions sont volontairement STRICTES : réinjecter un acquis fait SAUTER des phases, donc un
 * faux positif produit un livrable bâti sur du travail étranger. Ces tests verrouillent chaque refus.
 */
const state = (over: Partial<OrchestrationRunState>): OrchestrationRunState => ({
  runId: 'run-1',
  task: 'ajouter un module de durée',
  conversationId: 'conv-1',
  phaseOutputs: [{ phase: 'build', text: 'module écrit' }],
  startedAt: 1_000,
  updatedAt: 2_000,
  ...over
})

const NOW = 10_000

describe('normalizeTaskKey — « la même tâche » à l’espace près', () => {
  it('ignore casse, espaces multiples et bords', () => {
    expect(normalizeTaskKey('  Ajouter   un  MODULE ')).toBe('ajouter un module')
  })
})

describe('pickResumeForTask — reprend, ou refuse en le justifiant', () => {
  it('même tâche, même conversation, acquis non vide → REPRIS', () => {
    const found = pickResumeForTask([state({})], {
      task: 'ajouter un module de durée',
      conversationId: 'conv-1',
      nowMs: NOW
    })
    expect(found?.runId).toBe('run-1')
  })

  it('tolère une réécriture d’espaces et de casse de la tâche', () => {
    const found = pickResumeForTask([state({})], {
      task: '  Ajouter un   module de DURÉE  ',
      conversationId: 'conv-1',
      nowMs: NOW
    })
    expect(found).not.toBeNull()
  })

  it('une AUTRE conversation n’est JAMAIS reprise (travail étranger)', () => {
    expect(
      pickResumeForTask([state({ conversationId: 'conv-2' })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('une AUTRE tâche n’est pas reprise', () => {
    expect(
      pickResumeForTask([state({ task: 'supprimer le module' })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('un acquis VIDE n’est pas un acquis — le reprendre sauterait la phase sans son travail', () => {
    expect(
      pickResumeForTask([state({ phaseOutputs: [{ phase: 'build', text: '   ' }] })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('trop VIEUX → refusé (réinjecter la veille surprendrait)', () => {
    const old = state({ updatedAt: 1 })
    expect(
      pickResumeForTask([old], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: 1 + 25 * 60 * 60 * 1000
      })
    ).toBeNull()
  })

  it('un acquis daté du FUTUR (horloge incohérente) est refusé', () => {
    expect(
      pickResumeForTask([state({ updatedAt: NOW + 5_000 })], {
        task: 'ajouter un module de durée',
        conversationId: 'conv-1',
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('sans conversation, aucune reprise ici (cet acquis appartient au démarrage)', () => {
    expect(
      pickResumeForTask([state({ conversationId: undefined })], {
        task: 'ajouter un module de durée',
        conversationId: undefined,
        nowMs: NOW
      })
    ).toBeNull()
  })

  it('tâche vide → rien (jamais un appariement sur du vide)', () => {
    expect(
      pickResumeForTask([state({ task: '   ' })], { task: '   ', conversationId: 'conv-1', nowMs: NOW })
    ).toBeNull()
  })

  it('plusieurs candidats → le PLUS RÉCENT', () => {
    const found = pickResumeForTask(
      [state({ runId: 'vieux', updatedAt: 2_000 }), state({ runId: 'recent', updatedAt: 8_000 })],
      { task: 'ajouter un module de durée', conversationId: 'conv-1', nowMs: NOW }
    )
    expect(found?.runId).toBe('recent')
  })

  it('aucun état → null', () => {
    expect(
      pickResumeForTask([], { task: 'x', conversationId: 'conv-1', nowMs: NOW })
    ).toBeNull()
  })
})

/**
 * CÂBLAGE — le défaut n'était pas l'absence de mécanisme, c'était que la commande du chat appelait
 * `runTask` en s'arrêtant à 6 arguments : `resumeOutputs` ET `conversationId` étaient omis.
 */
describe('câblage — la commande du chat reprend et rattache la conversation', () => {
  const source = readFileSync(join(__dirname, '..', 'commands.ts'), 'utf8')

  it('elle cherche un acquis pour CETTE tâche et CETTE conversation', () => {
    expect(source).toContain('resumableOrchestrationForTask?.(task, convId)')
  })

  it('elle passe l’acquis À runTask (sinon la recherche ne sert à rien)', () => {
    expect(source).toContain('resumeOutputs,')
  })

  it('elle passe enfin `conversationId` — il manquait aussi', () => {
    // Délimite l'appel par sa PARENTHÈSE fermante, pas par un budget de caractères : un budget cassait
    // dès qu'une ligne était ajoutée dans le corps de l'appel (arrivé en ajoutant `durationMs`).
    const start = source.indexOf('const r = await this.os.runTask(')
    expect(start).toBeGreaterThan(0)
    const call = source.slice(start, source.indexOf('\n          )', start))
    expect(call).toContain('convId')
    expect(call).toContain('resumeOutputs')
  })

  it('elle OUBLIE l’acquis repris (sinon il serait rejoué à chaque relance)', () => {
    expect(source).toContain('this.os.forgetResumableOrchestration(resumable.runId)')
  })

  it('la réutilisation est VISIBLE : sauter des phases payées n’est jamais silencieux', () => {
    expect(source).toContain('reprise : phases deja acquises reutilisees')
  })
})
