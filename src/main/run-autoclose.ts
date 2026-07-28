/**
 * Clôture automatique d'un run VERT : commit du travail puis publication sur une branche DÉDIÉE.
 *
 * Deux garde-fous structurels, non contournables depuis l'appelant :
 *  1. **Jamais `main`/`master`** — la règle d'équipe (1 branche + PR, `.githooks/pre-push`) reste
 *     valable pour une machine comme pour un humain : l'automatisation ne doit pas devenir la faille
 *     que le hook ferme. On pousse `HEAD:refs/heads/<branche auto>`.
 *  2. **On ne déplace jamais le HEAD local** — pas de `checkout -b` : l'utilisateur travaille peut-être
 *     dans ce dépôt. Le commit va sur la branche courante, la publication sur une branche distante.
 *
 * Le périmètre est explicite : sur un dépôt PARTAGÉ (le Brain), on ne commite QUE les chemins produits
 * par le run — jamais `add -A`, qui emporterait le travail non relu d'autrui.
 */

/** Exécute une commande git et rend sa sortie. Injectable → testable contre un vrai dépôt. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

export interface AutoCloseInput {
  repo: string
  /** Branche distante de publication (jamais main/master). */
  branch: string
  message: string
  /**
   * Chemins à committer. ABSENT = tout le dépôt (projet). FOURNI = strictement ces fichiers
   * (obligatoire sur un dépôt partagé comme le Brain).
   */
  paths?: string[]
  runGit: GitRunner
  /** Publier sur le distant. `false` ⇒ commit local seulement. */
  push?: boolean
}

export type AutoCloseResult =
  | { status: 'pushed'; branch: string; files: number }
  | { status: 'committed'; files: number }
  | { status: 'skipped'; reason: 'no-changes' | 'protected-branch' | 'secret-detected' | 'no-remote'; detail?: string }
  | { status: 'failed'; error: string }

const PROTECTED = /^(main|master|HEAD)$/i

/**
 * Motifs de secret bloquants avant publication. Volontairement grossier : c'est un DERNIER filet
 * (le contrat du Brain a son propre scan), pas un scanner de sécurité — un faux négatif reste possible.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'token GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'clé API générique', re: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i },
  { name: 'jeton Bearer', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ }
]

/** Premier secret détecté dans un texte, sinon undefined. Pur → testable. */
export function detectSecret(text: string): string | undefined {
  return SECRET_PATTERNS.find(({ re }) => re.test(text))?.name
}

/** Lignes de `git status --porcelain` → chemins (gère le renommage `a -> b`). */
export function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(2).trim().replace(/^"|"$/g, '')
      const renamed = path.split(' -> ')
      return renamed[renamed.length - 1]
    })
}

/**
 * Commit (+ push sur branche dédiée) du travail d'un run vert. Ne throw jamais : toute défaillance
 * devient un `status: 'failed'` — une clôture ratée ne doit pas casser le run qui, lui, a réussi.
 */
export async function autoCloseRun(input: AutoCloseInput): Promise<AutoCloseResult> {
  const { repo, branch, message, paths, runGit } = input
  if (PROTECTED.test(branch.trim())) {
    return { status: 'skipped', reason: 'protected-branch', detail: branch }
  }
  try {
    const scope = paths?.length ? ['--', ...paths] : []
    const changed = parsePorcelainPaths(await runGit(['status', '--porcelain', ...scope], repo))
    if (changed.length === 0) return { status: 'skipped', reason: 'no-changes' }

    // Dernier filet anti-secret : on inspecte ce qu'on s'apprête à publier, pas l'arbre entier.
    const diff = await runGit(['diff', 'HEAD', ...scope], repo)
    const secret = detectSecret(diff)
    if (secret) return { status: 'skipped', reason: 'secret-detected', detail: secret }

    await runGit(paths?.length ? ['add', '--', ...paths] : ['add', '-A'], repo)
    await runGit(['commit', '-m', message], repo)
    if (input.push === false) return { status: 'committed', files: changed.length }

    const remotes = (await runGit(['remote'], repo)).trim()
    if (!remotes) return { status: 'skipped', reason: 'no-remote' }
    // HEAD:refs/heads/<branche> → publie sans créer ni basculer de branche locale.
    await runGit(['push', 'origin', `HEAD:refs/heads/${branch}`], repo)
    return { status: 'pushed', branch, files: changed.length }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Nom de branche de publication d'un run — stable, lisible, jamais protégé. */
export function autoCloseBranch(runId: string): string {
  return `auto/${runId.replace(/[^A-Za-z0-9._-]+/g, '-')}`
}

export interface AutoCloseReport {
  runId: string
  branch: string
  project: AutoCloseResult
  brain: AutoCloseResult
  at: string
}

/** Message de commit : la tâche du run, bornée, préfixée pour être reconnaissable dans l'historique. */
export function autoCloseMessage(task: string, runId: string): string {
  const head = task.replace(/\s+/g, ' ').trim().slice(0, 100) || 'travail agent'
  return `auto(${runId}): ${head}`
}

/**
 * Clôture réelle d'un run vert : publie le PROJET (tout l'arbre) puis le BRAIN (uniquement les
 * fichiers modifiés du Brain — dépôt partagé, jamais `add -A`). Chaque dépôt est indépendant : un
 * échec côté Brain (réseau GED, conflit) n'empêche pas la publication du projet.
 */
export async function closeGreenRunOnDisk(input: {
  runId: string
  task: string
  projectRepo: string
  brainRepo: string
  runGit?: GitRunner
}): Promise<AutoCloseReport> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const runGit: GitRunner =
    input.runGit ?? (async (args, cwd) => (await exec('git', args, { cwd })).stdout)

  const branch = autoCloseBranch(input.runId)
  const message = autoCloseMessage(input.task, input.runId)
  const project = await autoCloseRun({ repo: input.projectRepo, branch, message, runGit })

  // Brain : périmètre STRICT aux fichiers déjà modifiés dans son arbre au moment de la clôture.
  // (Un `add -A` emporterait le travail non relu d'autrui sur un dépôt partagé.)
  let brain: AutoCloseResult
  try {
    const changed = parsePorcelainPaths(await runGit(['status', '--porcelain'], input.brainRepo))
    brain = changed.length
      ? await autoCloseRun({
          repo: input.brainRepo,
          branch,
          message,
          paths: changed,
          runGit
        })
      : { status: 'skipped', reason: 'no-changes' }
  } catch (error) {
    brain = { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }

  return { runId: input.runId, branch, project, brain, at: new Date().toISOString() }
}
