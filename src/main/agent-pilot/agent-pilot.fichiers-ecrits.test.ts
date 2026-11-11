import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { SendResult } from '../providers/types'

/**
 * LA LISTE DES FICHIERS ÉCRITS SORT DE L'APPEL.
 *
 * La carte du fil ne range une demande dans « rien à vérifier » que sur une liste VIDE, reçue par
 * l'événement `fichiers-ecrits`. Deux choses à verrouiller, de bout en bout :
 * - dans un dépôt git lisible, un fichier écrit sort dans la liste, et un appel qui n'écrit rien
 *   sort une liste vide, qui est un fait ;
 * - là où Git ne lit pas le dossier (hors dépôt, ou dépôt sans aucun commit), la photo ne voit rien :
 *   aucune liste vide ne doit en sortir, sinon une écriture faite par une commande passerait pour
 *   « rien écrit » et ne serait jamais vérifiée.
 */

const IDENTITE_DE_TEST = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
}

let appData: string
let racine: string

beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'fichiers-ecrits-app-'))
  racine = mkdtempSync(join(tmpdir(), 'fichiers-ecrits-'))
  configureAutowinAppDataBase(appData)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(appData, { recursive: true, force: true })
  rmSync(racine, { recursive: true, force: true })
})

/**
 * Un dossier de projet sous la racine de test. `git` : dépôt avec un commit, que Git sait lire ;
 * `git-sans-commit` : dépôt vide, où `git log` échoue, donc Git ne lit pas la photo.
 */
function projet(nom: string, nature: 'git' | 'git-sans-commit' | 'nu'): string {
  const dossier = join(racine, nom)
  mkdirSync(dossier)
  if (nature === 'nu') return dossier
  execFileSync('git', ['init', '-q'], { cwd: dossier })
  if (nature === 'git')
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'init'],
      {
        cwd: dossier,
        env: { ...process.env, ...IDENTITE_DE_TEST }
      }
    )
  return dossier
}

/** Un tour dont le modèle écrit `fichier` pendant son unique appel (rien si `undefined`). */
async function unTour(dossier: string, fichier: string | undefined): Promise<PilotEvent[]> {
  const events: PilotEvent[] = []
  const registry = {
    send: vi.fn(async (): Promise<SendResult> => {
      if (fichier) writeFileSync(join(dossier, fichier), 'écrit pendant l’appel\n')
      return { text: 'Fait.', provider: 'claude' } as SendResult
    }),
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [],
    snapshotForPrompt: async () => ({
      tab: 'chat',
      providers: [],
      runsBlocked: [],
      conversationsCount: 0
    }),
    exec: vi.fn()
  }
  await new AgentPilot(
    registry as never,
    roles as never,
    bus as never,
    undefined,
    () => '',
    () => dossier
  ).chat(
    [{ role: 'user', content: 'fais le travail' }],
    (event) => events.push(event),
    undefined,
    1,
    'conv-fichiers-ecrits'
  )
  return events
}

const fichiersEcrits = (events: PilotEvent[]): PilotEvent[] =>
  events.filter((event) => event.kind === 'fichiers-ecrits')

describe('pilote — la liste des fichiers écrits sort de chaque appel', () => {
  it('un fichier écrit dans un dépôt git sort dans la liste', async () => {
    const events = await unTour(projet('git-ecrit', 'git'), 'a.ts')
    expect(fichiersEcrits(events).map((event) => event.data)).toEqual([['a.ts']])
  })

  it('un appel qui n’écrit rien dans un dépôt git sort une liste VIDE', async () => {
    const events = await unTour(projet('git-rien', 'git'), undefined)
    expect(fichiersEcrits(events).map((event) => event.data)).toEqual([[]])
  })

  it('dépôt git sans aucun commit : Git ne lit pas la photo, aucune liste vide ne sort', async () => {
    const events = await unTour(projet('git-sans-commit', 'git-sans-commit'), 'a.ts')
    expect(fichiersEcrits(events)).toEqual([])
  })

  it('hors dépôt git, la photo ne voit rien : aucune liste vide ne sort', async () => {
    const events = await unTour(projet('nu', 'nu'), 'a.ts')
    expect(fichiersEcrits(events)).toEqual([])
  })
})
