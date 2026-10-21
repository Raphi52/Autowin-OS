/**
 * LANCEMENT DU CLI CLAUDE — deux défauts trouvés par l'audit du branchement (conv-1040, 2026-10-21).
 *
 * 1. Un Stop cliqué PENDANT la préparation (réglages, journal, binaire, mise à jour du CLI) était
 *    ignoré : l'écoute du signal n'était posée qu'après le lancement, et un signal déjà levé ne
 *    déclenche plus `abort`. Le CLI, outillé en écriture, faisait donc son tour en entier.
 *    Son écoute n'était jamais retirée non plus : un Stop APRÈS la fin du tour tuait encore le fils.
 * 2. Le relais Windows (chemin par défaut) recevait `process.env` entier, fusionné APRÈS
 *    `withClaudeAccountEnv` : un `CLAUDE_CONFIG_DIR` hérité du processus écrasait le compte actif.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cap = vi.hoisted(() => ({
  appels: [] as Array<{ bin: string; args: string[]; env: Record<string, string | undefined> }>,
  arrets: 0,
  fermetureAuto: true,
  /** Dossier du compte ACTIF tel que le store de comptes le rend ; absent = compte par défaut. */
  compteActif: undefined as string | undefined
}))

vi.mock('../claude-accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../claude-accounts')>()),
  // Même contrat que le vrai : la variable héritée part toujours, celle du compte actif est posée.
  withClaudeAccountEnv: (base: Record<string, string | undefined>) => {
    const env = { ...base }
    delete env.CLAUDE_CONFIG_DIR
    if (cap.compteActif) env.CLAUDE_CONFIG_DIR = cap.compteActif
    return env
  }
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (bin: string, args: string[], options: { env?: Record<string, string | undefined> }) => {
    cap.appels.push({ bin, args, env: options.env ?? {} })
    const fils = new EventEmitter() as EventEmitter & Record<string, unknown>
    fils.stdout = new EventEmitter()
    fils.stderr = new EventEmitter()
    fils.stdin = { end: (): void => {}, on: (): void => {} }
    // AUCUN pid : l'escalade d'arrêt ne doit jamais viser un vrai processus du poste.
    fils.exitCode = null
    fils.unref = (): void => {}
    const fermer = (code: number): void => {
      if (fils.exitCode !== null) return
      fils.exitCode = code
      fils.emit('close', code)
    }
    fils.kill = (): boolean => {
      cap.arrets++
      setTimeout(() => fermer(1), 0)
      return true
    }
    if (cap.fermetureAuto) setTimeout(() => fermer(0), 5)
    return fils
  }
}))

const ENV_SURVEILLEES = [
  'AUTOWIN_RUN_JOURNAL_ROOT',
  'CLAUDE_CONFIG_DIR',
  'AUTOWIN_DETACHED_RUNS'
] as const
let envAvant: Record<string, string | undefined>
let racineJournal: string

beforeEach(() => {
  envAvant = Object.fromEntries(ENV_SURVEILLEES.map((k) => [k, process.env[k]]))
  cap.appels = []
  cap.arrets = 0
  cap.fermetureAuto = true
  cap.compteActif = undefined
  racineJournal = mkdtempSync(join(tmpdir(), 'autowin-lancement-'))
  delete process.env.AUTOWIN_DETACHED_RUNS
})
afterEach(() => {
  for (const k of ENV_SURVEILLEES) {
    if (envAvant[k] === undefined) delete process.env[k]
    else process.env[k] = envAvant[k]
  }
  rmSync(racineJournal, { recursive: true, force: true })
})

async function adaptateur(): Promise<import('./claude').ClaudeCliAdapter> {
  const { ClaudeCliAdapter } = await import('./claude')
  return new ClaudeCliAdapter({ bin: 'C:/outils/claude.exe' })
}

async function drainer(gen: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  let pas = await gen.next()
  while (!pas.done) pas = await gen.next()
}

const attendre = <T>(ms: number, valeur: T): Promise<T> =>
  new Promise((r) => setTimeout(() => r(valeur), ms))

describe('Stop pendant la préparation du lancement', () => {
  for (const mode of ['relais survivable', 'tuyau direct'] as const) {
    it(`${mode} : aucun CLI lancé, l'appel rend un arrêt et ne laisse pas son entrée sur le disque`, async () => {
      if (mode === 'relais survivable') process.env.AUTOWIN_RUN_JOURNAL_ROOT = racineJournal
      else delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
      cap.fermetureAuto = false
      const stop = new AbortController()
      const gen = (await adaptateur()).send([{ role: 'user', content: 'travaille' }], {
        signal: stop.signal
      })
      const premier = gen.next()
      // Le générateur est suspendu sur sa première attente de préparation : l'utilisateur clique Stop.
      stop.abort('Stop utilisateur')
      const issue = await Promise.race([
        premier.then(
          () => 'rendu',
          (e: Error) => `arrêt: ${e.message}`
        ),
        attendre(2_000, 'toujours en attente')
      ])
      expect(cap.appels).toHaveLength(0)
      expect(issue).toMatch(/^arrêt: /)
      // Le message de l'utilisateur, écrit pour le relais avant le lancement, ne reste pas derrière.
      const entrees = existsSync(racineJournal)
        ? readdirSync(racineJournal).filter((f) => f.endsWith('.stdin'))
        : []
      expect(entrees).toEqual([])
    })
  }

  it('après la fin du tour, un Stop ne vise plus le processus terminé (écoute retirée)', async () => {
    delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
    const stop = new AbortController()
    await drainer(
      (await adaptateur()).send([{ role: 'user', content: 'x' }], { signal: stop.signal })
    )
    expect(cap.appels).toHaveLength(1)
    stop.abort('Stop plus tard, sur un autre tour')
    await attendre(20, undefined)
    expect(cap.arrets).toBe(0)
  })
})

describe('environnement du relais Windows', () => {
  it('le CLI reçoit le dossier du COMPTE ACTIF, pas celui hérité du processus', async () => {
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = racineJournal
    process.env.CLAUDE_CONFIG_DIR = 'C:/herite-d-un-autre-compte'
    cap.compteActif = 'C:/compte-actif'
    await drainer((await adaptateur()).send([{ role: 'user', content: 'x' }])).catch(
      () => undefined
    )
    expect(cap.appels).toHaveLength(1)
    expect(cap.appels[0]!.env.CLAUDE_CONFIG_DIR).toBe('C:/compte-actif')
  })

  it('compte par défaut : la variable héritée est RETIRÉE, pas réinjectée par le relais', async () => {
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = racineJournal
    process.env.CLAUDE_CONFIG_DIR = 'C:/herite-d-un-autre-compte'
    await drainer((await adaptateur()).send([{ role: 'user', content: 'x' }])).catch(
      () => undefined
    )
    expect(cap.appels).toHaveLength(1)
    expect(cap.appels[0]!.env.CLAUDE_CONFIG_DIR).toBeUndefined()
  })
})
