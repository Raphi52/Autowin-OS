/**
 * conv-528 (2026-09-14) : un agent lancé par une orchestration doit CONNAÎTRE son fil sans le recopier,
 * pour que `scripts/hdesk-lancer.ps1` relie son bureau caché à la petite TV de CE fil.
 * Canal : la variable AUTOWIN_CONVERSATION_ID posée dans l'environnement du processus de l'agent.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CostAggregator } from './dashboards/cost'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'
import { environnementAgent } from './providers/claude'
import { environnementCodex } from './providers/codex'

class Espion implements ProviderAdapter {
  readonly id = 'espion'
  readonly supportsExecution = true
  readonly vus: SendOptions[] = []
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(_m: Message[], o: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    this.vus.push(o)
    return { text: 'VALIDE', provider: this.id, model: 'm', systemInjected: true }
  }
}

function harnais(): { espion: Espion; orch: Orchestrator } {
  const espion = new Espion()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(espion),
    roles: new RoleModelConfig({
      subagent: { provider: 'espion', model: 'm' },
      judge: { provider: 'espion', model: 'm' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    execPhases: ['build']
  })
  return { espion, orch }
}

const lancer = (env: NodeJS.ProcessEnv, extra: string[] = []): string => {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-File',
        join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
        '-Id',
        'filtest',
        '-Executable',
        'C:/n-existe/pas.exe',
        '-Travail',
        'preuve',
        ...extra
      ],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return 'exit 0'
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e)
  }
}

describe('le fil voyage jusqu’à l’agent orchestré', () => {
  it('chaque appel exécutant d’un run porte AUTOWIN_CONVERSATION_ID = son fil', async () => {
    const { espion, orch } = harnais()
    await orch.run(
      'corrige le filtre',
      undefined,
      undefined,
      undefined,
      undefined,
      '',
      [],
      'conv-77'
    )
    const executants = espion.vus.filter((o) => o.execution)
    expect(executants.length).toBeGreaterThan(0)
    for (const o of executants)
      expect(o.execution?.agentEnv?.AUTOWIN_CONVERSATION_ID).toBe('conv-77')
  })

  it('fil inconnu : aucune variable inventée', async () => {
    const { espion, orch } = harnais()
    await orch.run('corrige le filtre')
    for (const o of espion.vus.filter((x) => x.execution))
      expect(o.execution?.agentEnv?.AUTOWIN_CONVERSATION_ID).toBeUndefined()
  })

  it('le processus claude reçoit la variable, sans qu’elle écrase les garde-fous non interactifs', () => {
    const env = environnementAgent(
      { PATH: 'x' },
      { AUTOWIN_CONVERSATION_ID: 'conv-77', PAGER: 'less' }
    )
    expect(env.AUTOWIN_CONVERSATION_ID).toBe('conv-77')
    expect(env.PATH).toBe('x')
    expect(env.PAGER).toBe('cat')
  })
})

describe('le fil voyage aussi jusqu’à l’agent Codex', () => {
  it('l’environnement Codex porte AUTOWIN_CONVERSATION_ID du run', () => {
    const env = environnementCodex({ PATH: 'x' }, { AUTOWIN_CONVERSATION_ID: 'conv-77' })
    expect(env.AUTOWIN_CONVERSATION_ID).toBe('conv-77')
    expect(env.PATH).toBe('x')
  })

  it('sans fil : environnement hérité intact, aucune variable inventée', () => {
    const env = environnementCodex({ PATH: 'x' }, undefined)
    expect(env).toEqual({ PATH: 'x' })
  })

  it('codex.ts remet cet environnement au lancement survivable', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'main', 'providers', 'codex.ts'), 'utf8')
    const appel = src.slice(
      src.indexOf('spawnSurvivable({'),
      src.indexOf('spawnSurvivable({') + 400
    )
    expect(appel).toMatch(/env: environnementCodex\(process\.env, execution\.agentEnv\)/)
  })
})

describe.skipIf(process.platform !== 'win32')('hdesk-lancer lit le fil tout seul', () => {
  const sansFil = { ...process.env }
  delete sansFil.AUTOWIN_CONVERSATION_ID

  it('sans -Conversation ni variable : refus nommé', () => {
    expect(lancer(sansFil)).toMatch(/AUTOWIN_CONVERSATION_ID/)
  })

  it('avec la variable seule : le fil est accepté (il échoue plus loin, sur l’exécutable absent)', () => {
    const r = lancer({ ...sansFil, AUTOWIN_CONVERSATION_ID: 'conv-77' })
    expect(r).toMatch(/Executable introuvable/)
    expect(r).not.toMatch(/AUTOWIN_CONVERSATION_ID/)
  })

  it('variable au format invalide : refusée', () => {
    expect(lancer({ ...sansFil, AUTOWIN_CONVERSATION_ID: 'conv 77; rm' })).toMatch(/invalide/)
  })
})
