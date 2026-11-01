import { EventEmitter } from 'node:events'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chantiersDuJournal } from '../../shared/chantier-du-tour'

/**
 * UN CHANTIER (`Workflow` du CLI) DANS UN TOUR DE CHAT (conv-1362, lot conv-1366).
 *
 * Mesuré sur le CLI 2.1.314 (`.autowin-tmp/conv-1366/long-cli.jsonl`, 176 s, 3 agents) : le flux se
 * tait 167 s pendant que les agents attendent, puis deux `result` arrivent ensemble ; le second
 * (`origin.kind = task-notification`) porte la vraie réponse. Le détecteur de silence tue à 5 min et
 * la coupure après `result` à 30 s : sans le branchement, un chantier long meurt ou rend « c'est
 * lancé en arrière-plan » comme réponse.
 */
const etat = vi.hoisted(() => {
  // Lu au chargement de `watchdog.ts` : réduit AVANT l'import, pour tester le silence sans attendre.
  process.env.AUTOWIN_SUBAGENT_INACTIVITY_MS = '240'
  process.env.AUTOWIN_SUBAGENT_KILL_GRACE_MS = '5'
  return {
    etapes: [] as Array<Array<Record<string, unknown>>>,
    pauseMs: 20,
    fermer: true,
    codeSortie: 0,
    kills: [] as string[],
    args: [] as string[],
    env: {} as Record<string, string | undefined>,
    /** Processus annexes lancés au premier appel (balayages) : ni le CLI, ni son flux. */
    annexes: [] as string[]
  }
})

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[], options?: { env?: Record<string, string | undefined> }) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    if (!args.includes('-p')) {
      etat.annexes.push(args.slice(0, 3).join(' ').slice(0, 80))
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.unref = (): void => {}
      child.kill = (): boolean => true
      setTimeout(() => child.emit('close', 0), 0)
      return child
    }
    etat.args = args
    etat.env = options?.env ?? {}
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
    // Chaque rangée d'événements arrive après un silence : c'est lui qu'on met à l'épreuve.
    void (async () => {
      for (const [rang, rangee] of etat.etapes.splice(0).entries()) {
        await new Promise((r) => setTimeout(r, rang === 0 ? 0 : etat.pauseMs))
        if (child.exitCode !== null) return
        for (const event of rangee) stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      }
      await new Promise((r) => setTimeout(r, 5))
      if (etat.fermer && child.exitCode === null) {
        child.exitCode = etat.codeSortie
        child.emit('close', etat.codeSortie)
      }
    })()
    return child
  }
}))

const SESSION = '11111111-1e38-40dc-bee1-7e47837fd70a'
const RUN = '0mvw1d4lh-ee5ffede'
const DEBUT = {
  type: 'system',
  subtype: 'task_started',
  task_id: 'wi4rmejh2',
  run_id: RUN,
  tool_use_id: 'toolu_1',
  description: 'Audit des routes',
  task_type: 'local_workflow',
  workflow_name: 'audit-routes'
}
const assistant = (texte: string, id: string): Record<string, unknown> => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: texte }],
    usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 10 }
  }
})
const agents = (...etats: string[]): Record<string, unknown> => ({
  type: 'system',
  subtype: 'task_progress',
  task_id: 'wi4rmejh2',
  run_id: RUN,
  usage: { total_tokens: 36159, tool_uses: 3, duration_ms: 5249 },
  workflow_progress: [
    { type: 'workflow_phase', index: 1, title: 'Lecture' },
    ...etats.map((state, i) => ({
      type: 'workflow_agent',
      index: i + 1,
      label: `lecture:${i + 1}`,
      phaseIndex: 1,
      phaseTitle: 'Lecture',
      state,
      startedAt: 1,
      queuedAt: 1
    }))
  ]
})
const FIN = {
  type: 'system',
  subtype: 'task_notification',
  task_id: 'wi4rmejh2',
  run_id: RUN,
  status: 'completed',
  usage: { total_tokens: 40000, tool_uses: 3, duration_ms: 175613 }
}
const R1 = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Le chantier est lancé en arrière-plan.',
  session_id: SESSION,
  total_cost_usd: 0.003,
  usage: { input_tokens: 4, output_tokens: 100, cache_read_input_tokens: 1000 }
}
const R2 = {
  ...R1,
  result: 'BILAN FINAL : 3 agents finis.',
  total_cost_usd: 0.0041,
  usage: { input_tokens: 4, output_tokens: 48, cache_read_input_tokens: 2000 },
  origin: { kind: 'task-notification', producer: 'session-task', runId: RUN }
}
const A1 = assistant('Le chantier est lancé en arrière-plan.', 'msg_1')
const A2 = assistant('BILAN FINAL : 3 agents finis.', 'msg_2')

let Adaptateur: typeof import('./claude').ClaudeCliAdapter
let reinitialiser: typeof import('./claude-session-cost').reinitialiserMagasinCoutsDeSession
beforeAll(async () => {
  Adaptateur = (await import('./claude')).ClaudeCliAdapter
  reinitialiser = (await import('./claude-session-cost')).reinitialiserMagasinCoutsDeSession
}, 120_000)

type Fin = { text?: string; usage?: { costUsd?: number; outputTokens?: number } }

async function lancer(
  message = '<message_utilisateur>Lance un workflow sur les routes</message_utilisateur>',
  signal?: AbortSignal
): Promise<{ fin: Fin; statuts: string[]; deltas: string }> {
  const gen = new Adaptateur({ bin: 'claude' }).send([{ role: 'user', content: message }], {
    workspaceCwd: process.cwd(),
    ...(signal ? { signal } : {})
  })
  const statuts: string[] = []
  let deltas = ''
  let step = await gen.next()
  while (!step.done) {
    if (step.value.status) statuts.push(step.value.status)
    deltas += step.value.delta
    step = await gen.next()
  }
  return { fin: step.value as Fin, statuts, deltas }
}

beforeEach(() => {
  etat.etapes = []
  etat.pauseMs = 20
  etat.fermer = true
  etat.codeSortie = 0
  etat.kills = []
  process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
  process.env.AUTOWIN_CLAUDE_FIN_APRES_RESULTAT_MS = '60'
  delete process.env.AUTOWIN_CHANTIER_SILENCE_MAX_MS
  reinitialiser()
})

describe('claude — le dernier result devient la réponse du tour', () => {
  it('ordre mesuré : assistant, notification, assistant, result, result', async () => {
    // Délai large : le premier appel du fichier écrit le coût sur disque, et ce test porte sur l'ordre.
    // Le test suivant garde le délai court, celui qui ferait mordre la coupure.
    process.env.AUTOWIN_CLAUDE_FIN_APRES_RESULTAT_MS = '5000'
    etat.etapes = [[DEBUT, A1], [agents('progress', 'progress', 'done')], [FIN, A2, R1, R2]]
    const { fin } = await lancer()
    expect(fin.text).toBe('BILAN FINAL : 3 agents finis.')
    expect(etat.kills).toEqual([])
  }, 30_000)

  it('séquence result, task_notification, result : le CLI n’est pas coupé après le premier', async () => {
    // 60 ms de délai après `result`, 120 ms entre deux rangées : sans garde, il est tué entre les deux.
    etat.pauseMs = 120
    etat.etapes = [[DEBUT, A1, R1], [agents('done', 'done', 'progress')], [FIN], [A2, R2]]
    const { fin } = await lancer()
    expect(fin.text).toBe('BILAN FINAL : 3 agents finis.')
    expect(etat.kills).toEqual([])
  }, 30_000)

  it('après le dernier result, un CLI qui ne sort pas est arrêté et sa réponse rendue', async () => {
    etat.fermer = false
    etat.etapes = [
      [DEBUT, A1, R1],
      [FIN, A2, R2]
    ]
    const { fin } = await lancer()
    expect(fin.text).toBe('BILAN FINAL : 3 agents finis.')
    expect(etat.kills.length).toBeGreaterThan(0)
  }, 30_000)

  it('le tour coûte la somme des deux result, et le chantier n’est pas une tâche perdue', async () => {
    etat.etapes = [
      [DEBUT, A1],
      [FIN, A2, R1, R2]
    ]
    const { fin } = await lancer()
    expect(fin.usage?.costUsd).toBeCloseTo(0.0041, 6)
    expect(fin.usage?.outputTokens).toBe(148)
    expect(fin.text).not.toContain('Tâche de fond')
  }, 30_000)

  it('sans chantier, rien ne change : un second result de notification ne remplace pas la réponse', async () => {
    etat.etapes = [
      [assistant('Réponse', 'msg_1'), { ...R1, result: 'Réponse' }],
      [{ ...R2, origin: { kind: 'task-notification', runId: 'autre' }, result: 'Autre chose' }]
    ]
    const { fin } = await lancer('<message_utilisateur>Bonjour</message_utilisateur>')
    expect(fin.text).toBe('Réponse')
  }, 30_000)
})

describe('claude — le silence d’un chantier n’est pas un CLI figé', () => {
  it('un chantier silencieux plus longtemps que le détecteur (240 ms) reste en vie', async () => {
    etat.pauseMs = 500
    etat.etapes = [
      [DEBUT, A1],
      [FIN, A2, R1, R2]
    ]
    const { fin } = await lancer()
    expect(fin.text).toBe('BILAN FINAL : 3 agents finis.')
    expect(etat.kills).toEqual([])
  }, 30_000)

  it('il donne des signes de vie au fil pendant ce silence', async () => {
    etat.pauseMs = 500
    etat.etapes = [
      [DEBUT, A1],
      [FIN, A2, R1, R2]
    ]
    const { statuts } = await lancer()
    const lignes = statuts.filter((s) => s.startsWith('Chantier '))
    // La ligne de départ, au moins un battement, la ligne de fin.
    expect(lignes.length).toBeGreaterThanOrEqual(3)
  }, 30_000)

  it('un CLI lui-même figé finit par être coupé, et la carte le dit', async () => {
    process.env.AUTOWIN_CHANTIER_SILENCE_MAX_MS = '100'
    etat.pauseMs = 5
    etat.fermer = false
    etat.etapes = [[DEBUT, A1]]
    const gen = new Adaptateur({ bin: 'claude' }).send(
      [{ role: 'user', content: '<message_utilisateur>Lance un workflow</message_utilisateur>' }],
      { workspaceCwd: process.cwd() }
    )
    const statuts: string[] = []
    await expect(
      (async () => {
        let step = await gen.next()
        while (!step.done) {
          if (step.value.status) statuts.push(step.value.status)
          step = await gen.next()
        }
      })()
    ).rejects.toThrow(/figé/)
    expect(etat.kills.length).toBeGreaterThan(0)
    expect(chantiersDuJournal(statuts)[0]?.statut).toBe('echec')
  }, 30_000)
})

describe('claude — ce que voit le fil', () => {
  it('relaie la progression en lignes de chantier, relues par le fil', async () => {
    etat.pauseMs = 30
    etat.etapes = [[DEBUT, A1], [agents('progress', 'progress', 'done')], [FIN, A2, R1, R2]]
    const { statuts } = await lancer()
    const [chantier] = chantiersDuJournal(statuts)
    expect(chantier).toMatchObject({
      nom: 'audit-routes',
      statut: 'fini',
      finis: 1,
      jetons: 40000
    })
    expect(chantier?.phases[0]?.titre).toBe('Lecture')
  }, 30_000)

  it('les commandes shell des agents ne deviennent pas des tâches de fond du tour', async () => {
    const shell = {
      type: 'system',
      subtype: 'task_started',
      task_id: 'b9iq7eofy',
      owned_by_subagent: true,
      tool_use_id: 'toolu_9',
      description: 'Run timed node command',
      is_backgrounded: false,
      task_type: 'local_bash'
    }
    const finShell = {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'b9iq7eofy',
      status: 'failed',
      summary: 'Run timed node command'
    }
    etat.etapes = [
      [DEBUT, A1, shell],
      [finShell, FIN, A2, R1, R2]
    ]
    const { statuts, fin } = await lancer()
    expect(statuts.filter((s) => /tache de fond/i.test(s))).toEqual([])
    expect(fin.text).toBe('BILAN FINAL : 3 agents finis.')
  }, 30_000)

  it('un quota refusé pendant le chantier se dit dans la réponse', async () => {
    const refus = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1793446200, rateLimitType: 'five_hour' }
    }
    etat.etapes = [
      [DEBUT, A1],
      [refus, agents('done', 'error', 'error')],
      [FIN, A2, R1, R2]
    ]
    const { fin, statuts } = await lancer()
    expect(fin.text).toContain('Quota atteint')
    expect(fin.text).toContain('2 agents en échec sur 3')
    expect(chantiersDuJournal(statuts)[0]?.quota).toBe(true)
  }, 30_000)

  it('un CLI sorti sans finir son chantier ne passe pas pour un chantier fini', async () => {
    etat.etapes = [[DEBUT, A1, agents('done', 'progress'), R1]]
    const { fin, statuts } = await lancer()
    expect(fin.text).toContain('Le chantier est lancé')
    expect(fin.text).toMatch(/s'est arrêté avant sa fin/)
    expect(chantiersDuJournal(statuts)[0]?.statut).toBe('echec')
  }, 30_000)
})

describe('claude — le plafond du CLI sur les tâches de fond', () => {
  /*
   * Mesuré sur le CLI 2.1.314 (banc-plafond.mjs) : en `-p`, entrée fermée, le CLI stoppe ses tâches de
   * fond 600 s après la fin du tour principal (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, non documentée,
   * `L>0` dans son code). Plafond à 15 s : chantier tué à 22 s, aucun second `result`, code 0. Plafond
   * à 0 : chantier fini, deux `result`. Essai de 30 agents : coupé à 616 s, 15 agents finis.
   */
  it('un tour de chantier le lève', async () => {
    etat.etapes = [[assistant('ok', 'msg_1'), R1]]
    await lancer('<message_utilisateur>Lance un workflow sur les routes</message_utilisateur>')
    expect(etat.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe('0')
  }, 30_000)

  it('un tour ordinaire le garde', async () => {
    etat.etapes = [[assistant('ok', 'msg_1'), R1]]
    await lancer('<message_utilisateur>Corrige le bouton</message_utilisateur>')
    expect(etat.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBeUndefined()
  }, 30_000)

  it('un chantier stoppé par le CLI, sans second result, ne passe pas pour une réponse', async () => {
    // Séquence réelle : notification `stopped`, un seul `result`, sortie en code 0.
    etat.etapes = [
      [DEBUT, A1, agents('done', 'progress')],
      [{ ...FIN, status: 'stopped' }, R1]
    ]
    const { fin, statuts } = await lancer()
    expect(fin.text).toContain('Le chantier est lancé')
    expect(fin.text).toMatch(/s'est arrêté avant sa fin/)
    expect(chantiersDuJournal(statuts)[0]?.statut).toBe('arrete')
  }, 30_000)
})

describe('claude — le bouton d’arrêt', () => {
  it('arrête le CLI et ferme la carte du chantier', async () => {
    etat.pauseMs = 40
    etat.fermer = false
    etat.etapes = [[DEBUT, A1], [agents('progress', 'progress')]]
    const stop = new AbortController()
    const gen = new Adaptateur({ bin: 'claude' }).send(
      [{ role: 'user', content: '<message_utilisateur>Lance un workflow</message_utilisateur>' }],
      { workspaceCwd: process.cwd(), signal: stop.signal }
    )
    const statuts: string[] = []
    setTimeout(() => stop.abort(), 200)
    await expect(
      (async () => {
        let step = await gen.next()
        while (!step.done) {
          if (step.value.status) statuts.push(step.value.status)
          step = await gen.next()
        }
      })()
    ).rejects.toThrow()
    expect(etat.kills.length).toBeGreaterThan(0)
    expect(chantiersDuJournal(statuts)[0]?.statut).toBe('arrete')
  }, 30_000)
})

describe('claude — l’outil ne se charge que sur demande', () => {
  const valeur = (drapeau: string): string => etat.args[etat.args.indexOf(drapeau) + 1] ?? ''

  it('absent d’un tour ordinaire : sa définition pèse 8 242 jetons', async () => {
    etat.etapes = [[assistant('ok', 'msg_1'), R1]]
    await lancer('<message_utilisateur>Corrige le bouton</message_utilisateur>')
    expect(valeur('--tools').split(',')).not.toContain('Workflow')
    expect(etat.args).not.toContain('Workflow')
  }, 30_000)

  it('présent quand l’utilisateur le demande, dans --tools ET --allowedTools', async () => {
    etat.etapes = [[assistant('ok', 'msg_1'), R1]]
    await lancer('<message_utilisateur>Lance un workflow sur les routes</message_utilisateur>')
    expect(valeur('--tools').split(',')).toContain('Workflow')
    const autorises = etat.args.slice(etat.args.indexOf('--allowedTools') + 1)
    expect(autorises).toContain('Workflow')
  }, 30_000)

  it('jamais dans le fond autonome, même si le texte le réclame', async () => {
    etat.etapes = [[assistant('ok', 'msg_1'), R1]]
    const gen = new Adaptateur({ bin: 'claude' }).send(
      [{ role: 'user', content: '<message_utilisateur>Lance un workflow</message_utilisateur>' }],
      { workspaceCwd: process.cwd(), toolProfile: 'watchdog-read-only' }
    )
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(etat.args).not.toContain('Workflow')
  }, 30_000)
})

describe('claude — réglages écrits pour le CLI', () => {
  it('la taille d’un chantier n’est pas bridée, sans toucher au settings.json de l’utilisateur', async () => {
    const { reglagesCliAutowin } = await import('./claude')
    expect(reglagesCliAutowin('G.mjs')).toMatchObject({ workflowSizeGuideline: 'unrestricted' })
  })
})
