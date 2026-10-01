import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * LA VÉRIFICATION AVANT PUBLICATION, AVEC LE VRAI RUNNER.
 *
 * Mesuré le 2026-10-01 : le commit automatique `b6d2a3fc` (conv-892) a modifié `src/main/index.ts`
 * et a été poussé sans aucun test ; `chat-ipc-contract.test.ts`, qui LIT `index.ts` au lieu de
 * l'importer, est resté rouge sur main 20 h. `vitest related index.ts` ne l'aurait pas rejoué.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CES TESTS SI LE CORRECTIF EST FAUX :
 *  - sans la fermeture par citation (`porteeAvantPublication`), le test « lecteur » n'est pas joué
 *    et la modification qui le casse est déclarée verte ;
 *  - avec une portée globale, le rouge PRÉEXISTANT d'un test étranger bloquerait toute publication.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 })

const SAUT = String.fromCharCode(10)
// Forme LONGUE du dossier temporaire : sur la forme courte, `vitest related` ne trouve rien
// (mesuré le 2026-09-03, voir `edit-file-portee.test.ts`).
const RACINE = realpathSync.native(mkdtempSync(join(tmpdir(), 'autowin-pub-verif-')))

function binLePlusProche(depart: string): string | undefined {
  let courant = depart
  for (;;) {
    const candidat = join(courant, 'node_modules', '.bin')
    if (existsSync(candidat)) return candidat
    const parent = dirname(courant)
    if (parent === courant) return undefined
    courant = parent
  }
}

const BIN_REEL = binLePlusProche(process.cwd())
beforeAll(() => {
  if (!BIN_REEL) throw new Error(`node_modules/.bin introuvable depuis ${process.cwd()}`)
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
      /* Windows relâche ses verrous en différé — le ménage n'est pas le verdict */
    }
  }
})

/**
 * Un dépôt à trois tests : `sujet.test.ts` IMPORTE `sujet.ts`, `lecteur.test.ts` le LIT (comme
 * `chat-ipc-contract.test.ts` lit `index.ts`), `etranger.test.ts` est DÉJÀ rouge et sans rapport.
 */
function depot(): string {
  mkdirSync(RACINE, { recursive: true })
  const repo = mkdtempSync(join(RACINE, 'repo-'))
  temporaires.push(repo)
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'depot-pub', scripts: { 'test:unit': 'vitest run' } }),
    'utf8'
  )
  writeFileSync(join(repo, '.gitignore'), ['node_modules/', ''].join(SAUT), 'utf8')
  writeFileSync(join(repo, 'sujet.ts'), `export const valeur = (): number => 1${SAUT}`, 'utf8')
  writeFileSync(
    join(repo, 'sujet.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "import { valeur } from './sujet'",
      "it('rend 1', () => expect(valeur()).toBe(1))",
      ''
    ].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(repo, 'lecteur.test.ts'),
    [
      "import { readFileSync } from 'node:fs'",
      "import { expect, it } from 'vitest'",
      "it('sujet.ts n’exporte qu’un symbole', () => {",
      "  const source = readFileSync(new URL('./sujet.ts', import.meta.url), 'utf8')",
      '  expect(source.match(/export /g)).toHaveLength(1)',
      '})',
      ''
    ].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(repo, 'etranger.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "it('rouge déjà commité, sans rapport', () => expect(1).toBe(2))",
      ''
    ].join(SAUT),
    'utf8'
  )
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 'T')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  return repo
}

const bus = (repo: string): AppCommandBus =>
  new AppCommandBus({ executionWorkspace: repo } as never, () => undefined)

describe('vérification avant publication — le vrai runner, dans un vrai dépôt', () => {
  it('ARRÊTE une modification qui casse un test qui LIT le fichier (cas b6d2a3fc)', async () => {
    const repo = depot()
    // Le test qui IMPORTE reste vert ; seul celui qui LIT le fichier casse.
    writeFileSync(
      join(repo, 'sujet.ts'),
      `export const valeur = (): number => 1${SAUT}export const autre = 2${SAUT}`,
      'utf8'
    )

    const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

    expect(verdict.statut).toBe('echec')
    if (verdict.statut !== 'echec') return
    expect(verdict.testsEnEchec).toEqual(['lecteur.test.ts'])
  })

  it('laisse partir une modification saine, malgré un rouge préexistant SANS rapport', async () => {
    const repo = depot()
    writeFileSync(
      join(repo, 'sujet.ts'),
      `// commentaire${SAUT}export const valeur = (): number => 1${SAUT}`,
      'utf8'
    )

    const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

    expect(verdict).toMatchObject({ statut: 'vert' })
    if (verdict.statut !== 'vert') return
    // `sujet.test.ts` et `lecteur.test.ts` ; jamais `etranger.test.ts`, hors portée.
    expect(verdict.testsJoues).toBe(2)
  })

  it('un texte qu’aucun test ne cite n’est pas vérifiable : il le dit, sans lancer la suite', async () => {
    const repo = depot()
    writeFileSync(join(repo, 'notes.md'), `# notes${SAUT}`, 'utf8')

    const verdict = await bus(repo).verifierAvantPublication(repo, ['notes.md'])

    expect(verdict.statut).toBe('non-verifie')
  })
})
