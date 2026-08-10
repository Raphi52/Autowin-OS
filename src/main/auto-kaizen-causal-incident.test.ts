import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AutoKaizenSupervisor,
  correlationKeyForIncident,
  incidentFromPilotEvent,
  runScopeForIncident,
  type AutoKaizenConversationLink,
  type AutoKaizenRuntime
} from './auto-kaizen-supervisor'

describe('Auto-Kaizen — incident causal unique', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('ne lance qu’un incident et qu’une analyse pour step failed + end red + result false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-auto-kaizen-cause-'))
    roots.push(root)
    const conversations: AutoKaizenConversationLink[] = []
    const runtime: AutoKaizenRuntime = {
      createConversation(input) {
        conversations.push(input.link)
        return { id: `conv-${conversations.length}` }
      },
      appendSourceUpdate() {
        // Ce scénario observe uniquement la causalité, pas la projection dans la conversation source.
      },
      async runAnalysis(conversationId) {
        return { ok: true, turnId: `${conversationId}:analysis`, text: 'Cause localisée.' }
      },
      async runFix(conversationId) {
        return {
          ok: true,
          turnId: `${conversationId}:fix`,
          text: 'Correction vérifiée.',
          verification: { complete: true, evidence: 'test vert, exit 0' }
        }
      }
    }
    const supervisor = new AutoKaizenSupervisor({
      path: join(root, 'auto-kaizen-incidents.json'),
      runtime
    })
    const runPath = 'C:/runs/run-42/RUN.md'
    const sourceConversationId = 'conv-source'

    // Projection 1 : étape exec rouge.
    supervisor.report({
      dedupeKey: `orchestration-step:${runPath}:attempt-1`,
      sourceConversationId,
      kind: 'orchestration-step-failed',
      summary: 'exec a échoué',
      detail: 'codex exec échec (1)'
    })
    // Projection 2 : terminaison rouge du même run.
    supervisor.report({
      dedupeKey: `orchestration-end:${runPath}:red`,
      sourceConversationId,
      kind: 'orchestration-red',
      summary: 'Une orchestration s’est terminée en rouge',
      detail: `RUN en échec : ${runPath}`
    })
    // Projection 3 : résultat orchestrate false, actuellement ramené à la clé de fin rouge.
    const resultIncident = incidentFromPilotEvent({
      kind: 'result',
      name: 'orchestrate',
      ok: false,
      data: { runPath, error: 'codex exec échec (1)' }
    })
    expect(resultIncident).toBeDefined()
    supervisor.report({
      dedupeKey: `orchestration-end:${runPath}:red`,
      sourceConversationId,
      ...resultIncident!
    })

    await supervisor.drain()

    expect(supervisor.snapshot().incidents).toHaveLength(1)
    expect(conversations.filter(({ role }) => role === 'analysis')).toHaveLength(1)
  })

  it('garde une cause NON projection distincte, même dans le même run', () => {
    // Le garde de la corrélation par run. Sans lui, tout ce qui partage un runPath fusionnerait
    // et une seconde cause racine deviendrait INVISIBLE — aussi faux que les 2924 incidents pour
    // une cause. `test-red` n'est pas une projection de l'échec du run : il garde son incident.
    const runPath = 'C:/runs/run-77/RUN.md'
    const projection = {
      dedupeKey: `orchestration-end:${runPath}:red`,
      sourceConversationId: 'conv-source',
      kind: 'orchestration-red',
      summary: 'run rouge',
      detail: `RUN en échec : ${runPath}`
    }
    const autreCause = {
      dedupeKey: `test-red:${runPath}:suite-a`,
      sourceConversationId: 'conv-source',
      kind: 'test-red',
      summary: 'une suite est rouge',
      detail: `pendant ${runPath}`
    }
    // Le run n'est PAS dans la clé (l'y mettre fragmente) : le garde se lit sur le RUN SCOPE,
    // qui est le chemin de fusion supplémentaire utilisé par report().
    expect(runScopeForIncident(projection)).toBe(runPath.toLowerCase())
    expect(runScopeForIncident(autreCause)).toBeUndefined()
    expect(correlationKeyForIncident(projection)).toMatch(/^akc-/)
  })

  it('rattache deux projections au même run, et distingue deux runs', () => {
    const scope = (kind: string, runPath: string): string | undefined =>
      runScopeForIncident({
        dedupeKey: `orchestration-end:${runPath}:red`,
        sourceConversationId: 'conv-source',
        kind,
        summary: 'peu importe',
        detail: `RUN en échec : ${runPath}`
      })
    expect(scope('orchestration-red', 'C:/runs/a/RUN.md')).toBe(
      scope('orchestration-step-failed', 'C:/runs/a/RUN.md')
    )
    expect(scope('orchestration-red', 'C:/runs/a/RUN.md')).not.toBe(
      scope('orchestration-red', 'C:/runs/b/RUN.md')
    )
  })

  it('retombe sur la cause textuelle quand aucun run n’est identifiable', () => {
    const sansRun = {
      dedupeKey: 'orchestration-end:sans-chemin:red',
      sourceConversationId: 'conv-source',
      kind: 'orchestration-red',
      summary: 'run rouge',
      detail: 'aucun chemin ici'
    }
    expect(runScopeForIncident(sansRun)).toBeUndefined()
    expect(correlationKeyForIncident(sansRun)).toMatch(/^akc-/)
  })
})

describe('Auto-Kaizen — taxonomie causale des résultats en échec', () => {
  it('classe un échec provider sans preuve d’autorité comme exécution/provider, jamais autorité', () => {
    const incident = incidentFromPilotEvent({
      kind: 'result',
      name: 'orchestrate',
      ok: false,
      data: { provider: 'codex', exitCode: 1, error: 'process exited with code 1' }
    })

    expect(['execution-failed', 'provider-error']).toContain(incident?.kind)
    expect(incident?.kind).not.toBe('authority-refused')
  })

  it('réserve authority-refused à un refus d’autorité explicite', () => {
    const incident = incidentFromPilotEvent({
      kind: 'result',
      name: 'write-file',
      ok: false,
      data: {
        code: 'authority-refused',
        error: 'Action refused by authority policy'
      }
    })

    expect(incident?.kind).toBe('authority-refused')
  })
})
