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

/**
 * COMPTE LES EXECUTIONS REELLES DE VERIFICATION d'un bus.
 *
 * La v1 pretendait prouver « le chemin vert ne mesure aucune baseline » avec
 * `expect(data.differentiel).toBeUndefined()`. Un juge externe a montre que cette assertion ne
 * discrimine RIEN : la note est aussi absente sur un rouge non concluant, et le sabotage evident
 * (sortir l'appel de baseline du `if (!verification.ok)`) laissait le test VERT. Ce compteur est la
 * preuve promise : il compte les lancements du runner, pas la presence d'un texte.
 */
function compteurDExecutions(bus: AppCommandBus): () => number {
  const interne = bus as unknown as {
    mesurerAvecRapport: (...args: unknown[]) => Promise<unknown>
  }
  const vraie = interne.mesurerAvecRapport.bind(interne)
  let appels = 0
  interne.mesurerAvecRapport = async (...args: unknown[]) => {
    appels += 1
    return await vraie(...args)
  }
  return () => appels
}

describe('edit_file — le verdict juge l’ÉDITION, pas l’état général du dépôt', () => {
  it('publie une édition saine alors qu’un test SANS RAPPORT est déjà rouge', async () => {
    const { repo, git } = depotDejaRouge()

    const bus = busSur(repo)
    const executions = compteurDExecutions(bus)

    const result = await bus.exec(
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
    /*
     * LE CHEMIN VERT NE MESURE AUCUNE BASELINE — prouve par le COMPTEUR, pas par l'absence d'un
     * texte. Sabotage qui doit rougir : sortir l'appel de baseline du `if (!verification.ok)` dans
     * `withIsolatedMutation` (l'option « baseline systematique », ecartee pour son cout).
     */
    expect(executions()).toBe(1)
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

    /*
     * L'INVARIANT, rendu POSITIF et autoporteur. Un juge a note que la forme precedente
     * (`not.toContain` sur un champ optionnel) est vraie a vide, donc ne mord que par accident.
     * Ici on EXIGE la commande jouee : la suite complete, jamais une portee vide.
     */
    expect(result).toMatchObject({ ok: true })
    const data = (result.data ?? {}) as { verifie?: string; differentiel?: string }
    expect(data.verifie).toBe('npm run test:unit')
    // Le rouge preexistant est ECARTE parce qu'il est identique avant/apres, et il est NOMME.
    expect(data.differentiel ?? '').toContain('rouge deja committe, sans rapport')
    expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toContain('texte corrigé')
  }, 300_000)

  /*
   * LE REFUS SUR LA VOIE DE REPLI GLOBAL — trou de couverture nomme par un juge : tous les tests
   * d'integration de la v1 attendaient une PUBLICATION sur cette voie, et le seul qui exigeait un
   * refus passait par `vitest related`. Si la baseline mesurait en fait l'etat APRES (ecriture sans
   * effet, commande jamais egale, exception avalee), `avant === apres` et TOUT rouge serait publie
   * sur toute edition non-code — la suite entiere resterait verte.
   *
   * Ici l'edition non-code CASSE reellement la suite : le script de test est remplace par un runner
   * qui echoue toujours. Le differentiel ne peut pas conclure (aucun rapport JSON exploitable), donc
   * il REFUSE.
   */
  it('REFUSE une édition non-code qui casse la suite, sur la voie de repli global', async () => {
    const { repo, git } = depotDejaRouge()
    writeFileSync(join(repo, 'notes.md'), '# Notes' + SAUT + SAUT + 'texte initial' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'notes')

    const result = await busSur(repo).exec(
      'edit_file',
      { path: 'package.json', oldText: '"vitest run"', newText: '"node -e process.exit(3)"' },
      'conv-1'
    )

    expect(result).toMatchObject({ ok: false })
    // La base reste INTACTE : le script d'origine n'a pas ete publie casse.
    expect(readFileSync(join(repo, 'package.json'), 'utf8')).toContain('"vitest run"')
  }, 300_000)

  /*
   * LE VETO QUI MORDAIT REELLEMENT `edit_file` : un rouge PREEXISTANT a l'INTERIEUR de la portee.
   * L'immunite « par construction » de `vitest related` ne couvre que les rouges HORS graphe
   * d'imports ; un test deja rouge qui IMPORTE le fichier edite est rejoue, et son rouge faisait
   * jeter une edition saine. C'est ce blocage que le pilote contournait via `orchestrate`.
   */
  it('publie une édition saine malgré un rouge préexistant DANS sa portée', async () => {
    const { repo, git } = depotDejaRouge()
    writeFileSync(
      join(repo, 'sujet-deja-rouge.test.ts'),
      [
        "import { expect, it } from 'vitest'",
        "import { valeur } from './sujet'",
        "it('rouge preexistant DANS la portee', () => expect(valeur()).toBe(99))",
        ''
      ].join(SAUT),
      'utf8'
    )
    git('add', '-A')
    git('commit', '-q', '-m', 'rouge preexistant dans la portee')

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
    const data = result.data as { differentiel?: string }
    // Le rouge ecarte est NOMME, avec sa raison — c'est l'identite que compare le differentiel.
    expect(data.differentiel ?? '').toContain('rouge preexistant DANS la portee')
    // La mesure de baseline a RESTAURE l'edition : elle ne publie pas son propre etat d'avant.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).not.toContain(`=> 1${SAUT}`)
    expect(readFileSync(join(repo, 'sujet-deja-rouge.test.ts'), 'utf8')).toContain('toBe(99)')
    expect(git('status', '--porcelain')).toBe('')
  }, 300_000)

  /*
   * DEFAUT N°5 DE LA V1, en integration : le NOM d'un test ne porte pas la RAISON de son echec. Un
   * test deja rouge pour une cause A, qui echoue APRES pour la regression, avait un nom identique
   * donc etait classe « preexistant » et la regression etait PUBLIEE (contre-exemple execute par un
   * juge). Ici le test deja rouge assere DEUX choses : une egalite fausse d'origine, puis le contrat
   * que l'edition casse. L'identite (nom + raison) doit voir la difference.
   */
  it('REFUSE quand un test déjà rouge échoue pour une RAISON NOUVELLE', async () => {
    const { repo, git } = depotDejaRouge()
    writeFileSync(
      join(repo, 'sujet.test.ts'),
      [
        "import { expect, it } from 'vitest'",
        "import { valeur } from './sujet'",
        "it('contrat de valeur', () => {",
        '  expect(valeur()).toBe(1)',
        '})',
        ''
      ].join(SAUT),
      'utf8'
    )
    // Rouge PREEXISTANT sur ce meme test, pour une cause qui n'a rien a voir avec l'edition.
    writeFileSync(join(repo, 'sujet.ts'), 'export const valeur = (): number => 7' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'sujet deja rouge sur son propre contrat')

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 7',
        newText: 'export const valeur = (): number => 42'
      },
      'conv-1'
    )

    // Meme test, meme nom, mais « expected 42 to be 1 » n'est pas « expected 7 to be 1 ».
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('=> 7')
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
