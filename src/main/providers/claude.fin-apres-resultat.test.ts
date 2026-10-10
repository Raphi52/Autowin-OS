import { EventEmitter } from 'node:events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UNE RÉPONSE FINIE N'EST PAS UN CLI FIGÉ.
 *
 * Mesure conv-159, tour `b60bf535-44e5-47e8-b43a-e3260ddc74ef` (promptCalls ts
 * 2026-10-10T12:00:20.721Z, iteration 0) : l'appel est rejeté « claude CLI figé (aucune sortie) —
 * tué par le watchdog » après 600 464 ms. Son journal `run-stdout/f7fbf3a2-…stdout.jsonl` finit
 * pourtant par un event `result` `success` (0,95 USD, commande `<cmd>` valide) écrit à 11:55:20.653Z,
 * 300 s pile avant le kill — et aucun `.exit.json` : le CLI n'est jamais sorti. La réponse a été
 * jetée, l'appel compté « non chiffré », et le travail refait de zéro dans une nouvelle session.
 * Sur 173 journaux du poste, le CLI sort au plus 4,1 s après son `result` (médiane 0,9 s).
 */
const etat = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  fermerApresResultat: false,
  kills: [] as string[]
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.unref = (): void => {}
    child.exitCode = null
    child.kill = (signal?: string): boolean => {
      etat.kills.push(String(signal))
      if (child.exitCode === null) {
        child.exitCode = 1
        setTimeout(() => child.emit('close', 1), 0)
      }
      return true
    }
    setTimeout(() => {
      for (const event of etat.events.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      if (etat.fermerApresResultat) {
        child.exitCode = 0
        child.emit('close', 0)
      }
      // Sinon : le processus RESTE en vie apres son `result`, comme f7fbf3a2.
    }, 0)
    return child
  }
}))

const RESULTAT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Je relis les goûts.\n\n<cmd>{"name":"brain_query","args":{"question":"goût"}}</cmd>',
  session_id: '358b46b1-1e38-40dc-bee1-7e47837fd70a',
  total_cost_usd: 0.9495456,
  usage: { input_tokens: 38, output_tokens: 6344, cache_read_input_tokens: 1196008 }
}

let Adaptateur: typeof import('./claude').ClaudeCliAdapter
// Charge le module UNE fois : la duree mesuree est celle de l'appel, pas celle de l'import.
beforeAll(async () => {
  Adaptateur = (await import('./claude')).ClaudeCliAdapter
}, 120_000)

const lancer = async (): Promise<{ text?: string; usage?: { costUsd?: number } }> => {
  const gen = new Adaptateur({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value as { text?: string; usage?: { costUsd?: number } }
}

beforeEach(() => {
  etat.events = [RESULTAT]
  etat.fermerApresResultat = false
  etat.kills = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  process.env.AUTOWIN_CLAUDE_FIN_APRES_RESULTAT_MS = '60'
})

describe('claude — le CLI qui ne sort pas APRÈS son result', () => {
  it('rend la réponse complète au lieu de la jeter comme « figé »', async () => {
    const debut = Date.now()
    const res = await lancer()
    expect(res.text).toContain('<cmd>{"name":"brain_query"')
    expect(res.usage?.costUsd).toBeGreaterThan(0)
    // Le processus resté en vie est arrêté, sans attendre les 5 min du détecteur de silence.
    expect(etat.kills.length).toBeGreaterThan(0)
    expect(Date.now() - debut).toBeLessThan(5_000)
  }, 60_000)

  it('un CLI qui sort normalement après son result n’est jamais tué', async () => {
    etat.fermerApresResultat = true
    const res = await lancer()
    expect(res.text).toContain('brain_query')
    await new Promise((r) => setTimeout(r, 150))
    expect(etat.kills).toEqual([])
  }, 60_000)
})
