import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  parseGitStatus,
  parseGitLog,
  type GitBranchResult,
  type GitReadResult,
  type GitDiffResult
} from '../shared/git-read'

/** stdout d'une erreur execFile (git renvoie exit≠0 avec un diff valide sur --no-index). */
function stdoutOf(error: unknown): string {
  return error && typeof error === 'object' && 'stdout' in error
    ? String((error as { stdout: unknown }).stdout ?? '')
    : ''
}

/**
 * Diff READ-ONLY d'un fichier (vs HEAD ; fallback --no-index pour un fichier non suivi). N'exécute
 * QUE `git diff` (aucune mutation). Le path vient du renderer → passé en argv (jamais un shell) + `--`.
 */
export async function readGitDiff(cwd: string, path: string): Promise<GitDiffResult> {
  const run = promisify(execFile)
  try {
    const r = await run('git', ['diff', '--no-color', 'HEAD', '--', path], {
      cwd,
      windowsHide: true
    })
    let diff = r.stdout
    if (!diff.trim()) diff = await readNoIndexGitDiff(cwd, path)
    return { available: true, diff }
  } catch (error) {
    const stdout = stdoutOf(error)
    if (stdout.trim()) return { available: true, diff: stdout }
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Seconde moitie de `readGitDiff` : le diff d'un chemin NON SUIVI contre /dev/null (`--no-index`).
 *
 * Exposee seule pour l'appelant qui SAIT deja, par un lot `git diff HEAD` lu juste avant, que
 * `git diff HEAD -- path` est vide : il economise un processus git par fichier sans changer d'un
 * octet le texte rendu (c'est exactement la branche que `readGitDiff` prendrait).
 */
export async function readNoIndexGitDiff(cwd: string, path: string): Promise<string> {
  const run = promisify(execFile)
  try {
    const u = await run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', path], {
      cwd,
      windowsHide: true
    })
    return u.stdout
  } catch (e) {
    return stdoutOf(e) // --no-index sort exit 1 QUAND il y a des différences → stdout valide
  }
}

/** Longueur cumulee des chemins par appel : la ligne de commande Windows plafonne a 32 767. */
const LOT_DIFF_CARACTERES_MAX = 8000

/**
 * `git diff HEAD` de PLUSIEURS chemins, en un processus par paquet au lieu d'un par fichier.
 *
 * `--no-renames` est OBLIGATOIRE : seul, un chemin ne peut jamais etre apparie a un autre en
 * renommage ; en lot, si — et la portion rendue ne serait plus celle de l'appel unitaire.
 * Rend les sorties brutes par paquet, ou `undefined` des qu'un paquet echoue : l'appelant retombe
 * alors sur `readGitDiff`, fichier par fichier, comme avant.
 */
export async function readGitDiffHeadBatch(
  cwd: string,
  paths: readonly string[]
): Promise<string[] | undefined> {
  const run = promisify(execFile)
  const paquets: string[][] = []
  let courant: string[] = []
  let longueur = 0
  for (const path of paths) {
    if (courant.length > 0 && longueur + path.length > LOT_DIFF_CARACTERES_MAX) {
      paquets.push(courant)
      courant = []
      longueur = 0
    }
    courant.push(path)
    longueur += path.length + 1
  }
  if (courant.length > 0) paquets.push(courant)
  try {
    const sorties: string[] = []
    for (const paquet of paquets) {
      const r = await run('git', ['diff', '--no-color', '--no-renames', 'HEAD', '--', ...paquet], {
        cwd,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
      })
      sorties.push(r.stdout)
    }
    return sorties
  } catch {
    return undefined
  }
}

/**
 * Les fichiers du DERNIER COMMIT — lecture seule, `git show` et rien d'autre.
 *
 * Sert la question « ce que je viens de committer casse-t-il quelque chose ? », qui est la seule
 * repondable quand l'arbre est propre. `--format=` vide l'en-tete pour ne garder que les chemins,
 * et `-z` les separe par un octet nul : un nom de fichier peut contenir un espace, jamais un nul.
 *
 * Un depot sans commit, sans git, ou un `git` absent rend une liste VIDE — l'appelant retombe alors
 * sur la suite entiere. Degrade proprement, ne jette jamais.
 */
export async function readLastCommitFiles(cwd: string): Promise<string[]> {
  try {
    const run = promisify(execFile)
    const r = await run('git', ['show', '--name-only', '--format=', '-z', 'HEAD'], {
      cwd,
      windowsHide: true
    })
    return r.stdout
      .split(String.fromCharCode(0))
      .map((chemin) => chemin.trim())
      .filter((chemin) => chemin.length > 0)
  } catch {
    return []
  }
}

/**
 * LES FICHIERS DE TEST QUI *NOMMENT* QUELQUE CHOSE — lecture seule, `git grep` et rien d'autre.
 *
 * POURQUOI CETTE LECTURE EXISTE (mesure du 2026-09-03, dans ce dépôt) :
 *   npx vitest related src/renderer/src/components/ChatView.css --run  ->  89 fichiers, 401 tests
 *   et parmi les ABSENTS : ChatView.style.test.ts, ui-system.test.ts, spinner-partout.test.ts…
 * Autrement dit, les tests qui jugent RÉELLEMENT une feuille de style ne l'importent pas, ils la
 * LISENT (`readFileSync`) — donc le graphe d'imports ne les voit pas. Une portée qui s'arrêterait à
 * `vitest related` rendrait un vert n'ayant jamais regardé ce que l'édition a changé.
 *
 * TROIS RÉPONSES DISTINCTES, et la distinction est le point :
 *   - une liste  -> ces tests-là citent le motif ;
 *   - `[]`       -> personne ne le cite (fait établi, pas un échec) ;
 *   - `undefined`-> on ne SAIT pas (pas de dépôt, pas de git). L'appelant doit alors élargir, jamais
 *     conclure : « rien trouvé » et « je n'ai pas pu chercher » ne se confondent pas.
 *
 * `-F` : le motif est un TEXTE, jamais une expression régulière. `-I` écarte le binaire. Le motif est
 * passé en argv derrière `-e`, les chemins derrière `--` : aucune interpolation, aucun shell.
 */
export async function readTestsCitant(cwd: string, motif: string): Promise<string[] | undefined> {
  if (!motif.trim()) return []
  try {
    const run = promisify(execFile)
    const r = await run(
      'git',
      [
        'grep',
        '-l',
        '-I',
        '-F',
        '-e',
        motif,
        '--',
        '*.test.ts',
        '*.test.tsx',
        '*.test.js',
        '*.test.jsx',
        '*.spec.ts',
        '*.spec.tsx'
      ],
      { cwd, windowsHide: true }
    )
    return r.stdout
      .split(String.fromCharCode(10))
      .map((chemin) => chemin.trim())
      .filter((chemin) => chemin.length > 0)
  } catch (error) {
    // `git grep` sort en 1 quand il ne trouve RIEN. C'est un résultat, pas une panne ; tout autre
    // code (128 hors dépôt, ENOENT sans git) laisse la question ouverte.
    const code = (error as { code?: unknown } | null)?.code
    return code === 1 && !stdoutOf(error).trim() ? [] : undefined
  }
}

/**
 * Lecture git READ-ONLY pour la surface "Source control". N'exécute QUE status/log (aucune mutation).
 * Les actions git (commit/push/branche) ne passent JAMAIS par ici : elles composent un prompt agent.
 * Dégrade proprement (repo absent / git indispo) → { available:false } sans jamais throw vers l'IPC.
 */
export async function readGitState(cwd: string, historyLimit = 20): Promise<GitReadResult> {
  const run = promisify(execFile)
  try {
    const [statusResult, logResult] = await Promise.allSettled([
      run('git', ['status', '--porcelain=v2', '--branch'], { cwd, windowsHide: true }),
      run('git', ['log', '--pretty=format:%h%x09%s', '-n', String(historyLimit)], {
        cwd,
        windowsHide: true
      })
    ])
    if (statusResult.status === 'rejected') {
      const error = statusResult.reason
      return { available: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (logResult.status === 'rejected') {
      const error = logResult.reason
      return { available: false, error: error instanceof Error ? error.message : String(error) }
    }
    return {
      available: true,
      state: parseGitStatus(statusResult.value.stdout),
      history: parseGitLog(logResult.value.stdout)
    }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * La branche courante, SANS créer de processus : lue dans `HEAD`, en asynchrone.
 *
 * Pourquoi (heal conv-1013, 2026-10-16) : `gels.jsonl` porte, du 14 au 16/10, 9 gels de 3,3 à
 * 9,8 s du fil principal, chacun dans la création d'UN processus `git status` lancé par
 * `readGitState` (`ipc:git:read`). `execFile` est asynchrone, mais la création du processus ne
 * l'est pas : elle tient le fil appelant (4,8 ms en médiane à vide, 19,7 ms au p95) et elle attend
 * dès que le système cale — au même moment, des `readFileSync` de quelques octets y restent 10 s.
 * Le badge de branche du chat relisait `readGitState` toutes les 5 s (`branche-courante.ts`) :
 * `git status` + `git log`, 24 processus par minute, pour un nom qui tient dans `.git/HEAD`. Ici,
 * une lecture qui attend le disque attend dans le pool de libuv, jamais sur le fil principal.
 *
 * Même découverte que git, pour rendre le même nom que `# branch.head` : remontée depuis `cwd`
 * jusqu'au premier `.git` (dossier contenant `HEAD`, ou fichier `gitdir:` d'une copie
 * `git worktree`), `refs/heads/<nom>` → `<nom>`, HEAD sur un commit → `(detached)`. Un dossier
 * absent, un fichier `.git` illisible ou aucun dépôt → `available: false`, comme `git status`.
 */
export async function readGitBranch(cwd: string): Promise<GitBranchResult> {
  try {
    if (!(await stat(cwd)).isDirectory())
      return { available: false, error: `${cwd} n'est pas un dossier` }
    let dossier = resolve(cwd)
    for (;;) {
      const gitDir = await dossierGitDe(join(dossier, '.git'))
      if (gitDir === 'invalide') return { available: false, error: `.git invalide dans ${dossier}` }
      if (gitDir) {
        const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
        return { available: true, state: { branch: brancheDeHead(head) } }
      }
      const parent = dirname(dossier)
      if (parent === dossier)
        return { available: false, error: `aucun dépôt git au-dessus de ${cwd}` }
      dossier = parent
    }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Le dossier git désigné par `<dossier>/.git` : lui-même, la cible d'un `gitdir:`, ou rien. */
async function dossierGitDe(chemin: string): Promise<string | 'invalide' | null> {
  const info = await stat(chemin).catch(() => null)
  if (!info) return null
  if (info.isDirectory()) {
    // Comme git : un `.git` sans `HEAD` n'est pas un dépôt, la recherche continue plus haut.
    return (await stat(join(chemin, 'HEAD')).catch(() => null)) ? chemin : null
  }
  if (!info.isFile()) return null
  const cible = /^gitdir:\s*(.+)$/m.exec(await readFile(chemin, 'utf8'))?.[1]?.trim()
  if (!cible) return 'invalide'
  return isAbsolute(cible) ? cible : resolve(dirname(chemin), cible)
}

function brancheDeHead(head: string): string {
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim()
  if (!ref) return '(detached)'
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
}

/**
 * Liste des branches LOCALES d'un dépôt, triée par date de dernier commit (la plus récente d'abord).
 *
 * Strictement en lecture (`for-each-ref`) : aucun changement de branche ici — la barre du chat
 * propose de choisir, l'agent seul exécute la bascule. Bornée à 200 entrées et appelée à
 * l'OUVERTURE du menu, jamais au dessin de la fenêtre (les recensements de branches au rendu ont
 * déjà produit des gels mesurés à plusieurs secondes).
 */
export async function readGitBranches(cwd: string, limit = 200): Promise<string[]> {
  const run = promisify(execFile)
  try {
    const r = await run(
      'git',
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'],
      { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
    )
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, Math.max(1, limit))
  } catch {
    return []
  }
}
