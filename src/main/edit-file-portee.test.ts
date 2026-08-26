import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
 * Le bureau isole vit SOUS ce depot : ses fichiers de test resolvent `import 'vitest'` par remontee
 * de `node_modules`. Cette remontee ne vaut QUE pour les MODULES : le BINAIRE `vitest`, lui, est un
 * nom nu resolu par le PATH du process — `cmd.exe` ne remonte aucun `node_modules/.bin` (c'est une
 * facilite d'npm-script, pas du shell). `spawnVerify` prefixe le PATH avec le `.bin` de
 * l'`executionWorkspace`, absent d'un depot temporaire : sans le rappel ci-dessous, la verification
 * echouait pour une raison d'ENVIRONNEMENT (« 'vitest' n'est pas reconnu ») et ne prouvait plus rien.
 */
/** Saut de ligne sans sequence d'echappement : elle a deja fui telle quelle dans ce fichier. */
const SAUT = String.fromCharCode(10)

const RACINE = join(process.cwd(), '.autowin-data', 'tests-portee')

/** Le `.bin` REEL de ce depot, rendu visible au bureau temporaire — le vrai runner, pas un stub. */
const BIN_REEL = join(process.cwd(), 'node_modules', '.bin')
beforeAll(() => {
  if (!existsSync(BIN_REEL)) throw new Error(`node_modules/.bin introuvable : ${BIN_REEL}`)
  if (!(process.env.PATH ?? '').split(delimiter).includes(BIN_REEL)) {
    process.env.PATH = `${BIN_REEL}${delimiter}${process.env.PATH ?? ''}`
  }
})

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
  /*
   * Sans cela, le cache que vitest ecrit dans le bureau isole (`node_modules/.vite/vitest/<hash>/`)
   * devient un fichier SUIVI a republier : git echoue en « Filename too long » et l'edition est
   * rejetee pour une raison d'ENVIRONNEMENT. Tout depot reel ignore `node_modules` ; le fixture
   * doit lui ressembler, pas etre plus permissif.
   */
  writeFileSync(join(repo, '.gitignore'), ['node_modules/', ''].join(SAUT), 'utf8')
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
