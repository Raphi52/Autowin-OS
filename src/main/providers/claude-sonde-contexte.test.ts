import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { argumentsDeSonde, sonderContexte } from './claude-sonde-contexte'

describe('argumentsDeSonde', () => {
  it('garde les reglages du tour, retire la reprise de session et passe en entree stream-json', () => {
    const args = argumentsDeSonde([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--system-prompt-file',
      'C:/tmp/system.md',
      '--mcp-config',
      'C:/tmp/mcp.json',
      '--resume',
      'abc-123',
      '--system-prompt-snapshot',
      'off',
      '--model',
      'opus'
    ])
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--system-prompt-file',
      'C:/tmp/system.md',
      '--mcp-config',
      'C:/tmp/mcp.json',
      '--system-prompt-snapshot',
      'off',
      '--model',
      'opus',
      '--input-format',
      'stream-json',
      // Mesure du 2026-10-16 : sans lui, une reprise ecrivait dans le transcript de la session.
      '--no-session-persistence'
    ])
    expect(args).not.toContain('abc-123')
  })
})

/** Un faux CLI : il lit la requete de controle sur stdin et rend `reponse` sur stdout. */
function fauxCli(
  reponse: (requete: { request_id: string; request: { subtype: string } }) => unknown
) {
  const appels: { bin: string; args: string[] }[] = []
  let tue = false
  const spawn = ((bin: string, args: string[]) => {
    appels.push({ bin, args })
    const enfant = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      exitCode: number | null
      kill: () => boolean
    }
    enfant.stdin = new PassThrough()
    enfant.stdout = new PassThrough()
    enfant.exitCode = null
    enfant.kill = () => {
      tue = true
      enfant.exitCode = 1
      enfant.emit('close', null)
      return true
    }
    enfant.stdin.on('data', (d: Buffer) => {
      for (const ligne of d.toString('utf8').split('\n').filter(Boolean)) {
        const requete = JSON.parse(ligne) as { request_id: string; request: { subtype: string } }
        const r = reponse(requete)
        if (r !== undefined)
          enfant.stdout.write(`{"type":"system","subtype":"init"}\n${JSON.stringify(r)}\n`)
      }
    })
    return enfant
  }) as never
  return { spawn, appels, estTue: () => tue }
}

describe('sonderContexte', () => {
  it('rend le detail du CLI et coupe la sonde des la reponse', async () => {
    const cli = fauxCli((q) => ({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: q.request_id,
        response: {
          maxTokens: 1_000_000,
          categories: [{ name: 'System prompt', tokens: 8800 }],
          mcpTools: [{ name: 'mcp__autowin__get_state', serverName: 'autowin', tokens: 148 }]
        }
      }
    }))
    const issue = await sonderContexte({
      bin: 'claude.exe',
      argsDuTour: ['-p'],
      spawn: cli.spawn,
      maintenant: () => 7
    })
    expect(issue).toEqual({
      contexte: expect.objectContaining({
        max: 1_000_000,
        mesureLe: 7,
        outilsMcp: [{ nom: 'autowin · get_state', tokens: 148 }]
      })
    })
    expect(cli.estTue()).toBe(true)
    expect(cli.appels[0]?.args).toContain('--no-session-persistence')
  })

  it('attend que les serveurs MCP soient connectes avant de mesurer', async () => {
    const vus: string[] = []
    let etats = 0
    const cli = fauxCli((q) => {
      vus.push(q.request.subtype)
      if (q.request.subtype === 'mcp_status')
        return {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: q.request_id,
            // « pending » au premier passage, comme le vrai CLI pendant ~2 s.
            response: {
              mcpServers: [{ name: 'autowin', status: ++etats < 2 ? 'pending' : 'connected' }]
            }
          }
        }
      return {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: q.request_id,
          response: { maxTokens: 1000, categories: [] }
        }
      }
    })
    const issue = await sonderContexte({
      bin: 'c',
      argsDuTour: ['--mcp-config', 'C:/tmp/mcp.json'],
      spawn: cli.spawn
    })
    expect('contexte' in issue).toBe(true)
    expect(vus).toEqual(['mcp_status', 'mcp_status', 'get_context_usage'])
  })

  it('dit pourquoi il n y a pas de detail quand le CLI refuse', async () => {
    const cli = fauxCli((q) => ({
      type: 'control_response',
      response: { subtype: 'error', request_id: q.request_id, error: 'non supporte' }
    }))
    expect(await sonderContexte({ bin: 'c', argsDuTour: [], spawn: cli.spawn })).toEqual({
      echec: 'refus du CLI : non supporte'
    })
  })

  it('se borne dans le temps au lieu d attendre un CLI muet', async () => {
    const cli = fauxCli(() => undefined)
    const issue = await sonderContexte({ bin: 'c', argsDuTour: [], spawn: cli.spawn, delaiMs: 20 })
    expect(issue).toEqual({ echec: 'aucune réponse en 0 s' })
    expect(cli.estTue()).toBe(true)
  })

  it('s arrete avec le tour', async () => {
    const cli = fauxCli(() => undefined)
    const arret = new AbortController()
    const enCours = sonderContexte({
      bin: 'c',
      argsDuTour: [],
      spawn: cli.spawn,
      signal: arret.signal
    })
    arret.abort()
    expect(await enCours).toEqual({ echec: 'tour arrêté' })
  })
})
