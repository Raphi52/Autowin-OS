import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const flux = vi.hoisted(() => ({ lignes: [] as Array<Record<string, unknown>> }))

// Même harnais que codex-tail-drain.test.ts : on rejoue une séquence JSONL arbitraire.
vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5252
    child.exitCode = null
    child.kill = () => true
    return {
      child,
      pid: child.pid,
      spawnToken: 'codex-progression',
      journalPath: 'C:\journals\codex-progression.jsonl',
      survivable: true,
      release: vi.fn(),
      tail: async (onLine: (line: string) => void) => {
        for (const ligne of flux.lignes) onLine(JSON.stringify(ligne))
        // `close` APRÈS le tour de boucle : codex.ts n'enregistre ses handlers qu'après l'appel à
        // `tail`, un émetteur synchrone parlerait dans le vide et le test attendrait le watchdog.
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: flux.lignes.length, stopped: false }
      }
    }
  }
}))

import { CodexAdapter } from './codex'

const previousBin = process.env.CODEX_BIN
afterEach(() => {
  flux.lignes = []
  if (previousBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = previousBin
})

/** Draine le générateur et sépare ce qui a été relayé EN DIRECT du texte final. */
async function drainer(): Promise<{ direct: string[]; textes: string[] }> {
  process.env.CODEX_BIN = 'codex-test'
  const stream = new CodexAdapter({ timeoutMs: 5_000 }).send(
    [{ role: 'user', content: 'travaille' }],
    { execution: { cwd: process.cwd(), sandbox: 'read-only', providerTimeoutMs: 60_000 } }
  )
  const direct: string[] = []
  const textes: string[] = []
  let step = await stream.next()
  while (!step.done) {
    if (step.value.reasoning) direct.push(step.value.reasoning)
    if (step.value.delta) textes.push(step.value.delta)
    step = await stream.next()
  }
  return { direct, textes }
}

const messageFinal = {
  type: 'item.completed',
  item: { type: 'agent_message', text: 'termine' }
}

/**
 * UN SOUS-AGENT CODEX NE DOIT PAS ÊTRE MUET JUSQU'À SA DERNIÈRE SECONDE.
 *
 * Constaté le 2026-08-22 en auditant le pendant du défaut Claude (`claude.tool-heartbeat.test.ts`) :
 * en mode `execution`, `send` faisait `await runCodexExec(...)` puis UN SEUL `yield` du texte final.
 * Le CLI Codex émet pourtant du grain fin ligne par ligne — raisonnement, commandes exécutées — et
 * l'adaptateur l'absorbait intégralement. Résultat : la carte du fil restait muette pendant TOUT
 * l'appel, pas seulement pendant un outil long.
 */
describe('CodexAdapter — la progression remonte au fil de l’eau', () => {
  it('relaie le raisonnement AVANT le texte final', async () => {
    flux.lignes = [
      { type: 'item.completed', item: { type: 'reasoning', text: 'je lis le test' } },
      { type: 'item.completed', item: { type: 'reasoning', text: 'je corrige' } },
      messageFinal
    ]
    const { direct, textes } = await drainer()

    expect(direct).toEqual(['je lis le test', 'je corrige'])
    expect(textes).toEqual(['termine'])
  })

  it('relaie chaque commande exécutée, avec son issue', async () => {
    flux.lignes = [
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'npx vitest run',
          exit_code: 1,
          status: 'failed'
        }
      },
      messageFinal
    ]
    const { direct } = await drainer()

    expect(direct).toHaveLength(1)
    expect(direct[0]).toContain('npx vitest run')
    expect(direct[0]).toContain('échec')
  })

  it('ne relaie PAS le message final en double', async () => {
    // Le texte part par `delta` a la fin ; le repasser en note l'afficherait deux fois.
    flux.lignes = [messageFinal]
    const { direct, textes } = await drainer()

    expect(direct).toEqual([])
    expect(textes).toEqual(['termine'])
  })
})
