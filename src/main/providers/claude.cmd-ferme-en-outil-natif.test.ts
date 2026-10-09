import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UNE COMMANDE `<cmd>` COMPLETE FERMEE PAR LA SYNTAXE DES OUTILS NATIFS N'EST PAS PERDUE.
 *
 * Mesure conv-120, appel du tour `3e00e0a5-5602-46e9-adb3-0d9c7a162b21` (2026-10-09) : deux fois
 * (`msg_011CfrgvjC6…` puis la retentative `msg_011CfrgxTZo…`), le modele ecrit
 * `<cmd>{"name":"orchestrate","args":{…}}` puis le referme par `</parameter>\n</invoke>` au lieu de
 * `</cmd>`. L'API y voit un appel d'outil natif casse ; le CLI finit sur
 * `terminal_reason: "malformed_tool_use_exhausted"` et l'adaptateur jetait le tour ENTIER (0,37 USD),
 * alors que la commande etait complete et que `normaliserFermeturesCmd` sait deja la refermer.
 * Recidive le meme jour : flux `1848f898-fdcd-45e9-a7ec-7a9c545dca20`.
 */
const spawnCapture = vi.hoisted(() => ({ stdoutEvents: [] as Array<Record<string, unknown>> }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => {
      for (const event of spawnCapture.stdoutEvents.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 }
const CMD =
  '<cmd>{"name":"orchestrate","args":{"phase":"build","task":"Chantier « x » : {a} et \\"b\\""}}'

const tentative = (id: string, texte: string): Record<string, unknown> => ({
  type: 'assistant',
  message: { id, model: 'claude-opus-5-5', content: [{ type: 'text', text: texte }], usage }
})
const synthetique = {
  type: 'assistant',
  message: {
    id: 'synth',
    model: '<synthetic>',
    content: [
      { type: 'text', text: "The model's tool call could not be parsed (retry also failed)." }
    ],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
  }
}
const resultat = {
  type: 'result',
  subtype: 'success',
  is_error: true,
  terminal_reason: 'malformed_tool_use_exhausted',
  result: "The model's tool call could not be parsed (retry also failed).",
  session_id: 's',
  total_cost_usd: 0.37,
  usage
}

const lancer = async (): Promise<{ text: string }> => {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value as { text: string }
}

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
})

describe('claude — <cmd> referme par </parameter></invoke>', () => {
  it('rend la DERNIERE tentative, refermee, au lieu de jeter le tour (conv-120)', async () => {
    spawnCapture.stdoutEvents = [
      tentative('m0', 'Je lis avant de lancer.'),
      tentative('m1', `${CMD}</parameter>\n</invoke>`),
      tentative('m2', `${CMD.replace('build', 'scout')}</parameter>\n</invoke>`),
      synthetique,
      resultat
    ]
    const res = await lancer()
    expect(res.text).toContain('Je lis avant de lancer.')
    expect(res.text.match(/<cmd>/g)).toHaveLength(1)
    expect(res.text).toContain('"phase":"scout"')
    expect(res.text).toMatch(/\}\}<\/cmd>$/)
    expect(res.text).not.toMatch(/could not be parsed|<\/invoke>|<\/parameter>/)
  })

  it('garde l echec quand la commande est INCOMPLETE', async () => {
    spawnCapture.stdoutEvents = [
      tentative('m1', `${CMD.slice(0, -2)}</parameter>\n</invoke>`),
      synthetique,
      resultat
    ]
    await expect(lancer()).rejects.toThrow(/could not be parsed/)
  })

  it('garde l echec quand du texte suit la fermeture parasite', async () => {
    spawnCapture.stdoutEvents = [
      tentative('m1', `${CMD}</parameter>\n</invoke>\n<invoke name="Bash">`),
      synthetique,
      resultat
    ]
    await expect(lancer()).rejects.toThrow(/could not be parsed/)
  })
})
