import { describe, expect, it } from 'vitest'
import type { HarnessTimelineEvent } from './harness-timeline-model'
import {
  blockedReason,
  buildAgentGantt,
  buildGanttTicks,
  rejeuDeLaBarre,
  shortModelName,
  spanGeometry
} from './observatory-agent-gantt'

const T0 = Date.parse('2026-10-10T21:18:40.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

let sequence = 0
function ev(
  partial: Partial<HarnessTimelineEvent> & Pick<HarnessTimelineEvent, 'kind'>
): HarnessTimelineEvent {
  sequence += 1
  return {
    id: `e${sequence}`,
    sequence,
    actor: 'subagent',
    label: '',
    content: '',
    detail: '',
    payloads: [],
    ...partial
  }
}

/** Exécution d'un agent, telle que la trace l'écrit : départ, fin, et la réponse en double. */
function execution(
  agentId: string,
  startS: number,
  durationS: number,
  extra: Partial<HarnessTimelineEvent> = {},
  endKind: 'handoff' | 'verdict' = 'handoff'
): HarnessTimelineEvent[] {
  const phase = agentId.split(':')[0]
  const execution = { phase, agentId }
  const metrics = {
    durationMs: durationS * 1000,
    inputTokens: 1000,
    outputTokens: 12_400,
    costUsd: 0.18,
    model: 'claude-opus-5-5'
  }
  return [
    ev({
      kind: endKind,
      status: 'running',
      timestamp: at(startS),
      execution,
      content: 'exec démarré'
    }),
    ev({
      kind: endKind,
      status: 'completed',
      timestamp: at(startS + durationS),
      execution,
      content: 'Rendu de l’agent\nsuite',
      ...metrics,
      ...extra
    }),
    ev({
      kind: 'model-response',
      status: 'completed',
      timestamp: at(startS + durationS),
      execution,
      content: 'Rendu de l’agent\nsuite',
      ...metrics,
      ...extra
    })
  ]
}

describe('déroulé par agent de la Chronologie', () => {
  it('dessine UNE barre par exécution, malgré la réponse doublée par la trace', () => {
    const gantt = buildAgentGantt(execution('scout:dette', 0, 60))!
    expect(gantt.lanes).toHaveLength(1)
    const [span] = gantt.lanes[0].spans
    expect(gantt.lanes[0].spans).toHaveLength(1)
    expect(span.start).toBe(T0)
    expect(span.end).toBe(T0 + 60_000)
    expect(span.status).toBe('ok')
    expect(span.outputTokens).toBe(12_400)
    expect(span.costUsd).toBe(0.18)
    expect(span.summary).toBe('Rendu de l’agent')
  })

  it('range une ligne par agent, l’orchestrateur en tête, puis par ordre de départ', () => {
    const events = [
      ...execution('judge:single', 120, 20, {}, 'verdict'),
      ...execution('scout:rupture', 5, 40),
      ...execution('scout:dette', 2, 50),
      ev({
        kind: 'model-response',
        actor: 'claude',
        timestamp: at(200),
        durationMs: 30_000,
        model: 'claude-opus-5-5',
        content: 'Je lance le run.'
      })
    ]
    const gantt = buildAgentGantt(events)!
    expect(gantt.lanes.map((lane) => lane.key)).toEqual([
      'orchestrator',
      'scout:dette',
      'scout:rupture',
      'judge:single'
    ])
    expect(gantt.lanes[0].label).toBe('Orchestrateur')
    expect(gantt.lanes[1]).toMatchObject({ label: 'scout', variant: 'dette', phase: 'scout' })
    // « single » et « subagent » ne disent rien de plus que la phase.
    expect(gantt.lanes[3].variant).toBeUndefined()
    expect(gantt.lanes[3].model).toBe('Opus 5.5')
    expect(gantt.start).toBe(T0 + 2_000)
    expect(gantt.end).toBe(T0 + 200_000)
  })

  it('marque REFUSÉ le verdict que le contrôle suivant a bloqué, avec son motif', () => {
    const events = execution('judge:single', 0, 21, {}, 'verdict')
    const verdict = events[1]
    events.push(
      ev({
        kind: 'gate',
        status: 'completed',
        parentId: verdict.id,
        timestamp: at(21.1),
        content: 'BLOQUÉ: Aucune capture d’écran lue : preuve visuelle manquante.'
      })
    )
    const [span] = buildAgentGantt(events)!.lanes[0].spans
    expect(span.status).toBe('refused')
    expect(span.eventId).toBe(verdict.id)
    expect(span.summary).toBe('Aucune capture d’écran lue : preuve visuelle manquante.')
  })

  it('laisse VALIDÉ un verdict dont le contrôle autorise la clôture', () => {
    const events = execution('judge:single', 0, 21, {}, 'verdict')
    events.push(
      ev({ kind: 'gate', parentId: events[1].id, timestamp: at(22), content: 'clôture autorisée' })
    )
    expect(buildAgentGantt(events)!.lanes[0].spans[0].status).toBe('ok')
  })

  it('marque ÉCHEC une exécution terminée en erreur, avec le texte de l’erreur', () => {
    const execution = { phase: 'clean', agentId: 'clean:subagent' }
    const events = [
      ev({ kind: 'handoff', status: 'running', timestamp: at(0), execution }),
      ev({
        kind: 'handoff',
        status: 'failed',
        timestamp: at(4),
        durationMs: 4_000,
        execution,
        content: 'Phase clean — Claude a interrompu la session.'
      }),
      ev({
        kind: 'error',
        status: 'failed',
        timestamp: at(4),
        durationMs: 4_000,
        execution,
        content: 'Phase clean — Claude a interrompu la session.'
      })
    ]
    const spans = buildAgentGantt(events)!.lanes[0].spans
    expect(spans).toHaveLength(1)
    expect(spans[0].status).toBe('failed')
    expect(spans[0].summary).toContain('Claude a interrompu')
  })

  it('montre un agent démarré sans fin tracée, sans lui inventer de succès', () => {
    const execution = { phase: 'build', agentId: 'build:subagent' }
    const events = [
      ev({ kind: 'handoff', status: 'running', timestamp: at(0), execution }),
      ev({ kind: 'tool-call', status: 'completed', timestamp: at(30), execution }),
      ev({ kind: 'gate', status: 'completed', timestamp: at(90), content: 'en attente' })
    ]
    const [span] = buildAgentGantt(events)!.lanes[0].spans
    expect(span.status).toBe('open')
    expect(span.start).toBe(T0)
    // Jusqu'au dernier événement observé du tour, pas au-delà.
    expect(span.end).toBe(T0 + 90_000)
    expect(span.actions).toBe(1)
  })

  it('n’ouvre pas de barre fantôme quand chaque départ a sa fin', () => {
    const events = [...execution('scout:usage', 0, 30), ...execution('scout:usage', 100, 30)]
    const spans = buildAgentGantt(events)!.lanes[0].spans
    expect(spans.map((span) => span.status)).toEqual(['ok', 'ok'])
  })

  it('compte les actions réelles de l’agent pendant sa barre seulement', () => {
    const events = execution('build:subagent', 0, 60)
    const executionInfo = { phase: 'build', agentId: 'build:subagent' }
    events.push(
      ev({ kind: 'tool-call', timestamp: at(10), execution: executionInfo }),
      ev({ kind: 'tool-call', timestamp: at(50), execution: executionInfo }),
      ev({ kind: 'tool-call', timestamp: at(500), execution: executionInfo }),
      ev({ kind: 'tool-call', timestamp: at(20), execution: { agentId: 'clean:subagent' } })
    )
    const lane = buildAgentGantt(events)!.lanes.find((item) => item.key === 'build:subagent')!
    expect(lane.spans[0].actions).toBe(2)
  })

  it('compte les actions que la trace écrit quelques ms APRÈS la fin de l’agent', () => {
    const events = execution('scout:dette', 0, 60)
    events.push(
      ev({
        kind: 'tool-call',
        timestamp: new Date(T0 + 60_000 + 12).toISOString(),
        execution: { phase: 'scout', agentId: 'scout:dette' }
      })
    )
    expect(buildAgentGantt(events)!.lanes[0].spans[0].actions).toBe(1)
  })

  it('donne à l’orchestrateur le tour ENTIER quand il attend son run sans répondre', () => {
    // Bilans du superviseur : durée écoulée depuis le début du tour, donc recouvrants.
    const supervisor = (endS: number, durationS: number, status: string): HarnessTimelineEvent =>
      ev({
        kind: 'boundary',
        actor: 'Execution supervisor',
        status,
        timestamp: at(endS),
        durationMs: durationS * 1000,
        model: 'claude-opus-5-5'
      })
    const events = [
      supervisor(30, 30, 'completed'),
      ...execution('scout:dette', 40, 60),
      supervisor(200, 200, 'failed')
    ]
    const gantt = buildAgentGantt(events, { minLanes: 2 })!
    const orchestrator = gantt.lanes[0]
    expect(orchestrator.key).toBe('orchestrator')
    expect(orchestrator.spans).toHaveLength(0)
    expect(orchestrator.envelope).toMatchObject({ start: T0, end: T0 + 200_000, status: 'failed' })
    expect(orchestrator.model).toBe('Opus 5.5')
    expect(gantt.start).toBe(T0)
    expect(gantt.end).toBe(T0 + 200_000)
  })

  it('ne rend rien sous le nombre de lignes demandé', () => {
    const solo = [
      ev({ kind: 'model-response', timestamp: at(30), durationMs: 30_000, content: 'ok' })
    ]
    expect(buildAgentGantt(solo)).not.toBeNull()
    expect(buildAgentGantt(solo, { minLanes: 2 })).toBeNull()
    expect(buildAgentGantt([])).toBeNull()
  })

  it('ignore les événements sans horodatage plutôt que de les placer au hasard', () => {
    const events = execution('scout:dette', 0, 60)
    events[1] = { ...events[1], timestamp: undefined }
    events[2] = { ...events[2], timestamp: 'illisible' }
    const gantt = buildAgentGantt(events)!
    expect(gantt.lanes[0].spans[0].status).toBe('open')
  })
})

describe('motif d’un refus, tel que la bulle le montre', () => {
  it('rend la PREMIÈRE objection du juge, même quand elle cite entre « »', () => {
    // Forme réelle relevée dans causal-trace/conv-222 (stopgate.ts).
    const gate = {
      content:
        'BLOQUÉ: Promis mais pas fait : « Objection du juge : la piste n°1 dit que web.mjs « marche dans 61 scripts ». C’est faux tel que c’est écrit. », « Objection du juge : grep -l "web.mjs" ne trouve rien. »'
    }
    expect(blockedReason(gate)).toBe(
      'la piste n°1 dit que web.mjs « marche dans 61 scripts ». C’est faux tel que c’est écrit. (+ 1 autre objection)'
    )
  })

  it('rend une objection seule sans compteur', () => {
    expect(
      blockedReason({
        content: 'BLOQUÉ: Promis mais pas fait : « Objection du juge : preuve visuelle manquante. »'
      })
    ).toBe('preuve visuelle manquante.')
  })

  it('garde tel quel un motif sans objection, sans son préfixe', () => {
    expect(
      blockedReason({
        content: 'BLOQUÉ: Promis mais pas fait : 1 point(s) annoncé(s) au départ ne sont pas faits.'
      })
    ).toBe('Promis mais pas fait : 1 point(s) annoncé(s) au départ ne sont pas faits.')
  })

  it('ne voit aucun refus dans un contrôle qui laisse passer', () => {
    expect(blockedReason({ content: 'clôture autorisée' })).toBeNull()
    expect(blockedReason(undefined)).toBeNull()
  })
})

describe('axe et géométrie du déroulé', () => {
  it('gradue en minutes rondes comme sur la maquette', () => {
    const ticks = buildGanttTicks(T0, T0 + 3 * 60_000)
    expect(ticks.map((tick) => tick.label)).toEqual(['0 min', '1 min', '2 min', '3 min'])
    expect(ticks.at(-1)!.percent).toBeCloseTo(100)
  })

  it('gradue en secondes pour un tour court, en heures pour un long', () => {
    expect(buildGanttTicks(T0, T0 + 40_000).map((tick) => tick.label)).toEqual([
      '0 s',
      '10 s',
      '20 s',
      '30 s',
      '40 s'
    ])
    expect(buildGanttTicks(T0, T0 + 3 * 3_600_000).map((tick) => tick.label)).toEqual([
      '0 h',
      '1 h',
      '2 h',
      '3 h'
    ])
    // Pas d'une demi-heure : « 90 min » s'écrit « 1 h 30 ».
    expect(buildGanttTicks(T0, T0 + 140 * 60_000).map((tick) => tick.label)).toEqual([
      '0 min',
      '30 min',
      '1 h',
      '1 h 30',
      '2 h'
    ])
  })

  it('ne dépasse jamais les bords de l’axe', () => {
    const gantt = { start: T0, end: T0 + 100_000 }
    expect(spanGeometry(gantt, { start: T0 + 25_000, end: T0 + 50_000 })).toEqual({
      left: 25,
      width: 25
    })
    const clipped = spanGeometry(gantt, { start: T0 + 90_000, end: T0 + 150_000 })
    expect(clipped.left + clipped.width).toBeLessThanOrEqual(100)
  })

  it('abrège les noms de modèle Claude, laisse les autres intacts', () => {
    expect(shortModelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(shortModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(shortModelName('gpt-5.1-codex')).toBe('gpt-5.1-codex')
    expect(shortModelName(undefined)).toBeUndefined()
  })
})

/**
 * « REJOUER CE RUN » (conv-981) : le diagramme se rejoue en 10 s au plus depuis le bilan du run.
 * Chaque barre s'allume a son heure, a l'echelle du run : son depart sur l'axe donne son delai,
 * sa largeur sa duree. Aucun second modele : le minutage se deduit de `spanGeometry`.
 * fix-ok: conv-981 - ces tests sont ajoutes UNE seule fois dans run-52d36e67e4de-1 ; le controle
 * des causes en comptait 3 (meme modification sous son chemin complet et son chemin court, plus le
 * releve de fin d'etape).
 */
describe('rejeuDeLaBarre', () => {
  it('place la barre a l echelle du run, ramene a 10 s', () => {
    expect(rejeuDeLaBarre({ left: 0, width: 100 })).toEqual({ delaiMs: 0, dureeMs: 10_000 })
    expect(rejeuDeLaBarre({ left: 50, width: 10 })).toEqual({ delaiMs: 5_000, dureeMs: 1_000 })
  })

  it('donne une duree visible a une barre tres courte, sans depasser la fin du rejeu', () => {
    expect(rejeuDeLaBarre({ left: 20, width: 0.1 })).toEqual({ delaiMs: 2_000, dureeMs: 160 })
    const derniere = rejeuDeLaBarre({ left: 99.9, width: 0.05 })
    expect(derniere.delaiMs + derniere.dureeMs).toBeLessThanOrEqual(10_000)
  })

  it('50 etapes tiennent en 10 s', () => {
    const fins = Array.from({ length: 50 }, (_, i) =>
      rejeuDeLaBarre({ left: i * 2, width: 2 })
    ).map((r) => r.delaiMs + r.dureeMs)
    expect(Math.max(...fins)).toBeLessThanOrEqual(10_000)
  })
})

/**
 * LE MÊME GRAPHE SUR LES TOURS DE CHAT (conv-1105, suite de conv-981) : « observatory doit ressembler
 * au graph timeline des bilans de runs ». Un tour de chat n'a qu'un agent, l'orchestrateur : sans ses
 * outils, il n'aurait qu'une ligne et l'Observatory n'y montrait que la liste. Avec `outils`, chaque
 * outil qu'il appelle a sa ligne et chaque appel sa barre. Forme relevée dans `causal-trace/conv-1101`
 * (`chat-turn-trace.ts`) : un `tool-call` horodaté à son DÉBUT, avec sa durée, et l'outil en
 * destinataire.
 */
describe('couloirs d’outils d’un tour de chat', () => {
  function appel(
    outil: string,
    debutS: number,
    dureeS: number,
    entree: Record<string, unknown>,
    extra: Partial<HarnessTimelineEvent> = {}
  ): HarnessTimelineEvent {
    const content = JSON.stringify(entree)
    return ev({
      kind: 'tool-call',
      actor: 'Orchestrateur',
      recipient: outil,
      status: 'completed',
      timestamp: at(debutS),
      durationMs: dureeS * 1000,
      content,
      payloads: [{ kind: 'tool-call', name: outil, content }],
      ...extra
    })
  }
  const tourDeChat = (): HarnessTimelineEvent[] => [
    ev({ kind: 'message', actor: 'Utilisateur', timestamp: at(0), content: 'corrige le bouton' }),
    appel('Grep', 4, 1, { pattern: 'Envoyer', path: 'src' }),
    appel('Bash', 6, 6, { command: 'npx vitest run x.test.ts', description: 'Rejoue le test' }),
    appel('Bash', 20, 0, { command: 'npm run typecheck' }, { status: 'failed' }),
    ev({
      kind: 'model-response',
      actor: 'claude',
      status: 'completed',
      timestamp: at(30),
      durationMs: 30_000,
      outputTokens: 900,
      costUsd: 0.12,
      model: 'claude-opus-5-5',
      content: 'Corrigé.'
    })
  ]

  it('sans l’option, un tour de chat reste une seule ligne : le bilan du run ne change pas', () => {
    expect(buildAgentGantt(tourDeChat(), { minLanes: 2 })).toBeNull()
  })

  it('avec les outils : une ligne par outil sous l’orchestrateur, une barre par appel', () => {
    const gantt = buildAgentGantt(tourDeChat(), { minLanes: 2, outils: true })!
    expect(gantt.lanes.map((lane) => lane.label)).toEqual(['Orchestrateur', 'Grep', 'Bash'])
    const bash = gantt.lanes.find((lane) => lane.label === 'Bash')!
    expect(bash.phase).toBe('outil')
    expect(bash.detail).toBe('outil · 2 appels')
    expect(gantt.lanes[0].detail).toBeUndefined()
    // Horodaté au DÉBUT : la barre va de l'horodatage à horodatage + durée.
    expect(bash.spans.map((span) => [span.start - T0, span.end - T0, span.status])).toEqual([
      [6_000, 12_000, 'ok'],
      [20_000, 20_000, 'failed']
    ])
    expect(bash.spans[0].summary).toBe('Rejoue le test')
    expect(bash.spans[1].summary).toBe('npm run typecheck')
    expect(gantt.lanes.find((lane) => lane.label === 'Grep')!.spans[0].summary).toBe('Envoyer')
    expect(gantt.start - T0).toBe(0)
    expect(gantt.end - T0).toBe(30_000)
  })

  it('laisse les outils d’un agent de run dans SA barre (ses actions), sans ligne d’outil', () => {
    const events = [
      ...execution('build:minimal', 10, 60),
      appel(
        'Edit',
        30,
        0,
        { file_path: 'src/a.ts' },
        {
          execution: { phase: 'build', agentId: 'build:minimal' }
        }
      )
    ]
    const gantt = buildAgentGantt(events, { outils: true })!
    expect(gantt.lanes.map((lane) => lane.key)).toEqual(['build:minimal'])
    expect(gantt.lanes[0].spans[0].actions).toBe(1)
  })

  it('range les outils APRÈS les agents, chacun par ordre de premier appel', () => {
    const events = [...tourDeChat(), ...execution('judge:single', 1, 5)]
    const gantt = buildAgentGantt(events, { outils: true })!
    expect(gantt.lanes.map((lane) => lane.label)).toEqual([
      'Orchestrateur',
      'judge',
      'Grep',
      'Bash'
    ])
  })
})
