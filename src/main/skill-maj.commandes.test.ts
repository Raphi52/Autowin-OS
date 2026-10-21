import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { refusGitDestructeur } from '../shared/garde-git-destructeur'
import { refusArretHote } from '../shared/garde-hote-et-boucle'
import { refusTacheWindows } from '../shared/garde-tache-windows'
import { resoudreBash } from './chat/relance-taches-de-fond'

/**
 * LES COMMANDES QUE `/maj` PRESCRIT MARCHENT-ELLES, TELLES QU'ÉCRITES ? (conv-1036, 2026-10-21)
 *
 * Le défaut d'origine était une consigne qu'un agent ne pouvait pas suivre : le bouton disait
 * « mets le fichier de côté (git stash) », et le garde-fou refuse `git stash` aux agents. Vérifier
 * que la skill contient « jamais `git stash` » ne prouve pas qu'elle n'en prescrit pas un autre.
 * On lit donc les commandes de la procédure, et on les passe aux VRAIS garde-fous du hook.
 *
 * Puis on EXÉCUTE le bloc de l'étape 3 dans un dépôt jetable. Le premier jet de la skill
 * remettait l'arbre en place par `git checkout HEAD -- <fichier>` : sur un fichier NON SUIVI
 * qu'origin/main ajoute (« untracked working tree files would be overwritten »), git répond
 * « did not match any file(s) known to git » et la mise à jour reste bloquée.
 */
// fix-ok: conv-1036, 2026-10-21 — cause mesurée : avec skills/maj/SKILL.md du commit 45bcd2b6, ce test
// sort 1 sur « error: pathspec 'nouveau.txt' did not match any file(s) known to git » ; avec l'étape 3
// qui retire le non suivi par `rm` après `git show --stat`, il sort 0 (3 tests verts).
const SKILL = readFileSync(join(process.cwd(), 'skills', 'maj', 'SKILL.md'), 'utf8').replace(
  /\r\n/g,
  '\n'
)

/** Le texte d'une section `## Titre`, jusqu'à la section suivante de même niveau. */
function section(titre: string): string {
  const debut = SKILL.indexOf(`\n## ${titre}\n`)
  expect(debut, `section « ${titre} »`).toBeGreaterThanOrEqual(0)
  const suite = SKILL.indexOf('\n## ', debut + 4)
  return SKILL.slice(debut, suite < 0 ? undefined : suite)
}

/** Lignes des blocs ``` d'un texte, commentaires de fin de ligne compris (le shell les ignore). */
function lignesDeCode(texte: string): string[] {
  const blocs = [...texte.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  return blocs.flatMap((b) => b.split('\n')).filter((l) => l.trim())
}

/**
 * Commandes git citées en ligne (`git …`) hors blocs, plus tout `git stash` écrit SANS guillemets
 * inversés : l'ancienne consigne du bouton le disait ainsi, « mets-le de côté (git stash) ».
 */
function commandesEnLigne(lignes: string[]): string[] {
  return lignes.flatMap((l) => [
    ...[...l.matchAll(/`(git [^`]+)`/g)].map((m) => m[1].replace(/\s+#.*$/, '')),
    ...[...l.replace(/`[^`]*`/g, '').matchAll(/\bgit\s+stash\b[^.,;)\n]*/gi)].map((m) =>
      m[0].trim()
    )
  ])
}

const refusDuHook = (commande: string): string | undefined =>
  refusArretHote(commande) ?? refusGitDestructeur(commande) ?? refusTacheWindows(commande)

describe('/maj — chaque commande prescrite passe les garde-fous des agents', () => {
  it('blocs de code et commandes en ligne de la procédure : aucun refus', () => {
    const procedure = section('Procédure')
    const prose = procedure
      .replace(/```[a-z]*\n[\s\S]*?```/g, '')
      .split('\n')
      // Une ligne qui INTERDIT (« jamais `git stash` ») ne prescrit pas : elle est le jumeau ci-dessous.
      .filter((l) => !/jamais/i.test(l))
    const commandes = [...lignesDeCode(procedure), ...commandesEnLigne(prose)]
    expect(commandes.length).toBeGreaterThanOrEqual(10)
    for (const c of commandes) expect(refusDuHook(c), c).toBeUndefined()
  })

  it('jumeau : ce que « À ne pas faire » interdit, le garde-fou le refuse bien', () => {
    const interdits = commandesEnLigne(section('À ne pas faire').split('\n'))
    expect(interdits).toEqual(
      expect.arrayContaining(['git stash', 'git reset --hard', 'git checkout -- .'])
    )
    for (const c of interdits) expect(refusDuHook(c), c).toBeDefined()
  })
})

const IDENTITE = {
  GIT_AUTHOR_NAME: 'essai',
  GIT_AUTHOR_EMAIL: 'essai@exemple.invalid',
  GIT_COMMITTER_NAME: 'essai',
  GIT_COMMITTER_EMAIL: 'essai@exemple.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0'
}

function git(cwd: string, ...args: string[]): { code: number; sortie: string } {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITE }
  })
  return { code: r.status ?? -1, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function ok(cwd: string, ...args: string[]): string {
  const r = git(cwd, ...args)
  expect(r.code, `git ${args.join(' ')}\n${r.sortie}`).toBe(0)
  return r.sortie
}

/**
 * Le premier bloc de code de l'étape `numero`, ses champs `<…>` remplis. Un champ que ce test ne
 * connaît pas fait échouer : une skill réécrite doit dire à ce test ce que vaut son nouveau champ,
 * plutôt que de passer en silence.
 */
function blocEtape(numero: number, temoin: string, valeurs: Record<string, string>): string {
  const etape =
    new RegExp(`\\n### ${numero}\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n### )`).exec(
      section('Procédure')
    )?.[1] ?? ''
  const bloc = /```[a-z]*\n([\s\S]*?)```/.exec(etape)?.[1] ?? ''
  expect(bloc, `bloc de code de l étape ${numero}`).toContain(temoin)
  return bloc.replace(/\(conv-N\)/g, '(conv-essai)').replace(/<[^<>\n]+>/g, (champ) => {
    expect(valeurs, `champ inconnu de l étape ${numero} : ${champ}`).toHaveProperty([champ])
    return valeurs[champ]
  })
}

/** Joue un bloc de la skill tel qu'écrit, sous bash, arrêt à la première commande en échec. */
function jouer(cwd: string, bloc: string): ReturnType<typeof spawnSync> {
  return spawnSync(resoudreBash(), ['-e', '-c', bloc], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITE }
  })
}

/*
 * Étape 2 (juge de conv-1043, 2026-10-21) : elle prescrivait seulement `git commit -m "…" -- <chemins>`
 * et déconseillait le `git add`. Sur un fichier NEUF, git répond « pathspec … did not match any
 * file(s) known to git » : le vrai travail récent ne pouvait pas être gardé tel qu'écrit.
 */
describe('/maj — l étape 2 garde le vrai travail récent par ses seuls chemins', () => {
  it('fichier neuf + fichier suivi modifié, avec le travail d un autre fil déjà dans l index commun', () => {
    const local = mkdtempSync(join(tmpdir(), 'skill-maj-etape2-'))
    ok(local, 'init', '-q', '-b', 'main')
    writeFileSync(join(local, 'mien.txt'), 'base\n')
    writeFileSync(join(local, 'autre-fil.txt'), 'base\n')
    ok(local, 'add', '-A')
    ok(local, 'commit', '-q', '-m', 'base')
    const head = ok(local, 'rev-parse', 'HEAD').trim()

    writeFileSync(join(local, 'mien.txt'), 'travail recent\n')
    writeFileSync(join(local, 'neuf.txt'), 'travail recent neuf\n')
    writeFileSync(join(local, 'autre-fil.txt'), 'travail d un autre fil\n')
    ok(local, 'add', '--', 'autre-fil.txt')
    const indexAutre = ok(local, 'ls-files', '-s', '--', 'autre-fil.txt')

    const r = jouer(
      local,
      blocEtape(2, 'git commit', {
        '<chemins>': 'mien.txt neuf.txt',
        '<message>': 'garde(maj): essai'
      })
    )
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)

    expect(ok(local, 'rev-parse', 'HEAD^').trim()).toBe(head)
    expect(ok(local, 'diff', '--name-only', head, 'HEAD').trim().split('\n')).toEqual([
      'mien.txt',
      'neuf.txt'
    ])
    expect(ok(local, 'show', 'HEAD:neuf.txt')).toBe('travail recent neuf\n')
    // Le travail de l'autre fil : toujours dans l'index commun, et hors du commit.
    expect(ok(local, 'ls-files', '-s', '--', 'autre-fil.txt')).toBe(indexAutre)
    expect(ok(local, 'diff', '--cached', '--name-only').trim()).toBe('autre-fil.txt')
  }, 60_000)
})

describe('/maj — l étape 3 met de côté sans stash et débloque la mise à jour', () => {
  it('fichier suivi modifié + fichier non suivi qu origin/main ajoute : sauvés, retirés, fusion possible', () => {
    const racine = mkdtempSync(join(tmpdir(), 'skill-maj-'))
    const amont = join(racine, 'amont')
    const local = join(racine, 'local')
    ok(racine, 'init', '-q', '-b', 'main', amont)
    writeFileSync(join(amont, 'suivi.txt'), 'base\n')
    writeFileSync(join(amont, 'autre-fil.txt'), 'base\n')
    ok(amont, 'add', '-A')
    ok(amont, 'commit', '-q', '-m', 'base')
    ok(racine, 'clone', '-q', amont, local)
    writeFileSync(join(amont, 'suivi.txt'), 'version entrante\n')
    writeFileSync(join(amont, 'nouveau.txt'), 'version entrante\n')
    ok(amont, 'add', '-A')
    ok(amont, 'commit', '-q', '-m', 'entrant')
    ok(local, 'fetch', '-q', 'origin')

    // Le travail en travers du chemin, et celui d'un AUTRE fil, déjà ajouté à l'index commun.
    writeFileSync(join(local, 'suivi.txt'), 'travail local suivi\n')
    writeFileSync(join(local, 'nouveau.txt'), 'travail local non suivi\n')
    writeFileSync(join(local, 'autre-fil.txt'), 'travail d un autre fil\n')
    ok(local, 'add', '--', 'autre-fil.txt')
    const head = ok(local, 'rev-parse', 'HEAD').trim()
    const indexAvant = ok(local, 'ls-files', '-s', '--', 'autre-fil.txt')
    // Le scénario reproduit bien le refus que le bouton rapporte.
    expect(git(local, 'merge', '--ff-only', 'origin/main').code).not.toBe(0)

    const r = jouer(
      local,
      blocEtape(3, 'refs/heads/sauvegarde/', {
        '<fichiers>': 'suivi.txt nouveau.txt',
        // Champ de l'ANCIENNE étape 3 (45bcd2b6) : gardé pour que ce test la rejoue en rouge.
        '<fichier>': 'suivi.txt nouveau.txt',
        '<fichiers suivis>': 'suivi.txt',
        '<fichiers non suivis>': 'nouveau.txt',
        '<quoi>': 'essai',
        '<AAAA-MM-JJ>': '2026-10-21',
        '<sujet>': 'essai'
      })
    )
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0)

    const secours = 'refs/heads/sauvegarde/maj-2026-10-21-essai'
    expect(ok(local, 'show', `${secours}:suivi.txt`)).toBe('travail local suivi\n')
    expect(ok(local, 'show', `${secours}:nouveau.txt`)).toBe('travail local non suivi\n')
    expect(ok(local, 'rev-parse', `${secours}^`).trim()).toBe(head)
    // Index à part : la branche de secours ne porte QUE les fichiers mis de côté, jamais ce que
    // l'autre fil avait ajouté à l'index commun.
    expect(ok(local, 'diff', '--name-only', head, secours).trim().split('\n')).toEqual([
      'nouveau.txt',
      'suivi.txt'
    ])
    // Rien d'autre n'a bougé : HEAD, l'index et le fichier de l'autre fil, la pile de stash.
    expect(ok(local, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(ok(local, 'ls-files', '-s', '--', 'autre-fil.txt')).toBe(indexAvant)
    expect(readFileSync(join(local, 'autre-fil.txt'), 'utf8')).toBe('travail d un autre fil\n')
    expect(ok(local, 'stash', 'list')).toBe('')

    // La mise à jour passe, et le travail de l'autre fil est toujours là.
    ok(local, 'merge', '--ff-only', 'origin/main')
    expect(readFileSync(join(local, 'nouveau.txt'), 'utf8')).toBe('version entrante\n')
    expect(readFileSync(join(local, 'autre-fil.txt'), 'utf8')).toBe('travail d un autre fil\n')
  }, 60_000)
})
