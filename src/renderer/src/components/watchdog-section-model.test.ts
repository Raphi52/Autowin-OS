import { describe, expect, it } from 'vitest'
import {
  describeOutcome,
  describeOccurrenceStatus,
  describeWatchdogGuards,
  describeWatchdogSource,
  outcomeTone,
  splitByTrigger,
  watchdogHistory,
  watchdogSummary,
  toTaskPayload,
  triggerKindOf,
  watchdogDraftProblem,
  type WatchdogOccurrenceLike,
  type WatchdogTaskLike
} from './watchdog-section-model'

const guards = { dedupWindowMs: 60_000, maxTriggersPerHour: 12, maxChainDepth: 0, maxPerRoot: 20 }

const hourly: WatchdogTaskLike = { id: 'h1', title: 'Rapport quotidien', enabled: true }
const watcher: WatchdogTaskLike = {
  id: 'w1',
  title: 'Surveiller le log',
  enabled: true,
  watchdog: { source: { kind: 'file-match', path: 'C:/logs/app.log', pattern: 'ERROR' }, guards }
}

describe('splitByTrigger — ne pas mélanger horaire et événementiel', () => {
  it('sépare les deux familles', () => {
    const split = splitByTrigger([hourly, watcher])

    expect(split.scheduled.map((task) => task.id)).toEqual(['h1'])
    expect(split.watchdog.map((task) => task.id)).toEqual(['w1'])
  })
})

describe('description d’une règle', () => {
  it('décrit une surveillance de fichier en clair', () => {
    expect(describeWatchdogSource(watcher.watchdog!.source)).toBe(
      'Quand une ligne de C:/logs/app.log correspond à « ERROR »'
    )
  })

  it('signale la casse quand elle est respectée', () => {
    expect(
      describeWatchdogSource({
        kind: 'file-match',
        path: 'a.log',
        pattern: 'X',
        caseSensitive: true
      })
    ).toContain('casse respectée')
  })

  it('décrit un événement interne en clair, pas par son identifiant', () => {
    expect(describeWatchdogSource({ kind: 'app-event', events: ['task-failed'] })).toBe(
      'Quand une tâche planifiée échoue'
    )
  })

  it('rend les BORNES visibles — c’est la contrepartie du pouvoir accordé', () => {
    const text = describeWatchdogGuards(guards)

    expect(text).toContain('12 réveils/h max')
    expect(text).toContain('60 s')
    expect(text).toContain('un réveil ne peut pas en déclencher un autre')
    expect(text).toContain('20 réveils max par même cause')
  })

  it('dit clairement quand une chaîne est autorisée', () => {
    expect(describeWatchdogGuards({ ...guards, maxChainDepth: 2, maxPerRoot: 20 })).toContain(
      'chaîne autorisée jusqu’à 2'
    )
  })

  it('rend les plafonds quotidiens de volume et de cout visibles', () => {
    const text = describeWatchdogGuards({
      ...guards,
      maxTriggersPerDay: 4,
      maxKnownCostUsdPerDay: 0.25,
      maxUnpricedCallsPerDay: 1
    })

    expect(text).toContain('4 réveils/24 h max')
    expect(text).toContain('coupe-circuit à 0.25 $ connus/24 h')
    expect(text).toContain('1 appel(s) non chiffré(s)/24 h max')
  })
})

describe('issue du tri', () => {
  it('distingue « non renseignée » de « bénin »', () => {
    // Confondre les deux ferait passer un agent qui n’a pas conclu pour un agent rassurant.
    expect(describeOutcome(undefined)).toBe('Issue non renseignée')
    expect(describeOutcome('benign')).toBe('Bénin')
    expect(outcomeTone(undefined)).toBe('unknown')
    expect(outcomeTone('benign')).toBe('neutral')
    expect(outcomeTone('repair')).toBe('act')
  })

  it('nomme le statut humainement sans le confondre avec l issue', () => {
    expect(describeOccurrenceStatus('failed')).toBe('Échec')
    expect(describeOccurrenceStatus('cancelled')).toBe('Annulé')
    expect(describeOccurrenceStatus('completed')).toBe('Terminé')
    expect(describeOccurrenceStatus('running')).toBe('En cours')
  })
})

describe('historique et résumé', () => {
  const occurrences: WatchdogOccurrenceLike[] = [
    {
      id: 'o1',
      taskId: 'w1',
      scheduledFor: 100,
      status: 'completed',
      trigger: 'watchdog',
      outcome: 'benign'
    },
    { id: 'o2', taskId: 'w1', scheduledFor: 300, status: 'completed', trigger: 'watchdog' },
    { id: 'o3', taskId: 'w1', scheduledFor: 200, status: 'failed', trigger: 'watchdog' },
    { id: 'o5', taskId: 'w1', scheduledFor: 500, status: 'cancelled', trigger: 'watchdog' },
    { id: 'o6', taskId: 'w1', scheduledFor: 600, status: 'running', trigger: 'watchdog' },
    { id: 'o4', taskId: 'h1', scheduledFor: 400, status: 'completed', trigger: 'schedule' }
  ]

  it('ne retient que les réveils de la règle, du plus récent au plus ancien', () => {
    expect(watchdogHistory(occurrences, 'w1').map((entry) => entry.id)).toEqual([
      'o6',
      'o5',
      'o2',
      'o3',
      'o1'
    ])
  })

  it('compte toute occurrence sans conclusion et expose les échecs et annulations', () => {
    const summary = watchdogSummary([hourly, watcher], occurrences)

    expect(summary).toEqual({
      rules: 1,
      active: 1,
      triggers: 5,
      pendingTriage: 4,
      failures: 1,
      cancellations: 1
    })
  })
})

describe('brouillon d’une règle de réveil', () => {
  const rule = {
    source: { kind: 'file-match' as const, path: 'C:/logs/app.log', pattern: 'ERROR' },
    guards
  }

  it('n’envoie JAMAIS les deux déclencheurs à la fois', () => {
    // Le store refuse l'ambiguïté : une tâche a un horaire OU un réveil, pas les deux.
    const asWatchdog = toTaskPayload({ title: 'x', schedule: { time: '09:00' }, watchdog: rule })
    expect(asWatchdog).toHaveProperty('watchdog')
    expect(asWatchdog).not.toHaveProperty('schedule')

    const asHourly = toTaskPayload({ title: 'x', schedule: { time: '09:00' } })
    expect(asHourly).toHaveProperty('schedule')
    expect(asHourly).not.toHaveProperty('watchdog')
  })

  it('reconnaît le mode du brouillon', () => {
    expect(triggerKindOf({ watchdog: rule })).toBe('watchdog')
    expect(triggerKindOf({})).toBe('schedule')
  })

  it('refuse une règle qui ne déclencherait JAMAIS, à la saisie', () => {
    // Une surveillance muette est le pire mode de panne : rien ne se passe et rien ne le dit.
    expect(watchdogDraftProblem({ ...rule, source: { ...rule.source, path: '  ' } })).toContain(
      'fichier à surveiller'
    )
    expect(watchdogDraftProblem({ ...rule, source: { ...rule.source, pattern: '' } })).toContain(
      'déclencher'
    )
    expect(
      watchdogDraftProblem({ ...rule, guards: { ...guards, maxTriggersPerHour: 0 } })
    ).toContain('plafond')
    expect(watchdogDraftProblem({ ...rule, guards: { ...guards, maxPerRoot: 0 } })).toContain(
      'largeur'
    )
  })

  it('refuse une expression pouvant bloquer le processus principal', () => {
    expect(
      watchdogDraftProblem({
        ...rule,
        source: { ...rule.source, pattern: '^(a+)+$' }
      })
    ).toMatch(/expression/i)
  })

  it('laisse passer une règle valide, et ignore l’absence de règle', () => {
    expect(watchdogDraftProblem(rule)).toBeUndefined()
    expect(
      watchdogDraftProblem({ source: { kind: 'app-event', events: ['task-failed'] }, guards })
    ).toBeUndefined()
    expect(watchdogDraftProblem(undefined)).toBeUndefined()
  })
})
