import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { AppCommandBus } from './commands'
import { ConversationStore } from './store/conversations'

/**
 * « À QUI EST CE FICHIER ? » — le réflexe 14 (ne pas écrire sur le travail d'un autre fil) en un
 * seul appel. Scout conv-1086 : 514 appels git à la main dans 143 journaux, et un vrai conflit
 * (`<<<<<<< HEAD … >>>>>>> 05a597f5 (conv-1074`). L'app SAVAIT quel fil avait touché quel fichier
 * (`conversation-file-trace-spool.ts`), mais seule l'interface le lisait, et seulement pour le fil
 * AFFICHÉ (`readCurrentConversationPathOwnership(conversationId)`).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : un fichier créé par conv-a,
 * demandé par conv-b. Une commande qui réutiliserait le filtre par conversation existant
 * (`readCurrentConversationPathOwnership('conv-b')`) ne trouverait RIEN et répondrait « libre » —
 * exactement l'écrasement que la commande doit empêcher.
 */
function depot(): string {
  const ws = mkdtempSync(join(tmpdir(), 'autowin-proprio-ws-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: ws })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  mkdirSync(join(ws, 'src'))
  writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 1\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return ws
}

function bus(workspace: string): AppCommandBus {
  let horloge = 1000
  return new AppCommandBus(
    {
      conversations: new ConversationStore(() => horloge++),
      executionWorkspace: workspace,
      getWorktreeRuntimeStatus: () => ({ available: false, workspacePath: workspace }),
      getWorktreeConflictDiff: async () => ({ available: false, reason: 'not-conflict' })
    } as never,
    () => undefined
  )
}

interface FichierRendu {
  chemin: string
  refus?: string
  nonCommite?: boolean
  fils: { conversation: string; tour?: string; le: string; toi: boolean; diffInchange: boolean }[]
  copiesDeRun: { run: string; etat: string }[]
  amont: { branche?: string; commits: string[] }
  resume: string
}

async function demander(
  b: AppCommandBus,
  chemins: unknown,
  conversationId: string
): Promise<FichierRendu[]> {
  const r = await b.exec('proprietaire_fichier', { chemins }, conversationId, undefined, 'tour-q')
  expect(r.error).toBeUndefined()
  expect(r.ok).toBe(true)
  return (r.data as { fichiers: FichierRendu[] }).fichiers
}

describe('proprietaire_fichier : à qui est ce fichier ?', () => {
  afterEach(() => configureAutowinAppDataBase(undefined))

  const donnees = (): void => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'autowin-proprio-data-')))
  }

  it('signale à conv-b le fichier modifié et non commité par conv-a, avec son tour', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )

    const [fichier] = await demander(b, ['src/partage.ts'], 'conv-b')

    expect(fichier.nonCommite).toBe(true)
    expect(fichier.fils).toEqual([
      expect.objectContaining({
        conversation: 'conv-a',
        tour: 'tour-a',
        toi: false,
        diffInchange: true
      })
    ])
    expect(fichier.fils[0]?.le).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(fichier.resume).toContain('conv-a')
    expect(fichier.resume).toContain('tour-a')
  })

  it('jumeau : le même fichier demandé par conv-a est le SIEN, pas celui d’un autre fil', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )

    const [fichier] = await demander(b, 'src/partage.ts', 'conv-a')

    expect(fichier.fils).toEqual([expect.objectContaining({ conversation: 'conv-a', toi: true })])
    expect(fichier.resume).toMatch(/ce fil/)
    expect(fichier.resume).not.toMatch(/autre fil/)
  })

  it('dit qu’un fichier retouché depuis hors de tout fil tracé n’est plus le diff de conv-a', async () => {
    donnees()
    const ws = depot()
    const b = bus(ws)
    await b.exec(
      'create_file',
      { path: 'src/partage.ts', content: 'export const a = 1\n' },
      'conv-a',
      undefined,
      'tour-a'
    )
    writeFileSync(join(ws, 'src/partage.ts'), 'export const a = 2 // à la main\n')

    const [fichier] = await demander(b, ['src/partage.ts'], 'conv-b')

    expect(fichier.fils).toEqual([
      expect.objectContaining({ conversation: 'conv-a', diffInchange: false })
    ])
    expect(fichier.resume).toMatch(/retouché/)
  })

  it('rend « libre » un fichier commité que personne ne tient', async () => {
    donnees()
    const ws = depot()

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.nonCommite).toBe(false)
    expect(fichier.fils).toEqual([])
    expect(fichier.copiesDeRun).toEqual([])
    expect(fichier.resume).toMatch(/libre/)
  })

  it('refuse un chemin hors du dossier de travail sans priver les autres de réponse', async () => {
    donnees()
    const ws = depot()

    const fichiers = await demander(bus(ws), ['../evasion.ts', 'src/propre.ts'], 'conv-b')

    expect(fichiers[0]).toMatchObject({ chemin: '../evasion.ts', refus: expect.any(String) })
    expect(fichiers[1]).toMatchObject({ chemin: 'src/propre.ts' })
    expect(fichiers[1]?.refus).toBeUndefined()
  })

  it('signale le fichier en cours dans la copie d’un run, pas dans une copie de vérification', async () => {
    donnees()
    const ws = depot()
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const copieRun = join(copies, 'agent__run-abc123-1')
    const copieVerif = join(copies, 'agent__command-verify-conv-9')
    execFileSync('git', ['worktree', 'add', '-q', '--detach', copieRun], { cwd: ws })
    execFileSync('git', ['worktree', 'add', '-q', '--detach', copieVerif], { cwd: ws })
    writeFileSync(join(copieRun, 'src/propre.ts'), 'export const propre = 2 // run\n')
    // Une copie de vérification est un INSTANTANÉ du dossier de l'utilisateur : la signaler
    // reviendrait à dénoncer chaque fichier en cours deux fois.
    writeFileSync(join(copieVerif, 'src/propre.ts'), 'export const propre = 3 // verif\n')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([{ run: 'run-abc123-1', etat: 'non commité' }])
    expect(fichier.resume).toContain('run-abc123-1')
  })

  it('compte le commit PROPRE d’une copie de run, jamais l’amont qu’elle a reçu à sa création', async () => {
    donnees()
    const ws = depot()
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd })
    }
    // Mesuré le 2026-10-22 sur le vrai dépôt : la copie de ce run part d'origin/main, en avance de
    // trois commits sur le main local. Ces trois commits ne sont pas le travail du run.
    git(ws, 'branch', 'amont')
    git(ws, 'checkout', '-q', 'amont')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 9 // amont\n')
    git(ws, 'commit', '-q', '-am', 'change en amont')
    git(ws, 'checkout', '-q', 'main')
    git(ws, 'branch', '--set-upstream-to=amont')
    const copies = mkdtempSync(join(tmpdir(), 'autowin-proprio-copies-'))
    const surAmont = join(copies, 'agent__run-surAmont-1')
    const avecCommit = join(copies, 'agent__run-avecCommit-1')
    git(ws, 'worktree', 'add', '-q', '--detach', surAmont, 'amont')
    git(ws, 'worktree', 'add', '-q', '--detach', avecCommit, 'main')
    writeFileSync(join(avecCommit, 'src/propre.ts'), 'export const propre = 4 // run\n')
    git(avecCommit, 'commit', '-q', '-am', 'travail du run')

    const [fichier] = await demander(bus(ws), ['src/propre.ts'], 'conv-b')

    expect(fichier.copiesDeRun).toEqual([
      { run: 'run-avecCommit-1', etat: 'commité dans la copie, pas encore intégré' }
    ])
  })

  it('signale un fichier changé en amont, et seulement celui-là', async () => {
    donnees()
    const ws = depot()
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: ws })
    }
    writeFileSync(join(ws, 'src/autre.ts'), 'export const autre = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'autre')
    git('branch', 'amont')
    git('checkout', '-q', 'amont')
    writeFileSync(join(ws, 'src/propre.ts'), 'export const propre = 9 // amont\n')
    git('commit', '-q', '-am', 'change en amont')
    git('checkout', '-q', 'main')
    git('branch', '--set-upstream-to=amont')

    const [change, intact] = await demander(bus(ws), ['src/propre.ts', 'src/autre.ts'], 'conv-b')

    expect(change.amont.branche).toBe('amont')
    expect(change.amont.commits).toEqual([expect.stringContaining('change en amont')])
    expect(change.resume).toMatch(/amont/)
    expect(intact.amont.commits).toEqual([])
  })

  it('se déclare en lecture seule, servie au chat comme outil direct', () => {
    const spec = bus(depot())
      .catalog()
      .find((c) => c.name === 'proprietaire_fichier')
    expect(spec?.annotations?.readOnlyHint).toBe(true)
    expect(spec?.horsCanalNatif).toBeUndefined()
  })
})
