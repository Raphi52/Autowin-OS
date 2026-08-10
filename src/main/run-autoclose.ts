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
  | {
      status: 'skipped'
      reason:
        | 'no-changes'
        | 'protected-branch'
        | 'secret-detected'
        | 'no-remote'
        | 'invalid-publication-range'
        /** Reprise legacy : aucune preuve durable ne permet d'attribuer le dirty Brain au run. */
        | 'recovery-baseline-missing'
        /** L'historique à publier contient un commit qui n'appartient pas à ce run. */
        | 'concurrent-commits'
      detail?: string
    }
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
  {
    name: 'clé API générique',
    re: /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i
  },
  { name: 'jeton Bearer', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ }
]

/** Premier secret détecté dans un texte, sinon undefined. Pur → testable. */
export function detectSecret(text: string): string | undefined {
  return SECRET_PATTERNS.find(({ re }) => re.test(text))?.name
}

/**
 * Enregistrements NUL de `git status --porcelain=v1 -z` → chemins exacts.
 *
 * NB : tous les appels passent `-uall`. Sans lui, git REPLIE un dossier non suivi en une seule
 * entrée (`?? inbox/`) : un fichier ajouté dans un dossier déjà non suivi devient alors invisible
 * au delta (rien n'est publié), et à l'inverse un `add -- inbox/` emporterait TOUT le dossier, y
 * compris le travail d'autrui. Constaté en vrai sur le Brain.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  const records = stdout.split('\0')
  const paths: string[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const separator = record[2] === ' ' ? 2 : record[1] === ' ' ? 1 : -1
    if (separator < 0) continue
    const status = record.slice(0, separator)
    const path = record.slice(separator + 1)
    if (!path) continue
    paths.push(path)
    // En mode -z, Git écrit le NOUVEAU chemin dans l'enregistrement status, puis l'ANCIEN
    // chemin comme enregistrement NUL séparé. Il n'existe aucun séparateur textuel ` -> `.
    if (status.includes('R') || status.includes('C')) index += 1
  }
  return paths
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
    const changed = parsePorcelainPaths(
      await runGit(['status', '--porcelain=v1', '-z', '-uall', ...scope], repo)
    )
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

/**
 * Publie le travail du run DÉJÀ COMMITÉ dans la base.
 *
 * Observé sur un run vert réel : la fusion du worktree committe le travail de l'agent
 * (`agent <runId>-N`), si bien que l'arbre est PROPRE au moment de la clôture. Le chemin « fichiers
 * modifiés » n'y voit alors rien et sortait en `no-changes` — la publication ne se déclenchait
 * jamais. C'est ce trou-là que cette fonction ferme.
 *
 * La propriété n'est jamais déduite du message : le moteur worktree fournit les deux SHA exacts.
 * Le push vise publishedSha, pas HEAD, donc un commit concurrent arrivé ensuite reste hors branche.
 */
export interface GitPublicationRange {
  baseSha: string
  publishedSha: string
}

export async function publishRunCommits(input: {
  repo: string
  /** Plage exacte attestée par la finalisation du worktree. */
  publication: Readonly<GitPublicationRange>
  branch: string
  runGit: GitRunner
}): Promise<AutoCloseResult> {
  const { repo, publication, branch, runGit } = input
  if (PROTECTED.test(branch.trim())) {
    return { status: 'skipped', reason: 'protected-branch', detail: branch }
  }
  const { baseSha, publishedSha } = publication
  if (![baseSha, publishedSha].every((sha) => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(sha))) {
    return { status: 'skipped', reason: 'invalid-publication-range', detail: 'SHA invalide' }
  }
  try {
    await runGit(['cat-file', '-e', `${baseSha}^{commit}`], repo)
    await runGit(['cat-file', '-e', `${publishedSha}^{commit}`], repo)
    await runGit(['merge-base', '--is-ancestor', baseSha, publishedSha], repo)
  } catch (error) {
    return {
      status: 'skipped',
      reason: 'invalid-publication-range',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
  try {
    const range = `${baseSha}..${publishedSha}`
    const count = Number((await runGit(['rev-list', '--count', range], repo)).trim())
    if (!Number.isFinite(count) || count <= 0) return { status: 'skipped', reason: 'no-changes' }

    const files = (await runGit(['diff', '--name-only', range], repo))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const secret = detectSecret(await runGit(['diff', range], repo))
    if (secret) return { status: 'skipped', reason: 'secret-detected', detail: secret }

    const remotes = (await runGit(['remote'], repo)).trim()
    if (!remotes) return { status: 'skipped', reason: 'no-remote' }
    await runGit(['push', 'origin', `${publishedSha}:refs/heads/${branch}`], repo)
    return { status: 'pushed', branch, files: files.length }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Compatibilité des clôtures sans attestation worktree : attribution prudente par message. */
async function publishLegacyRunCommits(input: {
  repo: string
  baseHead: string
  runId: string
  branch: string
  runGit: GitRunner
}): Promise<AutoCloseResult> {
  try {
    const publishedSha = (await input.runGit(['rev-parse', 'HEAD'], input.repo)).trim()
    const subjects = (
      await input.runGit(['log', '--format=%s', `${input.baseHead}..${publishedSha}`], input.repo)
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (subjects.length === 0) return { status: 'skipped', reason: 'no-changes' }
    const foreign = subjects.find((subject) => !subject.includes(input.runId))
    if (foreign) return { status: 'skipped', reason: 'concurrent-commits', detail: foreign }
    return publishRunCommits({
      repo: input.repo,
      publication: { baseSha: input.baseHead, publishedSha },
      branch: input.branch,
      runGit: input.runGit
    })
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Nom de branche de publication d'un run — stable, lisible, jamais protégé. */
export function autoCloseBranch(runId: string): string {
  return `auto/${runId.replace(/[^A-Za-z0-9._-]+/g, '-')}`
}

/**
 * Empreinte des fichiers DÉJÀ modifiés dans un dépôt avant que le run ne commence. Sans elle, une
 * clôture emporte tout ce qui traînait dans l'arbre (mesuré : 44 `.md` préexistants côté Brain, du
 * travail concurrent côté projet) — soit exactement le « changements entremêlés » qu'on veut éviter.
 */
export async function snapshotChangedPaths(repo: string, runGit: GitRunner): Promise<string[]> {
  try {
    return parsePorcelainPaths(await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo))
  } catch {
    return [] // dépôt illisible → aucune baseline ; le filtrage se comporte comme avant
  }
}

/** Chemins réellement imputables au run = modifiés maintenant, mais pas déjà modifiés avant. */
export function pathsFromRun(before: readonly string[], after: readonly string[]): string[] {
  const preexisting = new Set(before)
  return after.filter((path) => !preexisting.has(path))
}

/** SHA de HEAD, ou undefined si le dépôt n'a pas d'historique lisible. */
async function headSha(repo: string, runGit: GitRunner): Promise<string | undefined> {
  try {
    return (await runGit(['rev-parse', 'HEAD'], repo)).trim() || undefined
  } catch {
    return undefined
  }
}

/** Photo d'un dépôt au démarrage : ce qui traînait déjà, ET où en était l'historique. */
export interface CloseBaseline {
  project: string[]
  brain: string[]
  /** HEAD au démarrage : sert à isoler les commits produits PAR le run (fusion du worktree). */
  projectHead?: string
  brainHead?: string
}

/** Photographie les deux dépôts au démarrage d'un run (best-effort, jamais bloquant). */
export async function captureCloseBaseline(
  projectRepo: string,
  brainRepo: string,
  runGit?: GitRunner
): Promise<CloseBaseline> {
  const git = runGit ?? (await defaultGitRunner())
  const [project, brain, projectHead, brainHead] = await Promise.all([
    snapshotChangedPaths(projectRepo, git),
    snapshotChangedPaths(brainRepo, git),
    headSha(projectRepo, git),
    headSha(brainRepo, git)
  ])
  return { project, brain, projectHead, brainHead }
}

async function defaultGitRunner(): Promise<GitRunner> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  return async (args, cwd) => (await exec('git', args, { cwd, windowsHide: true })).stdout
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
  /** Fichiers déjà modifiés AVANT le run, par dépôt : ils sont exclus de la publication. */
  baseline?: Readonly<CloseBaseline>
  /** Publication projet attestée par le moteur worktree ; elle prime sur HEAD et le dirty courant. */
  projectPublication?: Readonly<GitPublicationRange>
  /** Après crash sans baseline Brain durable, interdit toute attribution opportuniste du dirty. */
  recoveredWithoutBrainBaseline?: boolean
  runGit?: GitRunner
}): Promise<AutoCloseReport> {
  const runGit: GitRunner = input.runGit ?? (await defaultGitRunner())

  const branch = autoCloseBranch(input.runId)
  const message = autoCloseMessage(input.task, input.runId)

  /** Publie un dépôt en n'y prenant QUE ce que le run a produit (delta vs baseline). */
  const closeScoped = async (
    repo: string,
    before: readonly string[],
    baseHead: string | undefined
  ): Promise<AutoCloseResult> => {
    try {
      const after = parsePorcelainPaths(
        await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo)
      )
      const mine = pathsFromRun(before, after)
      // Arbre propre : le travail du run a pu être DÉJÀ commité par la fusion du worktree.
      if (mine.length === 0) {
        if (!baseHead) return { status: 'skipped', reason: 'no-changes' }
        return await publishLegacyRunCommits({
          repo,
          baseHead,
          runId: input.runId,
          branch,
          runGit
        })
      }
      return await autoCloseRun({ repo, branch, message, paths: mine, runGit })
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
  }

  // Les DEUX dépôts sont traités au périmètre du run : côté projet aussi, un `add -A` emporterait le
  // travail en cours d'une autre session partageant l'arbre.
  const project = input.projectPublication
    ? await publishRunCommits({
        repo: input.projectRepo,
        publication: input.projectPublication,
        branch,
        runGit
      })
    : await closeScoped(
        input.projectRepo,
        input.baseline?.project ?? [],
        input.baseline?.projectHead
      )
  const brain: AutoCloseResult = input.recoveredWithoutBrainBaseline
    ? { status: 'skipped', reason: 'recovery-baseline-missing' }
    : await closeScoped(input.brainRepo, input.baseline?.brain ?? [], input.baseline?.brainHead)

  return { runId: input.runId, branch, project, brain, at: new Date().toISOString() }
}
