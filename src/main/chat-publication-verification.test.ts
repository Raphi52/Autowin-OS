import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConversationFileTrace } from './activity/conversation-file-trace-spool'
import { photographierDebutDeTour, publierTourDeChat } from './chat-turn-publication'
import { AppCommandBus } from './commands'
import { exactLineFingerprint } from './exact-line-fingerprint'
import type { GitRunner } from './run-autoclose'

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
function depot(
  options: { avecInstable?: boolean; avecDejaRouge?: boolean; avecCombine?: boolean } = {}
): string {
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
  if (options.avecInstable) {
    /*
     * ROUGE SOUS CHARGE, VERT SEUL — comme `moteur-perime-cablage.test.ts` le 2026-10-01 dans la
     * portée de `index.ts`. Rendu DÉTERMINISTE par un témoin : rouge au premier passage, vert au
     * suivant. Il cite `sujet.ts`, donc il est dans la portée d'une modification de `sujet.ts`.
     */
    writeFileSync(
      join(repo, 'instable.test.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs'",
        "import { expect, it } from 'vitest'",
        "it('sujet.ts : rouge au premier passage, vert ensuite', () => {",
        "  const temoin = new URL('./.deja-joue', import.meta.url)",
        '  const premier = !existsSync(temoin)',
        "  writeFileSync(temoin, 'x')",
        '  expect(premier).toBe(false)',
        '})',
        ''
      ].join(SAUT),
      'utf8'
    )
  }
  if (options.avecDejaRouge) {
    // Rouge DÉJÀ COMMITÉ, et dans la portée de `sujet.ts` (il l'importe) : aucun tour n'en est l'auteur.
    writeFileSync(
      join(repo, 'ancien-rouge.test.ts'),
      [
        "import { expect, it } from 'vitest'",
        "import { valeur } from './sujet'",
        "it('attend 2 depuis toujours', () => expect(valeur()).toBe(2))",
        ''
      ].join(SAUT),
      'utf8'
    )
  }
  if (options.avecCombine) {
    // Vert au commit. Un AUTRE fil cassera `autre.ts` sans le publier : le rouge ne viendra pas du tour.
    writeFileSync(join(repo, 'autre.ts'), `export const autre = (): number => 2${SAUT}`, 'utf8')
    writeFileSync(
      join(repo, 'combine.test.ts'),
      [
        "import { expect, it } from 'vitest'",
        "import { valeur } from './sujet'",
        "import { autre } from './autre'",
        "it('additionne sujet et autre', () => expect(valeur() + autre()).toBe(3))",
        ''
      ].join(SAUT),
      'utf8'
    )
  }
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

  it('publie quand la seule suite rouge passe SEULE, et le dit (rouge sous charge, vert seul)', async () => {
    const repo = depot({ avecInstable: true })
    writeFileSync(
      join(repo, 'sujet.ts'),
      `// commentaire${SAUT}export const valeur = (): number => 1${SAUT}`,
      'utf8'
    )

    const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

    expect(verdict).toMatchObject({ statut: 'vert', instablesSousCharge: ['instable.test.ts'] })
  })

  it('bloque quand une suite reste rouge, même SEULE, et ne nomme qu’elle', async () => {
    const repo = depot({ avecInstable: true })
    // `lecteur.test.ts` casse VRAIMENT ; `instable.test.ts` est rouge au premier passage seulement.
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

  /*
   * Mesuré le 2026-10-01 (conv-770, tour 532299a4) : 194 tests citaient les fichiers du tour, la
   * commande faisait 9 121 caractères ; par `cmd.exe /c` (limite 8 191) : « La ligne de commande est
   * trop longue », exit 1, aucun rapport, publication bloquée en « tests-rouges ». Ici, 60 tests à
   * chemin long citent `sujet.ts` : environ 9 000 caractères de chemins.
   */
  it.runIf(process.platform === 'win32')(
    'tient sous la limite de cmd.exe quand la portée est longue : la vérification aboutit',
    async () => {
      const repo = depot()
      const dossier = 'un-dossier-de-tests-aux-noms-volontairement-tres-longs-pour-la-limite-cmd'
      mkdirSync(join(repo, dossier))
      const nombre = 60
      for (let i = 0; i < nombre; i++) {
        writeFileSync(
          join(
            repo,
            dossier,
            `cite-sujet-numero-${String(i).padStart(3, '0')}-avec-un-nom-encore-allonge-pour-le-banc.test.ts`
          ),
          [
            "import { expect, it } from 'vitest'",
            "it('cite sujet.ts sans l’importer', () => expect(1).toBe(1))",
            ''
          ].join(SAUT),
          'utf8'
        )
      }
      execFileSync('git', ['add', '-A'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'tests citants'], { cwd: repo })
      writeFileSync(
        join(repo, 'sujet.ts'),
        `// commentaire${SAUT}export const valeur = (): number => 1${SAUT}`,
        'utf8'
      )

      const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

      expect(verdict).toMatchObject({ statut: 'vert' })
      if (verdict.statut !== 'vert') return
      // `sujet.test.ts`, `lecteur.test.ts` et les 60 tests citants : tous joués, aucun perdu.
      expect(verdict.testsJoues).toBe(nombre + 2)
    }
  )

  /*
   * UN ROUGE DÉJÀ PRÉSENT NE BLOQUE PLUS (conv-246, 2026-10-11). Mesuré ce jour-là : plus aucun tour
   * ne publiait depuis 08:40, 84 fichiers en attente, pour 7 suites rouges dont AUCUNE n'était due au
   * tour refusé — 3 déjà rouges sur main, 2 cassées par le travail non publié d'autres fils. Le tour
   * est désormais jugé sur ce qui PART : le dernier commit + ses fichiers, comparé au dernier commit
   * seul, dans une copie propre.
   * Entrées qui feraient échouer ces cas : comparer à l'arbre partagé au lieu du dernier commit (le
   * rouge d'un autre fil y reste), ou imputer au tour tout rouge de la copie (le rouge commité y est).
   */
  it('publie quand le seul rouge était déjà là au dernier commit, et le nomme', async () => {
    const repo = depot({ avecDejaRouge: true })
    writeFileSync(
      join(repo, 'sujet.ts'),
      `// commentaire${SAUT}export const valeur = (): number => 1${SAUT}`,
      'utf8'
    )

    const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

    expect(verdict).toMatchObject({ statut: 'vert', dejaRouges: ['ancien-rouge.test.ts'] })
    // La copie propre ne survit pas à la mesure : ni dossier, ni copie enregistrée dans git.
    const copies = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8'
    })
    expect(copies.match(/^worktree /gm)).toHaveLength(1)
  })

  it('publie quand le rouge vient du travail NON publié d’un autre fil, et le nomme', async () => {
    const repo = depot({ avecCombine: true })
    // L'autre fil : `autre.ts` modifié dans l'arbre partagé, jamais dans la liste du tour.
    writeFileSync(join(repo, 'autre.ts'), `export const autre = (): number => 5${SAUT}`, 'utf8')
    writeFileSync(
      join(repo, 'sujet.ts'),
      `// commentaire${SAUT}export const valeur = (): number => 1${SAUT}`,
      'utf8'
    )

    const verdict = await bus(repo).verifierAvantPublication(repo, ['sujet.ts'])

    expect(verdict).toMatchObject({ statut: 'vert', rougesDAilleurs: ['combine.test.ts'] })
  })

  it('bloque le rouge AJOUTÉ par le tour, sans lui imputer le rouge déjà commité', async () => {
    const repo = depot({ avecDejaRouge: true })
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

  it('un texte qu’aucun test ne cite n’est pas vérifiable : il le dit, sans lancer la suite', async () => {
    const repo = depot()
    writeFileSync(join(repo, 'notes.md'), `# notes${SAUT}`, 'utf8')

    const verdict = await bus(repo).verifierAvantPublication(repo, ['notes.md'])

    expect(verdict.statut).toBe('non-verifie')
  })
})

/**
 * REJEU DE 973b70e2 (conv-1078, relevé par le salvage conv-1091 le 2026-10-22), AVEC LE VRAI RUNNER.
 *
 * Un test de style est parti seul : le CSS qu'il lit était resté en attente, parce qu'un autre fil
 * l'avait modifié avant le tour. Les tests, rejoués dans l'arbre partagé où ce CSS était complet,
 * étaient verts — main a reçu un test rouge. Ici, la vraie publication appelle la vraie vérification :
 * si les tests se rejouent ailleurs que sur ce qui part, le test est publié et ce cas échoue.
 */
describe('vérification avant publication — sur ce qui part, pas sur l’arbre partagé', () => {
  const DEBUT = 1_000_000
  const PENDANT = new Date(DEBUT + 5_000).toISOString()
  const realGit: GitRunner = async (args, cwd) =>
    execFileSync('git', [...args], { cwd, encoding: 'utf8' })
  const trace = (
    repo: string,
    chemin: string,
    lignes: readonly string[]
  ): ConversationFileTrace => ({
    timestamp: PENDANT,
    conversationId: 'conv-A',
    turnId: 'tour-A-0001',
    workspaceRoot: repo,
    source: 'chat_tool',
    paths: [chemin],
    pathLineFingerprints: { [chemin]: lignes.map(exactLineFingerprint) }
  })

  it('ARRÊTE un test publié sans le CSS qu’il lit, resté en attente pour un autre fil (973b70e2)', async () => {
    const repo = depot()
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
    writeFileSync(join(repo, 'theme.css'), `.ancienne { color: red; }${SAUT}`, 'utf8')
    git('add', 'theme.css')
    git('commit', '-q', '-m', 'theme')
    const headAvant = git('rev-parse', 'HEAD')
    // Un autre fil a modifié le CSS avant le tour.
    writeFileSync(
      join(repo, 'theme.css'),
      `.ancienne { color: red; }${SAUT}.autre-fil { color: blue; }${SAUT}`,
      'utf8'
    )
    const debut = await photographierDebutDeTour(repo, realGit, DEBUT)
    // Le tour ajoute sa règle au CSS et le test qui la lit.
    const regle = '.nouvelle { color: gold; }'
    writeFileSync(
      join(repo, 'theme.css'),
      `.ancienne { color: red; }${SAUT}.autre-fil { color: blue; }${SAUT}${regle}${SAUT}`,
      'utf8'
    )
    const test = [
      "import { readFileSync } from 'node:fs'",
      "import { expect, it } from 'vitest'",
      "it('le thème porte la règle .nouvelle', () => {",
      "  const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')",
      "  expect(css).toContain('.nouvelle')",
      '})'
    ]
    writeFileSync(join(repo, 'theme.test.ts'), [...test, ''].join(SAUT), 'utf8')
    // Dans l'arbre partagé, le test est vert : c'est ce qui faisait partir le test seul.
    const partage = await bus(repo).verifierAvantPublication(repo, ['theme.test.ts'])
    expect(partage.statut).toBe('vert')

    const report = await publierTourDeChat({
      conversationId: 'conv-A',
      turnId: 'tour-A-0001',
      request: 'ajoute la règle .nouvelle et son test',
      debut,
      runGit: realGit,
      traces: [trace(repo, 'theme.test.ts', test), trace(repo, 'theme.css', [regle])],
      verifierAvantPublication: (racine, fichiers) =>
        bus(repo).verifierAvantPublication(racine, fichiers)
    })

    expect(report).toMatchObject({
      project: { status: 'skipped', reason: 'tests-rouges' },
      verification: { statut: 'echec', testsEnEchec: ['theme.test.ts'] }
    })
    expect(report?.exclus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'theme.css', motif: 'modifie-avant-le-tour' }),
        expect.objectContaining({ path: 'theme.test.ts', motif: 'tests-rouges' })
      ])
    )
    expect(git('rev-parse', 'HEAD')).toBe(headAvant)
    expect(git('status', '--porcelain', '-uall')).toContain('theme.test.ts')
    // Les copies de vérification sont refermées : seul le dépôt reste inscrit.
    expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1)
  })
})
