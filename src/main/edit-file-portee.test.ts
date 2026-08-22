import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'

/**
 * DEFAUT VECU le 22/08 (conv-1363) : `edit_file` conditionnait sa publication a un verdict GLOBAL —
 * la suite ENTIERE devait sortir a 0. Ce verdict repond « le depot est-il vert ? », jamais « cette
 * edition a-t-elle casse quelque chose ? ». Une edition SAINE de `orchestration-outcome.ts` a donc
 * ete jetee parce que `Markdown.test.tsx` echouait — 11 tests sur 62, sur le commit COMMITTE et
 * sans aucun rapport avec elle (le bureau isole part d'`origin` et EXCLUT les fichiers sales : la
 * contamination locale, longtemps soupconnee, n'y etait pour rien).
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CES TESTS SI LA CORRECTION EST FAUSSE :
 *  - un depot dont un test SANS RAPPORT est deja rouge, et une edition saine : si la portee reste
 *    globale, la publication est refusee (rouge) ;
 *  - une edition qui casse VRAIMENT le test du fichier edite : si la portee est mal derivee — ou si
 *    la verification est simplement affaiblie — elle passe, et c'est un faux vert publie d'office.
 * Les deux ensemble sont le point : on change ce que le verdict MESURE, pas s'il existe.
 *
 * Le bureau isole doit vivre SOUS ce depot : vitest s'y resout par remontee de `node_modules`.
 */
const RACINE = join(process.cwd(), '.autowin-data', 'tests-portee')

const temporaires: string[] = []
afterEach(() => {
  for (const chemin of temporaires.splice(0)) {
    try {
      rmSync(chemin, { recursive: true, force: true })
    } catch {
      /* Windows relache ses verrous en differe — le menage est un confort, pas le verdict */
    }
  }
})

/** Un depot dont la suite est DEJA ROUGE, sur un fichier etranger a ce qui sera edite. */
function depotDejaRouge(): { repo: string; git: (...a: string[]) => string } {
  mkdirSync(RACINE, { recursive: true })
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot-rouge', scripts: { 'test:unit': 'vitest run' } }),
    'utf8'
  )
  writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 1\n', 'utf8')
  writeFileSync(
    join(repo, 'sujet.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "import { valeur } from './sujet'",
      "it('rend 1', () => expect(valeur()).toBe(1))",
      ''
    ].join('\n'),
    'utf8'
  )
  // Le rouge PREEXISTANT : il n'importe pas `sujet.ts`, donc il est hors de la portee de l'edition.
  writeFileSync(
    join(repo, 'etranger.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "it('rouge deja committe, sans rapport', () => expect(1).toBe(2))",
      ''
    ].join('\n'),
    'utf8'
  )
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base deja rouge')
  return { repo, git }
}

function busSur(repo: string): AppCommandBus {
  const wtRoot = mkdtempSync(join(RACINE, 'wt-'))
  temporaires.push(wtRoot)
  const coordinator = new RunWorktreeCoordinator({
    manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
  })
  return new AppCommandBus(
    { executionWorkspace: repo, worktrees: coordinator } as never,
    () => undefined
  )
}

describe('edit_file — le verdict juge l’ÉDITION, pas l’état général du dépôt', () => {
  it('publie une édition saine alors qu’un test SANS RAPPORT est déjà rouge', async () => {
    const { repo, git } = depotDejaRouge()

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 1',
        newText: 'export const valeur = (): number => 1 // commentaire sans effet'
      },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('commentaire sans effet')
    // Le verdict NOMME sa portée : un vert dont on ignore l’étendue se lit plus large qu’il n’est.
    const data = result.data as { verifie?: string; portee?: string }
    expect(data.verifie).toContain('vitest related')
    expect(data.portee).toContain('importent')
    // Le rouge préexistant n’a pas été « réparé » au passage : il est resté INTACT.
    expect(readFileSync(join(repo, 'etranger.test.ts'), 'utf8')).toContain('toBe(2)')
    expect(git('status', '--porcelain')).toBe('')
  }, 180_000)

  it('refuse toujours une édition qui casse RÉELLEMENT le test de son fichier', async () => {
    const { repo } = depotDejaRouge()

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 1',
        newText: 'export const valeur = (): number => 42'
      },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: false })
    // La base reste INTACTE : rien de rouge n’est publié, la garantie n’est pas seulement assouplie.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('=> 1\n')
    expect(existsSync(join(repo, 'sujet.ts'))).toBe(true)
  }, 180_000)
})
