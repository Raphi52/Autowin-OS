import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  parseGitStatus,
  parseGitLog,
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
    if (!diff.trim()) {
      try {
        const u = await run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', path], {
          cwd,
          windowsHide: true
        })
        diff = u.stdout
      } catch (e) {
        diff = stdoutOf(e) // --no-index sort exit 1 QUAND il y a des différences → stdout valide
      }
    }
    return { available: true, diff }
  } catch (error) {
    const stdout = stdoutOf(error)
    if (stdout.trim()) return { available: true, diff: stdout }
    return { available: false, error: error instanceof Error ? error.message : String(error) }
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
