import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UNE TÂCHE DE FOND RELANCÉE PAR AUTOWIN N'EST PAS « PERDUE » À LA REPRISE SUIVANTE.
 *
 * fix-ok: conv-253 tours dcb537d2-ed5a-4646-806d-880ef76df295 → bdfe38d3-5ba5-4693-bad2-f70b39bc845e
 * — cause mesurée : `claude.ts` marquait `precedente` toute notification `stopped` d'une tâche
 * inconnue du processus, sans consulter les relances d'Autowin. Journal brut
 * `run-stdout/354008f8-….stdout.jsonl` l.1 : `task_notification` `bmaye5d39` `stopped` ; lot
 * Autowin `taches-de-fond/lots/6cb0f6b4-….json` : même `id` `bmaye5d39`, bash 24564 vivant.
 * Le tour bdfe38d3 a affiché « son résultat est perdu » (turnEvents, delta à 1791731278911) et le
 * modèle a lancé une seconde surveillance (`biiy5js9b`).
 */
const etat = vi.hoisted(() => ({
  evenements: [] as Array<Record<string, unknown>>
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
    child.kill = (): boolean => {
      if (child.exitCode === null) {
        child.exitCode = 1
        setTimeout(() => child.emit('close', 1), 0)
      }
      return true
    }
    setTimeout(() => {
      for (const event of etat.evenements.splice(0))
        stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.exitCode = 0
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

let Adaptateur: typeof import('./claude').ClaudeCliAdapter
let imposerMagasin: (chemin: string | undefined) => void
let suivies: typeof import('./taches-de-fond-suivies')
beforeAll(async () => {
  Adaptateur = (await import('./claude')).ClaudeCliAdapter
  imposerMagasin = (await import('./claude-session-cost')).imposerCheminMagasinCoutsDeSession
  suivies = await import('./taches-de-fond-suivies')
}, 120_000)
afterAll(() => imposerMagasin(undefined))

const lancer = async (): Promise<{ text?: string; statuts: string[] }> => {
  const gen = new Adaptateur({ bin: 'claude' }).send([{ role: 'user', content: '?' }], {
    toolProfile: 'watchdog-read-only'
  })
  const statuts: string[] = []
  let step = await gen.next()
  while (!step.done) {
    const chunk = step.value as { status?: string }
    if (chunk.status) statuts.push(chunk.status)
    step = await gen.next()
  }
  return { ...(step.value as { text?: string }), statuts }
}

beforeEach(() => {
  const session = randomUUID()
  imposerMagasin(join(mkdtempSync(join(tmpdir(), 'cout-session-')), 'couts.json'))
  suivies.viderTachesDeFondSuivies()
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  // Forme EXACTE de la l.1 du journal 354008f8 (tour bdfe38d3), puis un tour ordinaire.
  etat.evenements = [
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'bmaye5d39',
      tool_use_id: 'toolu_019v8SemR7cWYXpmkkyrXDdi',
      status: 'stopped',
      output_file: '',
      summary: "Background shell command didn't finish before the previous session ended",
      session_id: session
    },
    { type: 'system', subtype: 'init', session_id: session },
    {
      type: 'assistant',
      message: {
        id: 'msg_statut',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'Le lecteur est toujours en construction.' }],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 }
      },
      session_id: session
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 2,
      result: 'Le lecteur est toujours en construction.',
      session_id: session,
      total_cost_usd: 0.1,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 }
    }
  ]
})

describe('claude — tâche de fond relancée par Autowin, signalée « stopped » à la reprise', () => {
  it('ne dit PAS « son résultat est perdu » quand Autowin la suit', async () => {
    suivies.noterTacheRelancee({
      conversationId: 'conv-253',
      tache: 'bmaye5d39',
      commande: 'while head -1 "$R" | grep -q "status: open"; do sleep 30; done',
      depuis: Date.parse('2026-10-11T14:45:48Z')
    })
    const res = await lancer()
    const texte = res.text ?? ''
    expect(texte).toContain('Le lecteur est toujours en construction.')
    expect(texte).not.toContain('son résultat est perdu')
    expect(texte).not.toContain('arrêtée avant d')
    // Le relais en direct ne la dit pas « stopped » non plus : elle tourne chez Autowin.
    expect(res.statuts.join('\n')).not.toMatch(/tache de fond stopped/)
    expect(res.statuts.join('\n')).toContain('suivie par Autowin')
  }, 60_000)

  it('garde l’avis « perdu » pour une tâche qu’Autowin ne suit pas', async () => {
    const res = await lancer()
    expect(res.text ?? '').toContain('son résultat est perdu')
  }, 60_000)

  it('une tâche déjà rendue par son tour de reprise n’est pas « perdue » non plus', async () => {
    suivies.noterTacheRelancee({
      conversationId: 'conv-253',
      tache: 'bmaye5d39',
      commande: 'x',
      depuis: 1
    })
    suivies.noterTacheRendue('bmaye5d39')
    const res = await lancer()
    expect(res.text ?? '').not.toContain('son résultat est perdu')
  }, 60_000)
})
