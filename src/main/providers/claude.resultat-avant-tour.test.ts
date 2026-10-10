import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UN `result` QUI ARRIVE AVANT LA DEMANDE N'EST PAS SA RÉPONSE.
 *
 * Mesure conv-217, tour `1d809770-55bc-42b8-896d-ffab2d2270b0` (promptCalls ts
 * 2026-10-10T20:43:04.816Z, saisie ts 1791664946556 « go ») : la session est reprise
 * (`--resume 21aa1316-…`) alors qu'une commande de fond du tour précédent avait été coupée. Le
 * journal brut `run-stdout/c4cf11ed-8ae5-46b9-960d-56fa769ee322.stdout.jsonl` commence par :
 *   l.1 `task_notification` status `stopped` (« …didn't finish before the previous session ended »)
 *   l.2 `system:init`
 *   l.3 `result` success, `num_turns` 0, 0 token, 208 ms, `origin: {kind: 'task-notification'}`
 * PUIS le vrai tour (l.4 `system:init`, raisonnement, texte, appel `Bash` l.437). Autowin a pris la
 * l.3 pour la fin du tour : coupure armée, CLI tué 30 s plus tard en plein travail (aucun
 * `.exit.json`, aucun second `result`), tour affiché « terminé » avec 0 token et le coût
 * 0,3023 USD du PREMIER tour recopié. L'utilisateur a attendu 17 min puis : « je crois que cette
 * conv a planté en route » (saisie ts 1791666005400).
 */
const etat = vi.hoisted(() => ({
  avant: [] as Array<Record<string, unknown>>,
  tour: [] as Array<Record<string, unknown>>,
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
    const emettre = (events: Array<Record<string, unknown>>): void => {
      for (const event of events) stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
    }
    // 1) Ce que le CLI dit AVANT de traiter la demande (reprise d'une session).
    setTimeout(() => emettre(etat.avant.splice(0)), 0)
    // 2) Le vrai tour arrive bien APRÈS le délai de coupure (60 ms ici, 30 s en production).
    setTimeout(() => {
      if (child.exitCode !== null) return // tué entre-temps : le vrai tour n'arrive jamais
      emettre(etat.tour.splice(0))
      child.exitCode = 0
      child.emit('close', 0)
    }, 400)
    return child
  }
}))

let Adaptateur: typeof import('./claude').ClaudeCliAdapter
let imposerMagasin: (chemin: string | undefined) => void
beforeAll(async () => {
  Adaptateur = (await import('./claude')).ClaudeCliAdapter
  imposerMagasin = (await import('./claude-session-cost')).imposerCheminMagasinCoutsDeSession
}, 120_000)
afterAll(() => imposerMagasin(undefined))

const lancer = async (): Promise<{ text?: string; usage?: { costUsd?: number } }> => {
  const gen = new Adaptateur({ bin: 'claude' }).send([{ role: 'user', content: 'go' }], {
    toolProfile: 'watchdog-read-only'
  })
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value as { text?: string; usage?: { costUsd?: number } }
}

let session = ''
beforeEach(() => {
  session = randomUUID()
  imposerMagasin(join(mkdtempSync(join(tmpdir(), 'cout-session-')), 'couts.json'))
  etat.kills = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  process.env.AUTOWIN_CLAUDE_FIN_APRES_RESULTAT_MS = '60'
  // Forme EXACTE des lignes 1 à 3 du journal c4cf11ed (champs inutiles au test retirés).
  etat.avant = [
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bd74t04oh',
      tool_use_id: 'toolu_01RoFGmk6QtKP59FMFEx7HN6',
      status: 'stopped',
      output_file: '',
      summary: "Background shell command didn't finish before the previous session ended",
      session_id: session
    },
    { type: 'system', subtype: 'init', session_id: session },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 0,
      result: '',
      session_id: session,
      total_cost_usd: 0.30234839999999996,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
      origin: { kind: 'task-notification' },
      duration_ms: 208
    }
  ]
  etat.tour = [
    { type: 'system', subtype: 'init', session_id: session },
    {
      type: 'assistant',
      message: {
        id: 'msg_vrai_tour',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'Cadrage terminé : voici les trois options.' }],
        usage: { input_tokens: 12, output_tokens: 900, cache_read_input_tokens: 400_000 }
      },
      session_id: session
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 6,
      result: 'Cadrage terminé : voici les trois options.',
      session_id: session,
      total_cost_usd: 0.91,
      usage: { input_tokens: 12, output_tokens: 900, cache_read_input_tokens: 400_000 }
    }
  ]
})

describe('claude — result de notification émis AVANT la demande (reprise de session)', () => {
  it('attend le vrai tour au lieu de couper le CLI en plein travail', async () => {
    const res = await lancer()
    expect(res.text).toContain('Cadrage terminé : voici les trois options.')
    // Le CLI sort de lui-même : personne ne l'a tué.
    expect(etat.kills).toEqual([])
  }, 60_000)

  it('ne facture pas au tour le cumul recopié par le result de notification', async () => {
    const res = await lancer()
    expect(res.usage?.costUsd).toBeCloseTo(0.91, 6)
  }, 60_000)

  it("ne dit pas qu'une tâche d'un tour PRÉCÉDENT a été arrêtée « à la fin de ce tour »", async () => {
    const res = await lancer()
    const texte = res.text ?? ''
    expect(texte).not.toContain('à la fin de ce tour')
    // « Relance la demande » ne referait pas une commande qu'une AUTRE demande avait lancée.
    expect(texte).not.toContain('relance la demande')
    expect(texte).toContain('lancée à un tour précédent')
  }, 60_000)
})
