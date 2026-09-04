import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * L'OCCUPATION DE LA FENETRE N'EST PAS LA DEPENSE DU TOUR.
 *
 * Un tour d'agent enchaine N appels au modele et chacun renvoie tout le prefixe. L'evenement
 * `result` du CLI porte l'usage AGREGE de ces N appels : parfait pour facturer, faux pour la jauge
 * de contexte. Mesure du 2026-09-04 sur conv-282 : un tour de ~14 appels a rendu 2 181 502 tokens
 * d'entree pour une fenetre de 1 M, donc une barre collee a 100 % alors que l'occupation reelle
 * tenait sous 25 %. Ce test fige la separation : `inputTokens` reste le cumul, `derniereEntree`
 * porte l'entree du DERNIER message assistant.
 */
const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
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

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

/** Un message assistant du flux, avec l'usage de SON seul appel. */
function assistant(texte: string, usage?: Record<string, number>): Record<string, unknown> {
  return {
    type: 'assistant',
    message: {
      model: 'claude-opus-5',
      content: [{ type: 'text', text: texte }],
      ...(usage ? { usage } : {})
    }
  }
}

async function drainUsage(): Promise<
  | {
      inputTokens: number
      derniereEntree?: number
      derniereEntreeCache?: number
    }
  | undefined
> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value.usage
}

describe('ClaudeCliAdapter — occupation de la fenetre vs depense du tour', () => {
  it("rend l'entree du DERNIER appel, pas le cumul de l'evenement result", async () => {
    spawnCapture.stdoutEvents = [
      // Trois appels successifs : le prefixe grossit un peu a chaque fois, il ne triple pas.
      assistant('je lis', { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 90_000 }),
      assistant('je cherche', {
        input_tokens: 30,
        output_tokens: 5,
        cache_read_input_tokens: 95_000
      }),
      assistant('voici', { input_tokens: 40, output_tokens: 9, cache_read_input_tokens: 99_000 }),
      {
        type: 'result',
        result: 'voici',
        total_cost_usd: 1.5,
        // Le CLI agrege : 90 020 + 95 030 + 99 040. C'est la DEPENSE, pas la fenetre.
        usage: {
          input_tokens: 90,
          output_tokens: 19,
          cache_read_input_tokens: 284_000,
          cache_creation_input_tokens: 0
        }
      }
    ]
    const usage = await drainUsage()
    // La depense reste le cumul : rien de ce qui se facture ne change.
    expect(usage?.inputTokens).toBe(284_090)
    // L'occupation est celle du dernier appel — le seul chiffre qui dit ce que le modele portait.
    expect(usage?.derniereEntree).toBe(99_040)
    expect(usage?.derniereEntreeCache).toBe(99_000)
  })

  it('se replie sur le cumul quand aucun message assistant ne porte d’usage', async () => {
    // Un provider muet sur l'usage par appel doit donner un MAJORANT, jamais une jauge absente.
    spawnCapture.stdoutEvents = [
      assistant('voici'),
      {
        type: 'result',
        result: 'voici',
        total_cost_usd: 0.2,
        usage: {
          input_tokens: 1_000,
          output_tokens: 10,
          cache_read_input_tokens: 4_000,
          cache_creation_input_tokens: 0
        }
      }
    ]
    const usage = await drainUsage()
    expect(usage?.inputTokens).toBe(5_000)
    expect(usage?.derniereEntree).toBe(5_000)
  })
})
