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
 * Le périmètre est explicite : les dépôts sont PARTAGÉS entre conversations, donc on ne commite QUE ce
 * qu'une preuve rattache au run — jamais `add -A`, ni « tout ce qui a changé pendant le run », qui
 * emporteraient le travail non relu d'autrui (voir `closeScoped`).
 */

/**
 * Exécute une commande git et rend sa sortie. Injectable → testable contre un vrai dépôt.
 * `env` s'ajoute à l'environnement du processus, pour CETTE commande seulement.
 */
export type GitRunner = (
  args: string[],
  cwd: string,
  options?: { env?: Record<string, string> }
) => Promise<string>

/**
 * L'interrupteur « Enchaînement auto » sur ON VAUT ACCORD de publier sur la branche courante
 * (conv-267, 2026-10-11, choix utilisateur : « Interrupteur ON = mon accord : publie directement sur
 * main, sans PR »). Le garde-fou agent du dépôt (`.githooks/pre-push`) refuse tout push de l'app sur
 * main et nomme lui-même son exception assumée : `ALLOW_MAIN_PUSH=1`. Sans elle, mesuré ce jour-là :
 * 26 branches auto/… poussées, 0 PR ouverte (`gh` absent), main distant figé depuis 02:22.
 * Un dépôt dont le hook ignore cette variable n'en est pas affecté ; un refus du DISTANT (branche
 * protégée côté serveur) reste un refus, et l'enchaînement retombe sur la branche dédiée.
 */
const ACCORD_PUSH_DIRECT = { ALLOW_MAIN_PUSH: '1' }

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
  /** Enchaînement générique : voir `publishRunCommits`. */
  direct?: boolean
  openPr?: PrOpener
}

/**
 * Ouvre une demande de fusion `head` → `base`. Rend le lien/numéro, ou lève avec le motif.
 * Injectable → testable sans hébergeur.
 */
export type PrOpener = (input: {
  repo: string
  head: string
  base: string
  title: string
  runGit: GitRunner
}) => Promise<string>

export type AutoCloseResult =
  | {
      status: 'pushed'
      branch: string
      files: number
      /** `direct` : poussé sur la branche courante ; `pr` : branche dédiée + demande de fusion. */
      mode?: 'direct' | 'pr'
      /** Pourquoi le push direct a été refusé (règle du dépôt, retard sur le distant…). */
      directRefused?: string
      /** Lien ou numéro de la PR ouverte. */
      pr?: string
      /** PR non ouverte : motif (CLI absente, hébergeur inconnu…). La branche reste poussée. */
      prError?: string
    }
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
        /** Tour de chat : aucun de ses fichiers n'est prouvé à ce fil (voir chat-turn-publication). */
        | 'unattributed'
        /** Tour de chat : les tests de ses fichiers, rejoués avant de pousser, ne sont pas verts. */
        | 'tests-rouges'
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

/** Lignes réellement introduites par les commits d'une plage, hors en-têtes de patch. */
function addedPatchContent(patch: string): string {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('>'))
    .map((line) => line.slice(1))
    .join('\n')
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
  let indexTree: string | undefined
  let committed = false
  try {
    const scope = paths?.length ? ['--', ...paths] : []
    const changed = parsePorcelainPaths(
      await runGit(['status', '--porcelain=v1', '-z', '-uall', ...scope], repo)
    )
    if (changed.length === 0) return { status: 'skipped', reason: 'no-changes' }
    const metadataSecret = detectSecret(`${message}\n${changed.join('\n')}`)
    if (metadataSecret) {
      return { status: 'skipped', reason: 'secret-detected', detail: metadataSecret }
    }

    // Sauvegarde exacte de l'index utilisateur : l'ajout temporaire rend aussi les fichiers non
    // suivis visibles au scanner, puis `read-tree` restaure l'index sans toucher au workspace.
    indexTree = (await runGit(['write-tree'], repo)).trim()
    await runGit(paths?.length ? ['add', '--', ...paths] : ['add', '-A'], repo)
    const stagedDiff = await runGit(['diff', '--cached', indexTree, ...scope], repo)
    const secret = detectSecret(stagedDiff)
    if (secret) {
      await runGit(['read-tree', indexTree], repo)
      return { status: 'skipped', reason: 'secret-detected', detail: secret }
    }

    const baseSha = (await runGit(['rev-parse', 'HEAD'], repo)).trim()
    await runGit(
      paths?.length
        ? ['commit', '--only', '-m', message, '--', ...paths]
        : ['commit', '-m', message],
      repo
    )
    committed = true
    if (input.push === false) return { status: 'committed', files: changed.length }
    const publishedSha = (await runGit(['rev-parse', 'HEAD'], repo)).trim()
    return await publishRunCommits({
      repo,
      publication: { baseSha, publishedSha },
      branch,
      runGit,
      direct: input.direct,
      openPr: input.openPr,
      title: message
    })
  } catch (error) {
    if (indexTree && !committed) {
      try {
        await runGit(['read-tree', indexTree], repo)
      } catch {
        // L'échec reste rapporté ; cette restauration ne réécrit jamais le workspace.
      }
    }
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

async function publishRunCommits(input: {
  repo: string
  /** Plage exacte attestée par la finalisation du worktree. */
  publication: Readonly<GitPublicationRange>
  branch: string
  runGit: GitRunner
  /**
   * ENCHAÎNEMENT GÉNÉRIQUE (conv-850, choix utilisateur : « la règle dépend du repo, mais je veux
   * que ça reste générique »). Aucune liste de dépôts : c'est le DÉPÔT qui tranche par ses propres
   * règles. On tente d'abord le push sur la branche courante ; si quoi que ce soit le refuse (hook
   * pre-push, politique de branche du distant, retard non fast-forward), on retombe sur la branche
   * dédiée puis on ouvre une PR vers la branche courante.
   */
  direct?: boolean
  openPr?: PrOpener
  title?: string
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
    const finalSecret = detectSecret(await runGit(['diff', range], repo))
    const publishedMetadata = await runGit(
      ['log', '--format=raw', '--name-only', '--no-renames', '-m', range],
      repo
    )
    const historyPatch = await runGit(
      [
        'log',
        '--format=',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '-m',
        '-p',
        '--unified=0',
        '--output-indicator-new=>',
        range
      ],
      repo
    )
    const secret =
      finalSecret ??
      detectSecret(publishedMetadata) ??
      detectSecret(addedPatchContent(historyPatch))
    if (secret) return { status: 'skipped', reason: 'secret-detected', detail: secret }

    const remotes = (await runGit(['remote'], repo)).trim()
    if (!remotes) return { status: 'skipped', reason: 'no-remote' }
    let base: string | undefined
    let directRefused: string | undefined
    if (input.direct) {
      const courante = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim()
      if (courante && courante !== 'HEAD') {
        base = courante
        try {
          await runGit(['push', 'origin', `${publishedSha}:refs/heads/${courante}`], repo, {
            env: ACCORD_PUSH_DIRECT
          })
          return { status: 'pushed', branch: courante, files: files.length, mode: 'direct' }
        } catch (error) {
          directRefused = (error instanceof Error ? error.message : String(error)).slice(0, 300)
        }
      }
    }
    await runGit(['push', 'origin', `${publishedSha}:refs/heads/${branch}`], repo)
    if (!input.direct || !base) return { status: 'pushed', branch, files: files.length }
    try {
      const pr = await (input.openPr ?? openPullRequest)({
        repo,
        head: branch,
        base,
        title: input.title ?? branch,
        runGit
      })
      return { status: 'pushed', branch, files: files.length, mode: 'pr', directRefused, pr }
    } catch (error) {
      const prError = (error instanceof Error ? error.message : String(error)).slice(0, 300)
      return { status: 'pushed', branch, files: files.length, mode: 'pr', directRefused, prError }
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * PR par défaut : l'hébergeur est déduit de l'URL du distant (GitHub → `gh`, Azure DevOps → `az`).
 * Tout autre hébergeur lève : la branche reste poussée, la PR se fait à la main.
 */
export async function openPullRequest(input: {
  repo: string
  head: string
  base: string
  title: string
  runGit: GitRunner
}): Promise<string> {
  const url = (await input.runGit(['remote', 'get-url', 'origin'], input.repo)).trim()
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const body = 'Ouverte par l’enchaînement automatique d’Autowin OS après un run vert.'
  if (/github\.com/i.test(url)) {
    const { stdout } = await exec(
      'gh',
      ['pr', 'create', '--head', input.head, '--base', input.base, '--title', input.title, '--body', body],
      { cwd: input.repo, windowsHide: true, shell: process.platform === 'win32' }
    )
    return stdout.trim()
  }
  if (/dev\.azure\.com|visualstudio\.com/i.test(url)) {
    const { stdout } = await exec(
      'az',
      [
        'repos', 'pr', 'create', '--detect', 'true',
        '--source-branch', input.head, '--target-branch', input.base,
        '--title', input.title, '--description', body,
        '--query', 'pullRequestId', '--output', 'tsv'
      ],
      { cwd: input.repo, windowsHide: true, shell: process.platform === 'win32' }
    )
    return `PR ${stdout.trim()}`
  }
  throw new Error(`hébergeur non reconnu pour ouvrir une PR (${url.replace(/\/\/[^@/]*@/, '//')})`)
}

/** Compatibilité des clôtures sans attestation worktree : attribution prudente par message. */
async function publishLegacyRunCommits(input: {
  repo: string
  baseHead: string
  runId: string
  branch: string
  runGit: GitRunner
  direct?: boolean
  openPr?: PrOpener
  title?: string
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
      runGit: input.runGit,
      direct: input.direct,
      openPr: input.openPr,
      title: input.title
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
async function snapshotChangedPaths(repo: string, runGit: GitRunner): Promise<string[]> {
  try {
    return parsePorcelainPaths(await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo))
  } catch {
    return [] // dépôt illisible → aucune baseline ; le filtrage se comporte comme avant
  }
}

/**
 * Candidats au run = modifiés maintenant, mais pas déjà modifiés avant. NÉCESSAIRE, PAS SUFFISANT :
 * une autre conversation a pu les modifier pendant le run (voir `closeScoped`).
 */
function pathsFromRun(before: readonly string[], after: readonly string[]): string[] {
  const preexisting = new Set(before)
  return after.filter((path) => !preexisting.has(path))
}

/**
 * Vrai si le texte porte la ligne de provenance qu'Autowin écrit dans une note Brain déposée POUR un
 * run : bloc « Provenance Autowin (v1) », ligne `- run: <runId>` (`commands.ts`, dépôt des leçons d'un
 * run). Ligne exacte : `run-7` ne vaut pas pour `run-77`.
 */
export function porteLaProvenanceDuRun(contenu: string, runId: string): boolean {
  const id = runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^- run: ${id}[ \\t]*\\r?$`, 'm').test(contenu)
}

/** Parmi les candidats, les fichiers lisibles qui portent la provenance du run. Illisible → pas à lui. */
async function fichiersPortantLaProvenance(
  repo: string,
  candidats: readonly string[],
  runId: string
): Promise<string[]> {
  if (candidats.length === 0) return []
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const gardes: string[] = []
  for (const chemin of candidats) {
    try {
      if (porteLaProvenanceDuRun(await readFile(join(repo, chemin), 'utf8'), runId)) gardes.push(chemin)
    } catch {
      // Supprimé, dossier ou verrouillé : rien ne le rattache au run.
    }
  }
  return gardes
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

export async function defaultGitRunner(): Promise<GitRunner> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  return async (args, cwd, options) =>
    (
      await exec('git', args, {
        cwd,
        windowsHide: true,
        // Le diff entier est lu pour y chercher un secret : le plafond par défaut d'execFile (1 Mo)
        // faisait tomber toute la publication d'un gros changement (run-2be0320894d3-1, 2026-10-11).
        maxBuffer: PLAFOND_SORTIE_GIT,
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {})
      })
    ).stdout
}

/** 256 Mo : au-delà, la publication échoue en le disant plutôt que d'épuiser la mémoire. */
const PLAFOND_SORTIE_GIT = 256 * 1024 * 1024

export interface AutoCloseReport {
  runId: string
  branch: string
  project: AutoCloseResult
  /** Absent pour un tour de chat : il ne publie jamais le Brain. */
  brain?: AutoCloseResult
  at: string
  /** `chat` : fin d'un tour de chat ; absent : fin d'une tâche d'agent. */
  source?: 'chat'
  /** Fichiers du tour LAISSÉS en attente faute de preuve qu'ils appartiennent à ce fil. */
  exclus?: Array<{
    path: string
    motif:
      | 'modifie-avant-le-tour'
      | 'touche-par-un-autre-fil'
      | 'autre-fil-en-cours'
      | 'tests-rouges'
      | 'import-hors-commit'
    /** Lignes ajoutées que le fil ne réclame pas : ce qui a fait échouer la preuve par lignes. */
    lignesNonReclamees?: number
    /** Motif `tests-rouges` : les fichiers de test en échec. */
    testsEnEchec?: string[]
    /** Motif `import-hors-commit` : les fichiers locaux importés qui ne partiraient pas avec lui. */
    importsHorsCommit?: string[]
  }>
  /** Tour de chat : les tests rejoués AVANT de pousser (absent = aucune vérification branchée). */
  verification?: VerificationAvantPublication
}

/**
 * Verdict des tests rejoués par le commit automatique du chat avant de pousser.
 *  - `vert`        : la portée a joué au moins un test, tous verts → on publie ;
 *  - `echec`       : rouge, ou coupé au plafond de temps → rien n'est commité ;
 *  - `non-verifie` : aucune portée dérivable (aucun test ne juge ces fichiers) → on publie comme
 *    avant, et le rapport le DIT au lieu de se taire.
 */
export type VerificationAvantPublication =
  | {
      statut: 'vert'
      commande: string
      testsJoues: number
      /**
       * Suites rouges dans la portée complète, vertes rejouées SEULES (demande utilisateur du
       * 2026-10-01) : on publie, et le panneau les NOMME — un vert obtenu ainsi ne se tait pas.
       */
      instablesSousCharge?: string[]
      /**
       * Suites restées rouges, mais DÉJÀ rouges au dernier commit, sans échec nouveau avec les
       * fichiers du tour (conv-246) : on publie, et le panneau les NOMME.
       */
      dejaRouges?: string[]
      /** Suites rouges dans l'arbre partagé, vertes avec ce qui part : le travail d'autres fils. */
      rougesDAilleurs?: string[]
    }
  | { statut: 'echec'; commande: string; detail: string; testsEnEchec: string[] }
  | { statut: 'non-verifie'; raison: string }

/**
 * Une publication Git locale deja fusionnee ne peut etre acquittee tant que sa copie distante reste
 * rejouable. Les blocages de contenu sont terminaux et visibles dans le rapport ; un echec transport
 * ou l'absence temporaire de remote doivent au contraire rester dans le journal de reprise.
 */
export function projectPublicationNeedsRetry(report: AutoCloseReport): boolean {
  return (
    report.project.status === 'failed' ||
    (report.project.status === 'skipped' && report.project.reason === 'no-remote')
  )
}

/** Message de commit : la tâche du run, bornée, préfixée pour être reconnaissable dans l'historique. */
function autoCloseMessage(task: string, runId: string): string {
  const head = task.replace(/\s+/g, ' ').trim().slice(0, 100) || 'travail agent'
  return `auto(${runId}): ${head}`
}

/**
 * Clôture réelle d'un run vert : publie le PROJET (les commits du run) puis le BRAIN (les seules notes
 * portant la provenance du run). Chaque dépôt est indépendant : un échec côté Brain (réseau GED,
 * conflit) n'empêche pas la publication du projet.
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
  /** Enchaînement générique : push direct si le dépôt l'accepte, sinon branche dédiée + PR. */
  direct?: boolean
  openPr?: PrOpener
}): Promise<AutoCloseReport> {
  const chaine = { direct: input.direct, openPr: input.openPr }
  const runGit: GitRunner = input.runGit ?? (await defaultGitRunner())

  const branch = autoCloseBranch(input.runId)
  const message = autoCloseMessage(input.task, input.runId)

  /**
   * Publie un dépôt en n'y prenant QUE ce que le run a produit.
   *
   * « Modifié maintenant, et pas au départ du run » ne suffit PAS à dire « modifié par le run » : les
   * dépôts sont partagés entre conversations. Mesuré le 2026-10-13 : `be8c2f87 auto(run-a8a70cd0ee56-1)`
   * a commité 36 fichiers d'autres conversations, et `5089af8` côté Brain 10 notes d'autres fils (aucune
   * du run), poussées. `attribuer` garde donc, parmi ces fichiers, ceux qu'une preuve rattache au run.
   */
  const closeScoped = async (
    repo: string,
    before: readonly string[],
    baseHead: string | undefined,
    attribuer: (repo: string, candidats: readonly string[]) => Promise<string[]>
  ): Promise<AutoCloseResult> => {
    try {
      const after = parsePorcelainPaths(
        await runGit(['status', '--porcelain=v1', '-z', '-uall'], repo)
      )
      const mine = await attribuer(repo, pathsFromRun(before, after))
      // Arbre propre : le travail du run a pu être DÉJÀ commité par la fusion du worktree.
      if (mine.length === 0) {
        if (!baseHead) return { status: 'skipped', reason: 'no-changes' }
        return await publishLegacyRunCommits({
          repo,
          baseHead,
          runId: input.runId,
          branch,
          runGit,
          ...chaine,
          title: message
        })
      }
      return await autoCloseRun({ repo, branch, message, paths: mine, runGit, ...chaine })
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
        runGit,
        ...chaine,
        title: message
      })
    : await closeScoped(
        input.projectRepo,
        input.baseline?.project ?? [],
        input.baseline?.projectHead,
        // Projet : AUCUN fichier modifié de l'arbre partagé n'est à un run. Un run qui modifie du code
        // travaille dans sa copie isolée, et son travail arrive dans la base par SES commits
        // (`agent <runId>-N`), publiés plus bas par `publishLegacyRunCommits`. Un run sans copie isolée
        // est classé lecture seule : ce qu'il aurait écrit reste visible et non commité, jamais mêlé.
        async () => []
      )
  const brain: AutoCloseResult = input.recoveredWithoutBrainBaseline
    ? { status: 'skipped', reason: 'recovery-baseline-missing' }
    : await closeScoped(
        input.brainRepo,
        input.baseline?.brain ?? [],
        input.baseline?.brainHead,
        // Brain : seules les notes qui portent la provenance de CE run, écrite par l'app elle-même.
        (repo, candidats) => fichiersPortantLaProvenance(repo, candidats, input.runId)
      )

  return { runId: input.runId, branch, project, brain, at: new Date().toISOString() }
}
