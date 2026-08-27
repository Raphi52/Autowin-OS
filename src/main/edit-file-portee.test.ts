import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
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

/**
 * Le `.bin` REEL de ce depot, rendu visible au bureau temporaire — le vrai runner, pas un stub.
 *
 * REMONTE les dossiers parents, comme le fait la resolution Node elle-meme. Le chercher uniquement
 * sous `process.cwd()` supposait un `node_modules/.bin` local : un WORKTREE git n'en a pas (il
 * partage celui du depot principal), donc les trois tests de ce fichier y etaient SAUTES et le
 * fichier comptait FAIL — pour une raison d'environnement, celle-la meme que le `.gitignore`
 * ci-dessous existe pour ecarter.
 */
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
  if (!BIN_REEL) {
    throw new Error(`node_modules/.bin introuvable depuis ${process.cwd()} ni dans ses parents`)
  }
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
   *
   * Le test etait de surcroit sensible a la PROFONDEUR du cwd : la meme mise en scene passe depuis
   * le depot principal et echoue depuis un worktree, dont le chemin est 47 caracteres plus long.
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

  it('nomme le MOTIF quand la publication du bureau échoue', async () => {
    const { repo } = depotDejaRouge()
    const wtRoot = mkdtempSync(join(RACINE, 'wt-'))
    temporaires.push(wtRoot)
    const coordinator = new RunWorktreeCoordinator({
      manager: new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot })
    })
    /*
     * Publication FORCEE en echec, avec le motif que la finalisation etablit deja. C'est le seul
     * moyen d'exercer ce chemin : un merge qui echoue vraiment depend de la longueur du chemin de
     * la machine, donc d'un detail d'environnement, pas du contrat qu'on veut verrouiller ici.
     */
    ;(coordinator as unknown as { endAsync: (id: string) => Promise<unknown> }).endAsync = async (
      runId: string
    ) => ({
      outcome: 'blocked',
      agentId: runId,
      files: ['sujet.ts'],
      reason: 'merge-failed',
      detail: "fatal: cannot create directory at 'node_modules/.vite': Filename too long"
    })
    const bus = new AppCommandBus(
      { executionWorkspace: repo, worktrees: coordinator } as never,
      () => undefined
    )

    const result = await bus.exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 1',
        newText: 'export const valeur = (): number => 1 // commentaire sans effet'
      },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: false })
    // Un bureau conserve SANS motif se rediagnostique a chaque fois : il a fallu patcher le produit
    // pour apprendre ce que la finalisation savait deja (2026-08-26).
    const erreur = (result as { error?: string }).error ?? ''
    expect(erreur).toContain('blocked')
    expect(erreur).toContain('merge-failed')
    expect(erreur).toContain('Filename too long')
  }, 180_000)

  /*
   * MESURE DU 2026-08-27, hors modele, dans le depot reel :
   *   npx vitest related README.md --run  ->  EXIT=0, « No test files found, exiting with code 0 »
   *
   * `vitest related` raisonne sur un graphe d'IMPORTS : un `.md`, un `.json`, un dossier non suivi
   * n'y ont aucune place. La commande sort donc a 0 SANS EXECUTER UN SEUL TEST, et `edit_file`
   * publiait sur cette portee vide. Un vert vide est pire qu'une suite lente : il porte le mot
   * « verifie » sans qu'aucun test ait tourne.
   *
   * La garde existait deja — `porteeDerivableDesChangements`, qui exige que TOUT ce qui a change
   * soit du code — mais elle n'etait cablee que sur `runVerifyAt`, jamais sur le chemin `edit_file`.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : rebrancher la portee sur le
   * chemin non-code (ou retirer le filtre) rend `ok: true` avec `verifie: vitest related …` — c'est
   * exactement le faux vert mesure ci-dessus.
   */
  it('ne publie JAMAIS une édition non-code sur une portée vide', async () => {
    const { repo, git } = depotDejaRouge()
    writeFileSync(join(repo, 'notes.md'), '# Notes\n\ntexte initial\n', 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'notes')

    const result = await busSur(repo).exec(
      'edit_file',
      { path: 'notes.md', oldText: 'texte initial', newText: 'texte corrigé' },
      'conv-1'
    )

    // `vitest related notes.md` n'a AUCUN test a jouer : ce verdict ne doit jamais servir de preuve.
    const data = (result.data ?? {}) as { verifie?: string }
    expect(data.verifie ?? '').not.toContain('related')
    // Le depot est deja rouge, donc le repli (suite complete) refuse — et c'est le comportement
    // attendu ici : aucune publication ne peut s'appuyer sur une portee qui n'a rien mesure.
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toContain('texte initial')
  }, 300_000)

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
