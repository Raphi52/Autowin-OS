import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
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
/** CRLF litteral — un fichier herite Windows le porte, et il doit survivre intact. */
const CRLF = String.fromCharCode(13, 10)

/*
 * LA RACINE DES FIXTURES VIT HORS DU DEPOT MESURE.
 *
 * Elle etait sous `process.cwd()`, donc les depots jetables et leurs bureaux isoles se creaient DANS
 * le depot que la suite mesure — collecte, watchers et menage s'y melangeaient.
 */
/*
 * LE CHEMIN EST RESOLU EN FORME LONGUE — sinon `vitest related` ne trouve JAMAIS rien ici.
 *
 * MESURE du 2026-09-03, dans ce depot : `os.tmpdir()` rend `C:\Users\EMMANU~1.HEU\...` (forme 8.3
 * heritee de MS-DOS). Le bureau isole herite de ce chemin court, vitest resout la cible dessus,
 * mais son graphe de modules est indexe sur le chemin REEL (`C:\Users\Emmanuel.heurtier\...`) : les
 * deux ne se ressemblent pas, donc `vitest related <fichier> --run` rend « No test files found,
 * exiting with code 0 ». Le produit bascule alors sur la suite complete — comportement voulu, mais
 * qui rend AVEUGLE tout test cense prouver le ciblage : il passe quoi qu'on sabote.
 *
 * C'est probablement aussi ce que les commentaires de ce fichier appellent depuis le 2026-08-27
 * une « intermittence de collecte » : elle depend de la machine, pas du hasard.
 */
const RACINE = realpathSync.native(mkdtempSync(join(tmpdir(), 'autowin-portee-')))

/*
 * CHAQUE TEST A SA PROPRE CONVERSATION — cause NOMMEE de la non-determinance mesuree.
 *
 * Un juge externe a mesure la suite FLAKY : un run a 5 echecs / 2 passes, puis cinq runs a 7/7, avec
 * le md5 des fichiers de production verifie IDENTIQUE avant chaque lancement. Les sept tests
 * employaient le meme `conversationId` ('conv-1') et la meme cible ('sujet.ts') — or le produit
 * REUTILISE les bureaux par (conversation, cible) : deux tests concurrents se partageaient donc le
 * MEME bureau isole. Un identifiant distinct par test supprime ce partage.
 */
let numeroDeConversation = 0
const conversationUnique = (): string => `conv-portee-${(numeroDeConversation += 1)}`

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

/**
 * LE MEME DEPOT, PLUS UNE FEUILLE DE STYLE ET SES DEUX FACONS D'ETRE TESTEE.
 *
 * C'est la mise en scene exacte mesuree dans ce depot le 2026-09-03 :
 *   - `composant.test.ts` IMPORTE le style (par `composant.ts`) -> `vitest related style.css` le voit ;
 *   - `style-lisible.test.ts` LIT le style avec `readFileSync` -> il est INVISIBLE pour le graphe
 *     d'imports, et c'est pourtant lui qui juge la couleur.
 * Les deux ensemble sont le point : une portee qui ne retient que le premier rend un vert qui n'a
 * jamais regarde ce que l'edition a change.
 */
function depotAvecStyle(): { repo: string; git: (...a: string[]) => string } {
  const { repo, git } = depotDejaRouge()
  writeFileSync(
    join(repo, 'style.css'),
    ':root {' + SAUT + '  --fond: #000000;' + SAUT + '}' + SAUT,
    'utf8'
  )
  writeFileSync(
    join(repo, 'composant.ts'),
    ["import './style.css'", 'export const composant = (): string => "fond"', ''].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(repo, 'composant.test.ts'),
    [
      "import { expect, it } from 'vitest'",
      "import { composant } from './composant'",
      "it('rend le nom du fond', () => expect(composant()).toBe('fond'))",
      ''
    ].join(SAUT),
    'utf8'
  )
  writeFileSync(
    join(repo, 'style-lisible.test.ts'),
    [
      "import { readFileSync } from 'node:fs'",
      "import { expect, it } from 'vitest'",
      "it('garde un fond sombre', () => {",
      "  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')",
      "  expect(css).toContain('#000000')",
      '})',
      ''
    ].join(SAUT),
    'utf8'
  )
  git('add', '-A')
  git('commit', '-q', '-m', 'feuille de style, testee par import ET par lecture')
  return { repo, git }
}

/**
 * COMPTE LES RAPPORTS DE VERDICT LAISSES DANS LE DOSSIER TEMPORAIRE.
 *
 * MECANISME QUE LE PANEL A SABOTE SANS FAIRE ROUGIR UN SEUL TEST : neutraliser la suppression du
 * rapport laissait les 7 tests verts, et le juge a MESURE 2 fichiers accumules apres un seul appel.
 * Chaque rapport porte le detail complet des echecs du depot, dans un dossier partage : c'est une
 * accumulation illimitee doublee d'une fuite d'information.
 */
function rapportsResiduels(): number {
  try {
    return readdirSync(tmpdir()).filter((nom) => nom.startsWith('autowin-verdict-')).length
  } catch {
    return 0
  }
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

/**
 * COMPTE LES BASELINES REELLEMENT MESUREES par un bus.
 *
 * PREMIERE VERSION : elle comptait les EXECUTIONS de vérification et exigeait `1` sur le chemin vert.
 * La REPETITION l'a refutee — `expected 3 to be 1`, 1 run sur 15, code md5-identique : quand
 * `vitest related` collecte 0 test (intermittence mesuree), le repli rejoue en suite complete, celle-ci
 * est rouge a cause du bruit preexistant du fixture, une baseline est alors LEGITIME, et l'edition est
 * publiee correctement — avec 3 executions. L'assertion etait donc plus rigide que l'invariant.
 *
 * L'INVARIANT REEL est : une verification VERTE ne mesure AUCUNE baseline. On compte donc les
 * baselines, pas les executions. Le sabotage discriminant reste le meme (baseline systematique : 0 -> 1).
 */
function compteurDeBaselines(bus: AppCommandBus): () => number {
  const interne = bus as unknown as {
    baselineAvantEdition: (...args: unknown[]) => Promise<unknown>
  }
  const vraie = interne.baselineAvantEdition.bind(interne)
  let appels = 0
  interne.baselineAvantEdition = async (...args: unknown[]) => {
    appels += 1
    return await vraie(...args)
  }
  return () => appels
}

describe('edit_file — le verdict juge l’ÉDITION, pas l’état général du dépôt', () => {
  /*
   * CE TEST NE CONCLUT QUE SUR LA VOIE QU'IL VISE : la portee CIBLEE.
   *
   * DEFAUT MESURE le 2026-09-02 (conv-131), 1 echec sur 1104 fichiers en suite complete, 5 verts
   * hors charge : `expect(baselines()).toBe(0)` a recu 1. Ce n'etait NI un bug du produit NI une
   * assertion trop stricte. Sous charge, `vitest related` collecte 0 test par intermittence ; le
   * produit BASCULE alors sur la suite complete (comportement voulu, teste plus bas), celle-ci est
   * rouge a cause du test etranger du fixture, et une baseline devient LEGITIME. Sur cette voie,
   * l'invariant « un vert ne mesure aucune baseline » ne s'applique plus, et le sabotage vise
   * (baseline systematique) ne serait meme plus discriminant : le test ne mesure plus rien.
   *
   * On ne desserre donc RIEN — l'assertion reste `toBe(0)`. On refait la mesure tant que le hasard
   * de collecte nous met sur l'autre voie, et une bascule SYSTEMATIQUE fait echouer : elle ne serait
   * plus une intermittence, mais un vrai defaut de derivation de portee.
   */
  it('publie une édition saine alors qu’un test SANS RAPPORT est déjà rouge', async () => {
    const TENTATIVES = 3
    let bascules = 0

    for (let essai = 1; essai <= TENTATIVES; essai += 1) {
      const { repo, git } = depotDejaRouge()

      const bus = busSur(repo)
      const baselines = compteurDeBaselines(bus)

      const result = await bus.exec(
        'edit_file',
        {
          path: 'sujet.ts',
          oldText: 'export const valeur = (): number => 1',
          newText: 'export const valeur = (): number => 1 // commentaire sans effet'
        },
        conversationUnique()
      )

      // L'edition est publiee sur les DEUX voies : c'est le coeur du correctif, il se verifie ici.
      expect(result).toMatchObject({ ok: true })
      expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('commentaire sans effet')
      // Le rouge préexistant n’a pas été « réparé » au passage : il est resté INTACT.
      expect(readFileSync(join(repo, 'etranger.test.ts'), 'utf8')).toContain('toBe(2)')
      expect(git('status', '--porcelain')).toBe('')

      const data = result.data as { verifie?: string; portee?: string }
      if (!data.verifie?.includes('vitest related')) {
        // Collecte vide -> le produit a remesure plus large. Cette voie ne prouve pas l'invariant.
        bascules += 1
        continue
      }

      /*
       * LE CHEMIN VERT NE MESURE AUCUNE BASELINE — prouve par le COMPTEUR, pas par l'absence d'un
       * texte. Sabotage qui doit rougir : sortir l'appel de baseline du `if (!verification.ok)` dans
       * `withIsolatedMutation` (l'option « baseline systematique », ecartee pour son cout).
       */
      expect(baselines()).toBe(0)
      // Le verdict NOMME sa portée : un vert dont on ignore l’étendue se lit plus large qu’il n’est.
      expect(data.portee).toContain('importent')
      return
    }

    throw new Error(
      `la portee ciblee a bascule sur la suite complete ${bascules} fois sur ${TENTATIVES} : ` +
        "ce n'est plus une intermittence de collecte, la derivation de portee est en cause"
    )
  }, 300_000)

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
      conversationUnique()
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
      conversationUnique()
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
      conversationUnique()
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
    const residusAvant = rapportsResiduels()
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

    const bus = busSur(repo)
    const baselines = compteurDeBaselines(bus)
    const result = await bus.exec(
      'edit_file',
      {
        path: 'sujet.ts',
        oldText: 'export const valeur = (): number => 1',
        newText: 'export const valeur = (): number => 1 // commentaire sans effet'
      },
      conversationUnique()
    )

    expect((result as { error?: string }).error ?? 'pas d’erreur').toBe('pas d’erreur')
    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('commentaire sans effet')
    const data = result.data as { differentiel?: string }
    // Le rouge ecarte est NOMME, avec sa raison — c'est l'identite que compare le differentiel.
    expect(data.differentiel ?? '').toContain('rouge preexistant DANS la portee')
    // La mesure de baseline a RESTAURE l'edition : elle ne publie pas son propre etat d'avant.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).not.toContain(`=> 1${SAUT}`)
    expect(readFileSync(join(repo, 'sujet-deja-rouge.test.ts'), 'utf8')).toContain('toBe(99)')
    expect(git('status', '--porcelain')).toBe('')
    /*
     * DEUX MESURES ONT EU LIEU (une pour l'edition, une pour la baseline), donc DEUX rapports ont
     * ete ecrits — et il ne doit en rester AUCUN. Sabotage qui doit rougir : neutraliser le `rmSync`
     * du `finally` de `mesurerAvecRapport`.
     */
    expect(rapportsResiduels()).toBe(residusAvant)
    // Le chemin ROUGE mesure exactement UNE baseline — ni zero (sinon rien n'est ecarte), ni deux.
    expect(baselines()).toBe(1)
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
      conversationUnique()
    )

    // Meme test, meme nom, mais « expected 42 to be 1 » n'est pas « expected 7 to be 1 ».
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('=> 7')
  }, 300_000)

  /*
   * LE FAUX VERT LE PLUS RENTABLE A FERMER, mesure hors modele le 2026-08-27 :
   *   npx vitest related <fichier de code sans test associe> --run
   *   -> EXIT=0, success: true, numTotalTests: 0
   *
   * Toute edition d'un fichier de code qu'AUCUN test n'exerce etait donc publiee sous l'etiquette
   * « verifie ». B' n'avait ferme que le cas des fichiers NON-CODE : un `.ts` passe la garde de
   * portee derivable, et `vitest related` sur lui ne collecte rien.
   *
   * C'est aussi le PREMIER MAILLON d'une chaine prouvee par un juge en deux appels : editer la
   * CONFIGURATION de vitest (un `.ts`, donc accepte) pour neutraliser la verification, puis publier
   * n'importe quelle regression sous un exit 0. Refuser un vert sans test joue coupe la chaine a son
   * premier maillon, sans avoir a interdire l'edition de la configuration.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : rendre `publiable: true` sur tout `apresEstVert`.
   */
  /*
   * PORTEE VIDE : ON REMESURE PLUS LARGE, ON NE REFUSE PAS.
   *
   * Mesure hors modele : `vitest related <fichier de code sans test associe> --run` rend EXIT 0 avec
   * `numTotalTests: 0`. Une premiere version de ce correctif REFUSAIT dans ce cas — et la repetition
   * a montre que c'etait un FAUX refus : `related` collecte parfois 0 test sur un fichier pourtant
   * couvert (2 rouges sur 12, code md5-identique). Le refus mordait donc au hasard.
   *
   * Le comportement juste suit la doctrine du module : une portee qui n'a rien mesure CEDE la place a
   * la suite complete. Ici la suite complete joue 5 tests, aucun casse par l'edition : la mesure est
   * REELLE, donc la publication est fondee. Ce qui est verrouille : la preuve ne vient jamais d'une
   * portee vide, et la voie de la baseline est la MEME que celle de la mesure.
   */
  it('remesure en suite COMPLÈTE quand la portée ne joue aucun test, puis publie sur cette preuve', async () => {
    const { repo, git } = depotDejaRouge()
    writeFileSync(join(repo, 'orphelin.ts'), 'export const orphelin = (): number => 1' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'fichier de code sans test associe')

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'orphelin.ts',
        oldText: 'export const orphelin = (): number => 1',
        newText: 'export const orphelin = (): number => 42'
      },
      conversationUnique()
    )

    expect((result as { error?: string }).error ?? 'pas d’erreur').toBe('pas d’erreur')
    const data = result.data as { verifie?: string; testsJoues?: number; differentiel?: string }
    // La preuve vient de la SUITE COMPLETE, jamais de la portee vide.
    expect(data.verifie).toBe('npm run test:unit')
    expect(data.testsJoues ?? 0).toBeGreaterThan(0)
    expect(data.differentiel ?? '').toContain('rouge deja committe, sans rapport')
  }, 300_000)

  /*
   * LE VRAI VECTEUR, celui qu'un juge a prouve en deux appels : neutraliser la verification puis
   * publier n'importe quoi. Ici le depot ne peut RIEN prouver — sa suite ne contient aucun test —
   * donc meme le repli global joue 0 test. C'est le seul cas ou « 0 test joue » est un fait etabli,
   * et il doit REFUSER.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : rendre `publiable: true` sur tout `apresEstVert`.
   */
  it('REFUSE quand même la suite COMPLÈTE ne joue aucun test — vérification neutralisée', async () => {
    const { repo, git } = depotDejaRouge()
    /*
     * ON REPRODUIT LE VECTEUR, pas une approximation : le juge a prouve une chaine en deux appels ou
     * le PREMIER edite la configuration de la verification pour la neutraliser. Ici le script de test
     * est neutralise (`--passWithNoTests`) et les fichiers de test retires : la commande sort a 0 en
     * n'ayant joue AUCUN test. C'est le seul cas ou « 0 test joue » est un fait etabli — et le seul
     * ou refuser est fonde.
     */
    rmSync(join(repo, 'sujet.test.ts'))
    rmSync(join(repo, 'etranger.test.ts'))
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'depot-neutralise', scripts: { 'test:unit': 'vitest run --passWithNoTests' } }),
      'utf8'
    )
    writeFileSync(join(repo, 'orphelin.ts'), 'export const orphelin = (): number => 1' + SAUT, 'utf8')
    git('add', '-A')
    git('commit', '-q', '-m', 'depot sans aucun test')

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'orphelin.ts',
        oldText: 'export const orphelin = (): number => 1',
        newText: 'export const orphelin = (): number => 42'
      },
      conversationUnique()
    )

    expect(result).toMatchObject({ ok: false })
    expect((result as { error?: string }).error ?? '').toContain('aucun test')
    expect(readFileSync(join(repo, 'orphelin.ts'), 'utf8')).toContain('=> 1')
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
      conversationUnique()
    )

    expect(result).toMatchObject({ ok: false })
    // La base reste INTACTE : rien de rouge n’est publié, la garantie n’est pas seulement assouplie.
    expect(readFileSync(join(repo, 'sujet.ts'), 'utf8')).toContain('=> 1\n')
    expect(existsSync(join(repo, 'sujet.ts'))).toBe(true)
  }, 180_000)

  /*
   * DEFAUT PREEXISTANT MESURE le 2026-08-27 sur les octets reels : `readFileSync(p).toString('utf8')`
   * ne jette PAS sur une entree invalide, Node substitue U+FFFD. Un fichier cp1252 edite via
   * `edit_file` ressortait donc avec chaque octet accentue remplace par `ef bf bd` — TRES LOIN de la
   * zone editee — et le bureau isole publiait la corruption dans le depot.
   *   avant : ...63756c **e9** 20766965757820...   apres : ...63756c **efbfbd** 2076696575...
   *
   * ENTREE QUI FAIT ECHOUER CE TEST SI LA GARDE EST FAUSSE : ce meme fichier cp1252, dont la zone
   * editee est pourtant PUREMENT ASCII — l'edition « reussissait » et detruisait le reste.
   */
  /*
   * DEFAUT VECU le 2026-09-03 (conv-21) : une correction de couleur dans `ChatView.css` faisait
   * rejouer la SUITE ENTIERE — donc plafond de temps, donc edition refusee sans aucun verdict. La
   * derivation de portee existait, mais `EXTENSIONS_DE_CODE` excluait les feuilles de style : plus
   * rien a cibler, repli global, chronometre. Mesure hors modele du meme jour, dans ce depot :
   *   npx vitest related src/renderer/src/components/ChatView.css --run -> 89 fichiers, 401 tests, 38 s.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : laisser la feuille de style
   * hors des extensions derivables. `verifie` redevient alors `npm run test:unit`, c'est-a-dire la
   * suite entiere — exactement ce que l'utilisateur a paye en attente.
   */
  it('CIBLE une édition de feuille de style au lieu de rejouer toute la suite', async () => {
    const { repo } = depotAvecStyle()

    const result = await busSur(repo).exec(
      'edit_file',
      {
        path: 'style.css',
        oldText: ':root {',
        newText: '/* commentaire sans effet */' + SAUT + ':root {'
      },
      conversationUnique()
    )

    expect((result as { error?: string }).error ?? 'pas d’erreur').toBe('pas d’erreur')
    expect(result).toMatchObject({ ok: true })
    const data = (result.data ?? {}) as { verifie?: string; portee?: string; testsJoues?: number }
    // La preuve vient d'une portee CIBLEE, jamais de la suite complete.
    expect(data.verifie ?? '').toContain('vitest related')
    expect(data.verifie ?? '').not.toContain('npm run test:unit')
    /*
     * ET LA PORTEE COUVRE CE QUI JUGE VRAIMENT LE STYLE. Mesure du 2026-09-03 : les tests qui jugent
     * le CSS ne l'IMPORTENT pas, ils le LISENT — `ChatView.style.test.ts`, `ui-system.test.ts`,
     * `spinner-partout.test.ts` etaient tous ABSENTS de `vitest related ChatView.css`. Sans cette
     * assertion, la version « on ajoute .css aux extensions de code » passerait, et publierait vert.
     */
    expect(data.verifie ?? '').toContain('style-lisible.test.ts')
    expect(data.portee ?? '').toContain('nomment')
    expect(data.testsJoues ?? 0).toBeGreaterThan(0)
    // Le rouge preexistant HORS portee n'a pas ete rejoue, et il est reste intact.
    expect(readFileSync(join(repo, 'etranger.test.ts'), 'utf8')).toContain('toBe(2)')
  }, 300_000)

  /*
   * LE FAUX VERT QUE LA VOIE RAPIDE FABRIQUERAIT. Ici l'edition de style casse un test qui LIT la
   * feuille sans l'importer : il est hors du graphe d'imports, donc invisible pour `vitest related`
   * seul. Le fixture contient AUSSI un test qui, lui, importe le style : la portee n'est donc pas
   * vide, le repli « 0 test joue -> suite complete » ne se declenche pas, et rien ne rattrape la
   * regression a part une portee correctement elargie.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : ajouter `.css` aux
   * extensions de code sans chercher les tests qui NOMMENT la feuille. `#ffffff` est alors publie.
   */
  it('REFUSE une édition de style qui casse un test lisant la feuille sans l’importer', async () => {
    const { repo, git } = depotAvecStyle()

    const result = await busSur(repo).exec(
      'edit_file',
      { path: 'style.css', oldText: '#000000', newText: '#ffffff' },
      conversationUnique()
    )

    expect(result).toMatchObject({ ok: false })
    // La base reste INTACTE : la regression de couleur n'a pas ete publiee.
    expect(readFileSync(join(repo, 'style.css'), 'utf8')).toContain('#000000')
    expect(git('status', '--porcelain')).toBe('')
  }, 300_000)

  it('refuse une édition sur un fichier non UTF-8, sans toucher un seul octet', async () => {
    const { repo, git } = depotDejaRouge()
    // `é` = 0xE9 en cp1252 : un octet qu'aucune lecture utf8 ne sait rendre.
    const octetsLegacy = Buffer.concat([
      Buffer.from('// calcul', 'latin1'),
      Buffer.from([0xe9]),
      // CRLF sans sequence d'echappement, comme le reste de ce fichier (cf. `SAUT`).
      Buffer.from(' vieux fichier' + CRLF + 'export const legacy = (): number => 1' + CRLF, 'latin1')
    ])
    writeFileSync(join(repo, 'legacy.ts'), octetsLegacy)
    git('add', '-A')
    git('commit', '-q', '-m', 'fichier hérité en cp1252')

    const result = await busSur(repo).exec(
      'edit_file',
      {
        // La zone visée est ASCII : rien dans la DEMANDE ne signale l'encodage du fichier.
        path: 'legacy.ts',
        oldText: 'export const legacy = (): number => 1',
        newText: 'export const legacy = (): number => 42'
      },
      conversationUnique()
    )

    /*
     * Un refus de `decideEdit` remonte dans l'ENVELOPPE (`ok: true`, `data.allowed: false`) : c'est
     * une reponse rendue au modele, pas une panne de la commande. Seule la verification jette.
     */
    const refus = (result.data ?? {}) as { allowed?: boolean; reason?: string }
    expect(refus.allowed).toBe(false)
    // Le refus NOMME sa raison — il enseigne, comme les autres refus de cette commande.
    expect(refus.reason ?? '').toContain('non UTF-8')
    // Identite d'OCTETS : c'est la propriete detruite par le defaut, pas « le fichier existe ».
    expect(readFileSync(join(repo, 'legacy.ts')).equals(octetsLegacy)).toBe(true)
    expect(git('status', '--porcelain')).toBe('')
  }, 180_000)
})
