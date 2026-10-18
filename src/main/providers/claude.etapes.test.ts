/**
 * ÉTAPES DU TOUR — rejoue le flux RÉEL du CLI 2.1.302 (capturé le 2026-10-17 :
 * `fixtures/claude-2.1.302-taches.jsonl`, trois TaskCreate puis trois TaskUpdate) dans l'adaptateur,
 * et vérifie ce que le fil recevra. Demande conv-304 : « un bloc avec les étapes de la task et leur
 * progression, ils ont mis ça dans claude.exe ».
 */
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { etapesDuJournal } from '../../shared/etapes-du-tour'

const spawnCapture = vi.hoisted(() => ({
  stdoutEvents: [] as Array<Record<string, unknown>>,
  args: [] as string[],
  env: {} as Record<string, string | undefined>,
  configDir: ''
}))
// Le dossier de config du tour vient du COMPTE actif (withClaudeAccountEnv), pas de process.env :
// sans ce double, le test lirait le vrai `~/.claude/tasks` du poste.
vi.mock('../claude-accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../claude-accounts')>()),
  withClaudeAccountEnv: (base: Record<string, string | undefined>) => ({
    ...base,
    CLAUDE_CONFIG_DIR: spawnCapture.configDir
  })
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[], options: { env?: Record<string, string | undefined> }) => {
    spawnCapture.args = args
    spawnCapture.env = options.env ?? {}
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

// Session NEUVE : celle de la capture existe aussi dans le vrai dossier du poste.
const SESSION = `test-etapes-${process.pid}`
const FLUX_REEL = readFileSync(join(__dirname, 'fixtures', 'claude-2.1.302-taches.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Record<string, unknown>)
  .map((e) => (e.type === 'system' ? { ...e, session_id: SESSION } : e))

const succes = {
  type: 'result',
  subtype: 'success',
  result: 'OK',
  session_id: SESSION,
  is_error: false,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
}

let configDir: string

beforeEach(() => {
  spawnCapture.stdoutEvents = []
  configDir = mkdtempSync(join(tmpdir(), 'autowin-etapes-'))
  spawnCapture.configDir = configDir
})
afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
})

async function drainStatus(): Promise<string[]> {
  const { ClaudeCliAdapter } = await import('./claude')
  const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }])
  const statuts: string[] = []
  let step = await gen.next()
  while (!step.done) {
    if (step.value.status) statuts.push(step.value.status)
    step = await gen.next()
  }
  return statuts
}

describe('étapes du tour — flux réel du CLI', () => {
  it('relaie chaque création et chaque avancement en lignes « Étape », sans ligne d’action', async () => {
    spawnCapture.stdoutEvents = [...FLUX_REEL, succes]
    const statuts = await drainStatus()
    expect(statuts).toEqual([
      'Étape #1 à faire · A: say hi',
      'Étape #2 à faire · B: count to 3',
      'Étape #3 à faire · C: say bye',
      'Étape #1 en cours · A: say hi',
      'Étape #1 terminée · A: say hi',
      'Étape #2 en cours · B: count to 3'
    ])
    // Le fil en tire la liste telle que claude.exe la dessinerait à la fin du tour.
    expect(etapesDuJournal(statuts)).toEqual([
      { id: '1', sujet: 'A: say hi', statut: 'completed' },
      { id: '2', sujet: 'B: count to 3', statut: 'in_progress' },
      { id: '3', sujet: 'C: say bye', statut: 'pending' }
    ])
  })

  it('reprend les étapes OUVERTES d’un tour précédent, lues dans le dossier de la session', async () => {
    // Tour repris : le CLI garde la liste par session (`<config>/tasks/<session>/<id>.json`).
    const dossier = join(configDir, 'tasks', SESSION)
    mkdirSync(dossier, { recursive: true })
    const tache = (id: string, subject: string, status: string): void =>
      writeFileSync(
        join(dossier, `${id}.json`),
        JSON.stringify({ id, subject, description: '', status, blocks: [], blockedBy: [] })
      )
    tache('1', 'Lire le code', 'completed')
    tache('2', 'Écrire le test', 'in_progress')
    // Ce tour-ci ne fait QUE terminer l'étape 2 : son flux ne dit pas son sujet.
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'init', session_id: SESSION },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'u1',
              name: 'TaskUpdate',
              input: { taskId: '2', status: 'completed' }
            }
          ]
        }
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'Updated task #2 status' }]
        },
        tool_use_result: {
          success: true,
          taskId: '2',
          statusChange: { from: 'in_progress', to: 'completed' }
        }
      },
      succes
    ]
    const statuts = await drainStatus()
    // L'étape 1, déjà finie avant ce tour, n'encombre pas le bloc de la nouvelle demande.
    expect(statuts).toEqual([
      'Étape #2 en cours · Écrire le test',
      'Étape #2 terminée · Écrire le test'
    ])
  })

  it('un appel d’étapes en échec ne change rien', async () => {
    spawnCapture.stdoutEvents = [
      { type: 'system', subtype: 'init', session_id: SESSION },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'X' } }]
        }
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: 'boom' }]
        }
      },
      succes
    ]
    expect(await drainStatus()).toEqual([])
  })
})

describe('étapes du tour — outils du tour de chat', () => {
  it('le tour de chat charge ET autorise TaskCreate, TaskUpdate et TaskList', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'autowin-etapes-ws-'))
    try {
      const { ClaudeCliAdapter } = await import('./claude')
      spawnCapture.stdoutEvents = [succes]
      const gen = new ClaudeCliAdapter({ bin: 'claude' }).send(
        [{ role: 'user', content: 'Salut' }],
        { workspaceCwd: workspace }
      )
      while (!(await gen.next()).done) {
        /* vidange */
      }
      const outils = spawnCapture.args[spawnCapture.args.indexOf('--tools') + 1] ?? ''
      expect(outils.split(',')).toEqual(
        expect.arrayContaining(['TaskCreate', 'TaskUpdate', 'TaskList'])
      )
      // TaskGet n'est pas chargé : +390 jetons pour un détail que le bloc n'affiche pas.
      expect(outils.split(',')).not.toContain('TaskGet')
      const autorises = spawnCapture.args.slice(spawnCapture.args.indexOf('--allowedTools') + 1)
      for (const nom of ['TaskCreate', 'TaskUpdate', 'TaskList']) expect(autorises).toContain(nom)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
