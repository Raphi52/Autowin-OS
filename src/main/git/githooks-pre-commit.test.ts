import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * `.githooks/pre-commit` — REFUS d'un commit qui supprime un module encore importé par le commit.
 *
 * Rejeu de l'incident du 2026-10-17 (commit 06c5ede1) : l'index de l'arbre partagé portait
 * la suppression stagée de `conversation-router.ts`, l'importeur n'était
 * modifié que dans l'arbre de travail, et un `git add <autres fichiers> && git commit` a emporté la
 * suppression seule. Ces tests commitent VRAIMENT, à travers git et le hook du dépôt
 * (`core.hooksPath`), dans des dépôts jetables.
 */

const HOOKS = resolve(__dirname, '../../../.githooks')

const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function envPropre(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k]
  return env
}

function depot(sousDossier?: string): {
  git: (...args: string[]) => ReturnType<typeof spawnSync>
  ecrire: (f: string, t: string) => void
  racine: string
} {
  const parent = mkdtempSync(join(tmpdir(), 'garde-commit-'))
  dossiers.push(parent)
  const racine = sousDossier ? join(parent, sousDossier) : parent
  mkdirSync(racine, { recursive: true })
  const git = (...args: string[]): ReturnType<typeof spawnSync> =>
    spawnSync('git', args, { cwd: racine, encoding: 'utf8', env: envPropre() })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@exemple.invalid')
  git('config', 'user.name', 'test')
  git('config', 'core.hooksPath', HOOKS)
  git('config', 'core.autocrlf', 'false')
  const ecrire = (f: string, t: string): void => {
    mkdirSync(join(racine, f, '..'), { recursive: true })
    writeFileSync(join(racine, f), t)
  }
  ecrire('src/main/routeur.ts', 'export const routeur = 1\n')
  ecrire('src/main/index.ts', "import { routeur } from './routeur'\nexport const x = routeur\n")
  ecrire('src/main/autre.ts', 'export const autre = 2\n')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'base')
  return { git, ecrire, racine }
}

describe('.githooks/pre-commit : module supprimé encore importé', () => {
  it('REFUSE le commit qui emporte une suppression stagée sans son importeur (rejeu de 06c5ede1)', () => {
    const { git, ecrire } = depot()
    // Une autre session : suppression stagée, importeur modifié dans l'arbre de travail seulement.
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    // L'agent : ajoute SON fichier puis commite tout l'index.
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-m', 'kaizen')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/src\/main\/routeur\.ts supprimé, mais src\/main\/index\.ts:1/)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('laisse passer le même travail commité par chemins nommés', () => {
    const { git, ecrire } = depot()
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    const r = git('commit', '-q', '-m', 'kaizen', '--', 'src/main/autre.ts')
    expect(r.status, String(r.stderr)).toBe(0)
    expect(String(git('diff', '--cached', '--name-status').stdout)).toMatch(
      /^D\tsrc\/main\/routeur\.ts/m
    )
  })

  it('laisse passer la suppression commitée AVEC son importeur', () => {
    const { git, ecrire } = depot()
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    git('add', 'src/main/index.ts')
    const r = git('commit', '-q', '-m', 'retrait du routeur')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne confond pas un simple homonyme : un autre module du même nom ailleurs n'est pas visé", () => {
    const { git, ecrire } = depot()
    ecrire('src/autre-dossier/routeur.ts', 'export const r = 1\n')
    ecrire('src/autre-dossier/usage.ts', "import { r } from './routeur'\nexport const u = r\n")
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'homonyme')
    git('rm', '-q', 'src/main/routeur.ts')
    ecrire('src/main/index.ts', 'export const x = 0\n')
    git('add', 'src/main/index.ts')
    const r = git('commit', '-q', '-m', 'retrait')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans une copie de travail d'agent (son index n'est pas partagé)", () => {
    const { git } = depot('agent__run-x-1')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'agent')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  /*
   * L'ancien rangement des copies de fil (2026-11-05) : `retours-de-tour/essai__<fil>-<instant>-<rang>`,
   * avec son propre index, comme une copie d'agent. Le hook ne les reconnaissait pas.
   */
  it("ne s'applique pas dans une ancienne copie de fil essai__… (son index n'est pas partagé)", () => {
    const { git } = depot('retours-de-tour/essai__conv-1471-1793778602628-1')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'ancienne copie')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans la copie de travail d'un fil (`copies-de-fil/<fil>`)", () => {
    const { git } = depot('copies-de-fil/conv-1710')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-q', '-m', 'travail du fil')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it('reste actif dans un dépôt dont le nom contient « essai__ » sans commencer par lui', () => {
    const { git } = depot('mon-essai__depot')
    git('rm', '-q', 'src/main/routeur.ts')
    const r = git('commit', '-m', 'retrait')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/src\/main\/routeur\.ts supprimé/)
  })
})

/**
 * Règle du 2026-10-31 : une interface nouvelle suit les thèmes. Le chemin choisi ici n'est
 * dans aucun plancher : c'est un fichier nouveau, qui n'a droit à aucune couleur en dur.
 */
describe('.githooks/pre-commit : interface qui ne suivrait pas les thèmes', () => {
  const NOUVEAU = 'src/renderer/src/components/ZoneNeuveDuTest.css'

  it('REFUSE une feuille nouvelle qui écrit une couleur en dur', () => {
    const { git, ecrire } = depot()
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-m', 'zone neuve')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toContain(`${NOUVEAU} : 1 couleur(s) en dur, 0 au plus`)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('laisse passer la même feuille écrite avec les jetons du thème', () => {
    const { git, ecrire } = depot()
    ecrire(NOUVEAU, '.zone { color: var(--text); }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-q', '-m', 'zone neuve')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne regarde que ce que le commit emporte, pas le travail d'à côté", () => {
    const { git, ecrire } = depot()
    // Une autre session a une feuille fautive dans l'arbre, non stagée ; ce commit ne la porte pas.
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-q', '-m', 'autre sujet')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans une copie de travail d'agent", () => {
    const { git, ecrire } = depot('agent__run-x-1')
    ecrire(NOUVEAU, '.zone { color: #fff; }\n')
    git('add', NOUVEAU)
    const r = git('commit', '-q', '-m', 'agent')
    expect(r.status, String(r.stderr)).toBe(0)
  })
})

/**
 * Appel bloquant AU COMMIT (`scripts/appels-bloquants.mjs`) : un `execFileSync` de plus dans
 * `src/main` fige la fenêtre, comme le `git log` du Board le 2026-11-13 (120 s d'un bloc).
 */
describe('.githooks/pre-commit : appel bloquant dans le processus principal', () => {
  const NOUVEAU = 'src/main/lecture-neuve-du-test.ts'
  const BLOQUANT =
    "import { execFileSync } from 'node:child_process'\nexport const sha = (): string => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })\n"

  it('REFUSE un fichier nouveau qui lance git en execFileSync', () => {
    const { git, ecrire } = depot()
    ecrire(NOUVEAU, BLOQUANT)
    git('add', NOUVEAU)
    const r = git('commit', '-m', 'lecture neuve')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toContain(`${NOUVEAU} : 1 appel(s) bloquant(s), 0 au plus`)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('laisse passer le même fichier quand il ne fait que nommer la fonction (commentaire, test)', () => {
    const { git, ecrire } = depot()
    ecrire(
      NOUVEAU,
      '// un execFileSync ici figeait la fenêtre : lecture disque à la place\nexport const x = 1\n'
    )
    ecrire('src/main/lecture-neuve-du-test.test.ts', BLOQUANT)
    git('add', '-A')
    const r = git('commit', '-q', '-m', 'lecture neuve')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne s'applique pas dans une copie de travail d'agent", () => {
    const { git, ecrire } = depot('agent__run-x-1')
    ecrire(NOUVEAU, BLOQUANT)
    git('add', NOUVEAU)
    const r = git('commit', '-q', '-m', 'agent')
    expect(r.status, String(r.stderr)).toBe(0)
  })
})

/**
 * Nom ou terme d'entreprise AU COMMIT. Le pré-envoi ne le voit qu'au moment de publier, quand il est déjà
 * dans l'historique ; le crochet doit donc le refuser dans le commit lui-même, dans le dossier principal ET
 * dans une copie de travail, dont les commits partent ensuite vers GitHub. Le profil est FICTIF (`acme`) et
 * non commité, comme sur le poste : `entreprise/` est ignoré par git.
 */
// fix-ok: .githooks/pre-commit — cause mesurée : la sortie réservée aux copies courait avant le contrôle des noms, et le crochet n'appelait pas scripts/separation-avant-push.mjs au commit
const PROFIL_FICTIF = JSON.stringify({
  nom: 'Acme',
  termesInterdits: [{ motif: 'zorglub', ignorerCasse: true }]
})
const AVEC_LE_TERME = "export const n = 'zorglub'\n"
const AVEC_LE_NOM = '// ACME\nexport const n = 1\n'
const PROPRE = 'export const n = 1\n'

function profilFictif(racine: string, contenu = PROFIL_FICTIF): void {
  mkdirSync(join(racine, 'entreprise', 'acme'), { recursive: true })
  writeFileSync(join(racine, 'entreprise', 'acme', 'identite.json'), contenu)
}

/** Le même environnement, sans `node` dans le PATH : git et sh restent joignables, node non. */
function envSansNode(): NodeJS.ProcessEnv {
  const env = envPropre()
  const cles = Object.keys(env).filter((cle) => cle.toUpperCase() === 'PATH')
  const dossiers = cles.flatMap((cle) => String(env[cle]).split(delimiter))
  for (const cle of cles) delete env[cle]
  env.PATH = dossiers
    .filter((d) => d && !existsSync(join(d, 'node.exe')) && !existsSync(join(d, 'node')))
    .join(delimiter)
  return env
}

const LIEUX: Array<[string, string | undefined]> = [
  ['dans le dossier principal', undefined],
  ['dans une copie de travail d agent', 'agent__run-x-1'],
  ['dans la copie de travail d un fil', 'copies-de-fil/fil-exemple']
]

describe.each(LIEUX)(
  '.githooks/pre-commit : nom ou terme d entreprise %s',
  (_lieu, sousDossier) => {
    it('REFUSE un fichier qui porte un terme interdit, et nomme le fichier', () => {
      const { git, ecrire, racine } = depot(sousDossier)
      profilFictif(racine)
      ecrire('src/main/note.ts', AVEC_LE_TERME)
      git('add', 'src/main/note.ts')
      const r = git('commit', '-m', 'ajout')
      expect(r.status).not.toBe(0)
      expect(String(r.stderr)).toMatch(/src\/main\/note\.ts \(contenu [0-9a-f]{8}\)/)
      expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
    })

    it('REFUSE un nom d entreprise en majuscules, dans le contenu', () => {
      const { git, ecrire, racine } = depot(sousDossier)
      profilFictif(racine)
      ecrire('src/main/note.ts', AVEC_LE_NOM)
      git('add', 'src/main/note.ts')
      const r = git('commit', '-m', 'ajout')
      expect(r.status).not.toBe(0)
      expect(String(r.stderr)).toMatch(/src\/main\/note\.ts \(contenu/)
    })

    it('REFUSE un nom d entreprise dans le chemin, et le nomme', () => {
      const { git, ecrire, racine } = depot(sousDossier)
      profilFictif(racine)
      ecrire('src/main/acme-outils.ts', PROPRE)
      git('add', 'src/main/acme-outils.ts')
      const r = git('commit', '-m', 'ajout')
      expect(r.status).not.toBe(0)
      expect(String(r.stderr)).toMatch(/src\/main\/acme-outils\.ts \(chemin\)/)
    })

    it('laisse passer le même fichier propre', () => {
      const { git, ecrire, racine } = depot(sousDossier)
      profilFictif(racine)
      ecrire('src/main/note.ts', PROPRE)
      git('add', 'src/main/note.ts')
      const r = git('commit', '-q', '-m', 'ajout')
      expect(r.status, String(r.stderr)).toBe(0)
    })
  }
)

describe('.githooks/pre-commit : nom ou terme d entreprise, cas limites', () => {
  it('laisse passer le même terme quand le poste n a pas de profil (version publique)', () => {
    const { git, ecrire } = depot()
    ecrire('src/main/note.ts', AVEC_LE_TERME)
    git('add', 'src/main/note.ts')
    const r = git('commit', '-q', '-m', 'ajout')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it("ne regarde que ce que le commit emporte, pas le travail d'à côté", () => {
    const { git, ecrire, racine } = depot()
    profilFictif(racine)
    ecrire('src/main/note.ts', AVEC_LE_TERME)
    ecrire('src/main/autre.ts', 'export const autre = 3\n')
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-q', '-m', 'autre sujet')
    expect(r.status, String(r.stderr)).toBe(0)
  })

  it('REFUSE aussi le commit par chemins nommés qui porte le terme', () => {
    const { git, ecrire, racine } = depot()
    profilFictif(racine)
    ecrire('src/main/autre.ts', AVEC_LE_TERME)
    const r = git('commit', '-q', '-m', 'autre', '--', 'src/main/autre.ts')
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/src\/main\/autre\.ts \(contenu/)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('1')
  })

  it('un profil illisible ne refuse pas un commit propre, et le dit', () => {
    const { git, ecrire, racine } = depot()
    profilFictif(racine, '{ pas du json')
    ecrire('src/main/autre.ts', PROPRE)
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-q', '-m', 'propre')
    expect(r.status, String(r.stderr)).toBe(0)
    // Le message du script (seul avertissement depuis le crochet) : il doit bien être là.
    expect(String(r.stderr)).toMatch(/Contrôle des noms d'entreprise non fait pour ce commit/)
    // Le commit passe : le message ne doit ni annoncer un échec (⛔), ni demander de refaire un commit déjà fait.
    expect(String(r.stderr)).not.toMatch(/⛔|refaire le commit/)
    expect(String(r.stderr)).toMatch(/envoi vers GitHub refusera/)
    // fix-ok: .githooks/pre-commit — cause mesurée : le crochet réaffichait le message du script (deux avertissements « non fait pour ce commit »).
    // Un seul avertissement : celui du script, qui nomme le profil.
    expect(
      (String(r.stderr).match(/non fait pour ce commit/g) ?? []).length,
      String(r.stderr)
    ).toBe(1)
  })

  it('sans node sur le PATH, un commit propre passe, et le dit', () => {
    const { racine, ecrire, git } = depot()
    profilFictif(racine)
    ecrire('src/main/autre.ts', PROPRE)
    git('add', 'src/main/autre.ts')
    const env = envSansNode()
    const sonde = spawnSync('sh', ['-c', 'command -v node'], { env, encoding: 'utf8' })
    expect(sonde.error).toBeUndefined()
    expect(sonde.status, 'node doit être introuvable avec ce PATH').not.toBe(0)
    const r = spawnSync('git', ['commit', '-q', '-m', 'propre'], {
      cwd: racine,
      encoding: 'utf8',
      env
    })
    expect(r.status, String(r.stderr)).toBe(0)
    expect(String(r.stderr)).toMatch(/pré-envoi/)
  })

  // fix-ok: scripts/separation-avant-push.mjs — cause mesurée : l'import statique des règles faisait sortir Node en code 1 (ERR_MODULE_NOT_FOUND), que le crochet prend pour un refus.
  it('règles introuvables (identite-entreprise.mjs absent) : un commit propre passe, et le dit', () => {
    const { racine, ecrire, git } = depot()
    profilFictif(racine)
    // Un jeu d'outils où le script du contrôle est là, mais pas le module de ses règles.
    const outils = mkdtempSync(join(tmpdir(), 'garde-commit-outils-'))
    dossiers.push(outils)
    mkdirSync(join(outils, '.githooks'))
    mkdirSync(join(outils, 'scripts'))
    copyFileSync(join(HOOKS, 'pre-commit'), join(outils, '.githooks', 'pre-commit'))
    copyFileSync(
      resolve(HOOKS, '../scripts/separation-avant-push.mjs'),
      join(outils, 'scripts', 'separation-avant-push.mjs')
    )
    git('config', 'core.hooksPath', join(outils, '.githooks'))
    ecrire('src/main/autre.ts', PROPRE)
    git('add', 'src/main/autre.ts')
    const r = git('commit', '-q', '-m', 'propre')
    expect(r.status, String(r.stderr)).toBe(0)
    expect(String(r.stderr)).toMatch(/Contrôle des noms d'entreprise non fait pour ce commit/)
    expect(String(git('rev-list', '--count', 'HEAD').stdout).trim()).toBe('2')
  })
})
