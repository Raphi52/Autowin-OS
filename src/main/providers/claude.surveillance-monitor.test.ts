import { EventEmitter } from 'node:events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UNE SURVEILLANCE OUVERTE GARDE LE CLI EN VIE (conv-1370, lot 5, 2026-10-31).
 *
 * Mesuré sur le CLI 2.1.314 (sondes `claude -p --model haiku`, drapeaux du chat) : le modèle lance
 * `Monitor`, finit son tour par « j'attends », et le CLI émet `result`. Il reste alors en vie : à
 * chaque événement il rouvre un tour et émet un nouveau `result` (`origin.kind` =
 * `task-notification`). Une ligne arrivée 45 s après le premier `result` a bien été lue.
 *
 * L'app, elle, arrêtait tout CLI vivant 30 s après son `result` (`delaiFinApresResultatMs`) et le
 * détecteur de silence coupait à 5 min. Monitor aurait donc perdu toute ligne tardive, pour le seul
 * usage que l'aide de Bash lui donne : attendre. Une surveillance dure au plus 10 min (schéma de
 * l'outil : « Deadlines above 600000ms are capped »), d'où la borne.
 */
const etat = vi.hoisted(() => ({
  lots: [] as { apresMs: number; events?: Array<Record<string, unknown>>; fermer?: boolean }[],
  kills: [] as number[]
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
      etat.kills.push(Date.now())
      if (child.exitCode === null) {
        child.exitCode = 1
        setTimeout(() => child.emit('close', 1), 0)
      }
      return true
    }
    for (const lot of etat.lots.splice(0))
      setTimeout(() => {
        if (child.exitCode !== null) return
        for (const event of lot.events ?? [])
          stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
        if (lot.fermer) {
          child.exitCode = 0
          child.emit('close', 0)
        }
      }, lot.apresMs)
    return child
  }
}))

const FIN_MS = 100
const SILENCE_MS = 300

const texte = (t: string): Record<string, unknown> => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text: t }] }
})
const lancerMonitor = (id: string): Array<Record<string, unknown>> => [
  {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: `toolu_${id}`,
          name: 'Monitor',
          input: { command: 'sleep 45; echo TARD', description: 'sonde', timeout_ms: 120_000 }
        }
      ]
    }
  },
  {
    type: 'system',
    subtype: 'task_started',
    task_id: id,
    tool_use_id: `toolu_${id}`,
    is_backgrounded: true,
    task_type: 'local_bash',
    description: 'sonde'
  }
]
const finMonitor = (id: string): Record<string, unknown> => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: id,
  tool_use_id: `toolu_${id}`,
  status: 'completed',
  summary: 'Monitor "sonde" stream ended'
})
const resultat = (cout: number, notification = false): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'fini',
  session_id: 'sess-surveillance',
  total_cost_usd: cout,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
  ...(notification ? { origin: { kind: 'task-notification', producer: 'session-task' } } : {})
})

let Adaptateur: typeof import('./claude').ClaudeCliAdapter
beforeAll(async () => {
  // Lu au chargement du module : posé AVANT l'import (borne du détecteur de silence).
  process.env.AUTOWIN_SUBAGENT_INACTIVITY_MS = String(SILENCE_MS)
  Adaptateur = (await import('./claude')).ClaudeCliAdapter
}, 120_000)

let session = 0
const lancer = async (): Promise<{
  text?: string
  usage?: { costUsd?: number }
  statuts: string[]
}> => {
  // Le cumul de coût se suit par session : une session par test.
  session += 1
  for (const lot of etat.lots)
    for (const e of lot.events ?? [])
      if (e.type === 'result') e.session_id = `sess-surveillance-${session}`
  const gen = new Adaptateur({ bin: 'claude' }).send([{ role: 'user', content: 'x' }], {
    toolProfile: 'watchdog-read-only'
  })
  const statuts: string[] = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.status) statuts.push(step.value.status)
    step = await gen.next()
  }
  return { ...(step.value as { text?: string; usage?: { costUsd?: number } }), statuts }
}

beforeEach(() => {
  etat.lots = []
  etat.kills = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  process.env.AUTOWIN_CLAUDE_FIN_APRES_RESULTAT_MS = String(FIN_MS)
  delete process.env.AUTOWIN_CLAUDE_LIMITE_SURVEILLANCE_MS
})

describe('claude — surveillance Monitor ouverte après le result', () => {
  it('garde le CLI en vie au-delà du délai de fin ET du silence, puis rend tout', async () => {
    etat.lots = [
      { apresMs: 0, events: [...lancerMonitor('s1'), texte('ATTENTE'), resultat(1)] },
      // Silence plus long que le détecteur (300 ms) et que le délai de fin (100 ms).
      { apresMs: SILENCE_MS * 2, events: [texte('RECU TARD-LIGNE'), resultat(1.5, true)] },
      { apresMs: SILENCE_MS * 3, events: [finMonitor('s1')] },
      { apresMs: SILENCE_MS * 3 + 20, events: [texte('Fini.'), resultat(2, true)], fermer: true }
    ]
    const res = await lancer()
    expect(etat.kills).toEqual([])
    // Chaque événement rouvre un tour : mesuré « ATTENTERECU TARD-LIGNE » sans séparation.
    expect(res.text).toContain('ATTENTE\n\nRECU TARD-LIGNE\n\nFini.')
    expect(res.text).not.toMatch(/Tâche de fond/)
    // Chaque tour de surveillance est un appel payé : le coût du tour est le cumul, pas le dernier.
    expect(res.usage?.costUsd).toBeCloseTo(2)
  }, 20_000)

  it('la surveillance finie, le délai de fin revient : un CLI resté en vie est arrêté', async () => {
    const debut = Date.now()
    etat.lots = [
      { apresMs: 0, events: [...lancerMonitor('s2'), resultat(1)] },
      { apresMs: 200, events: [finMonitor('s2'), texte('Fini.'), resultat(1.2, true)] }
    ]
    const res = await lancer()
    expect(res.text).toContain('Fini.')
    expect(etat.kills.length).toBeGreaterThan(0)
    // Ni avant la fin de la surveillance, ni au bout des 5 min du détecteur.
    expect(etat.kills[0] - debut).toBeGreaterThanOrEqual(200)
    expect(Date.now() - debut).toBeLessThan(5_000)
  }, 20_000)

  it('témoin : sans surveillance, le délai de fin s’applique comme avant', async () => {
    const debut = Date.now()
    etat.lots = [{ apresMs: 0, events: [texte('Réponse.'), resultat(1)] }]
    const res = await lancer()
    expect(res.text).toContain('Réponse.')
    expect(etat.kills.length).toBeGreaterThan(0)
    expect(etat.kills[0] - debut).toBeLessThan(SILENCE_MS)
  }, 20_000)

  it('une surveillance lancée APRÈS le result retire le délai de fin déjà armé', async () => {
    etat.lots = [
      { apresMs: 0, events: [texte('Réponse.'), resultat(1)] },
      // Tour rouvert par le CLI : le modèle y lance une surveillance, dans le délai de fin.
      { apresMs: 10, events: [...lancerMonitor('s3'), resultat(1.1, true)] },
      { apresMs: SILENCE_MS * 2, events: [finMonitor('s3'), resultat(1.2, true)], fermer: true }
    ]
    await lancer()
    expect(etat.kills).toEqual([])
  }, 20_000)

  it('un CLI qui ne finit jamais sa surveillance est arrêté à la borne, la réponse est rendue', async () => {
    process.env.AUTOWIN_CLAUDE_LIMITE_SURVEILLANCE_MS = '200'
    etat.lots = [{ apresMs: 0, events: [...lancerMonitor('s4'), texte('J’attends.'), resultat(1)] }]
    const debut = Date.now()
    const res = await lancer()
    expect(res.text).toContain('J’attends.')
    expect(res.statuts.join('\n')).toMatch(/surveillance sans fin/)
    expect(etat.kills[0] - debut).toBeGreaterThanOrEqual(200)
  }, 20_000)
})
