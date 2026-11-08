import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { WorktreeFileChange } from '../../shared/worktree-activity-model'
import { dossierDeCopieDeTache, nomCopieAgentHeritee } from '../copies/chemins-de-copies'
import { cheminsEnCoursDans, deposerFichier, depotEnCours } from '../gel/ecriture-hors-fil'

const SAFE_ID = /^[A-Za-z0-9_-]+$/
const VERDICTS = new Set<WorktreeRunVerdict>([
  'unknown',
  'running',
  'green',
  'red',
  'cancelled',
  'interrupted'
])
const PUBLICATION_STATES = new Set<WorktreePublicationState>([
  'not-requested',
  'pending',
  'integrating',
  'published',
  'held',
  'cleanup-pending',
  'complete',
  'blocked'
])
const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i
const SAFE_BRANCH = /^(?![-.])(?!.*(?:\.\.|\/\/|@\{|[~^:?*[\]\\\s]))[A-Za-z0-9][A-Za-z0-9._/-]*$/
const VERDICT_PUBLICATIONS: Record<WorktreeRunVerdict, ReadonlySet<WorktreePublicationState>> = {
  unknown: new Set(['blocked']),
  running: new Set(['not-requested']),
  green: new Set([
    'pending',
    'integrating',
    'published',
    'held',
    'cleanup-pending',
    'complete',
    'blocked'
  ]),
  red: new Set(['not-requested']),
  cancelled: new Set(['not-requested']),
  interrupted: new Set(['not-requested', 'blocked'])
}

export type WorktreeRunVerdict =
  'unknown' | 'running' | 'green' | 'red' | 'cancelled' | 'interrupted'

export type WorktreePublicationState =
  | 'not-requested'
  | 'pending'
  | 'integrating'
  | 'published'
  | 'held'
  | 'cleanup-pending'
  | 'complete'
  | 'blocked'

export interface WorktreeRunRecord {
  /**
   * TERMINAL : les reprises automatiques sont epuisees, plus rien ne reprendra ce run tout seul.
   *
   * Marqueur DEDIE, et surtout PAS une valeur de `publication` — une premiere version l'y avait
   * mise, et a casse la reprise MANUELLE : `publication` n'est pas une etiquette, c'est le champ de
   * ROUTAGE que `retryRun` lit pour savoir dans quel etat relancer. Le detourner pour nommer une fin
   * confisquait a l'humain le bouton « reessayer » — un correctif qui retire une capacite.
   *
   * Ici la fin est nommee A COTE du routage : le run est declare abandonne par la reprise
   * automatique, son motif d'attention est conserve, et sa route de reprise reste intacte.
   */
  abandoned?: boolean
  version: 1
  repoId: string
  runId: string
  conversationId?: string
  turnId?: string
  causalWatchPaths?: string[]
  agentName: string
  role?: string
  task?: string
  worktreePath: string
  worktreeAvailable?: boolean
  baseBranch: string
  baseSha: string
  sourceSha?: string
  canonicalBaseRef?: string
  excludedDirtyFiles?: string[]
  excludedDirtyFileCount?: number
  excludedDirtyFilesTruncated?: boolean
  verdict: WorktreeRunVerdict
  publication: WorktreePublicationState
  files: WorktreeFileChange[]
  conflictFile?: string
  conflictBaseSha?: string
  conflictAgentSha?: string
  publishedSha?: string
  /** HEAD agent utilisé uniquement pour prouver/nettoyer sa copie après un commit de merge. */
  publicationAgentSha?: string
  /** SHA de la base au moment exact où le commit agent était prêt à être publié. */
  publicationBaseSha?: string
  /** Acquittement durable de la trace causale, écrit seulement après le callback réussi. */
  causalPublicationDeliveredAtMs?: number
  attentionReason?: string
  detail?: string
  retryCount?: number
  nextRetryAtMs?: number
  createdAtMs: number
  updatedAtMs: number
}

function canonicalPath(path: string): string {
  return resolve(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isSafeBranch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    SAFE_BRANCH.test(value) &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.endsWith('.lock') &&
    value.split('/').every((part) => part !== '.' && part !== '..' && !part.endsWith('.lock'))
  )
}

function isSafeRelativeFile(value: unknown): value is WorktreeFileChange {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<WorktreeFileChange>
  if (
    typeof file.path !== 'string' ||
    !file.path ||
    file.path.includes('\0') ||
    isAbsolute(file.path) ||
    file.path.split(/[\\/]/).includes('..')
  )
    return false
  return file.kind === 'add' || file.kind === 'mod' || file.kind === 'del'
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isRecord(
  value: unknown,
  cheminAttendu: (runId: string) => string | null
): value is WorktreeRunRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorktreeRunRecord>
  const attendu = typeof candidate.runId === 'string' ? cheminAttendu(candidate.runId) : null
  const validVerdict =
    typeof candidate.verdict === 'string' && VERDICTS.has(candidate.verdict as WorktreeRunVerdict)
  const validPublication =
    typeof candidate.publication === 'string' &&
    PUBLICATION_STATES.has(candidate.publication as WorktreePublicationState)
  if (!validVerdict || !validPublication) return false
  const verdict = candidate.verdict as WorktreeRunVerdict
  const publication = candidate.publication as WorktreePublicationState
  const conflictPair =
    candidate.conflictBaseSha === undefined && candidate.conflictAgentSha === undefined
      ? true
      : FULL_SHA.test(candidate.conflictBaseSha ?? '') &&
        FULL_SHA.test(candidate.conflictAgentSha ?? '') &&
        publication === 'blocked' &&
        verdict === 'green'
  const requiresPublishedSha = publication === 'published' || publication === 'cleanup-pending'
  return (
    candidate.version === 1 &&
    typeof candidate.repoId === 'string' &&
    candidate.repoId.length > 0 &&
    typeof candidate.runId === 'string' &&
    SAFE_ID.test(candidate.runId) &&
    typeof candidate.agentName === 'string' &&
    candidate.agentName.trim().length > 0 &&
    typeof candidate.worktreePath === 'string' &&
    attendu !== null &&
    canonicalPath(candidate.worktreePath) === canonicalPath(attendu) &&
    (candidate.worktreeAvailable === undefined ||
      typeof candidate.worktreeAvailable === 'boolean') &&
    isSafeBranch(candidate.baseBranch) &&
    typeof candidate.baseSha === 'string' &&
    FULL_SHA.test(candidate.baseSha) &&
    (candidate.sourceSha === undefined || FULL_SHA.test(candidate.sourceSha)) &&
    (candidate.canonicalBaseRef === undefined || isSafeBranch(candidate.canonicalBaseRef)) &&
    (candidate.excludedDirtyFiles === undefined ||
      (Array.isArray(candidate.excludedDirtyFiles) &&
        candidate.excludedDirtyFiles.length <= 500 &&
        candidate.excludedDirtyFiles.every((path) => isSafeRelativeFile({ path, kind: 'mod' })))) &&
    (candidate.excludedDirtyFileCount === undefined ||
      (Number.isInteger(candidate.excludedDirtyFileCount) &&
        candidate.excludedDirtyFileCount >= (candidate.excludedDirtyFiles?.length ?? 0))) &&
    (candidate.excludedDirtyFilesTruncated === undefined ||
      typeof candidate.excludedDirtyFilesTruncated === 'boolean') &&
    VERDICT_PUBLICATIONS[verdict].has(publication) &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isSafeRelativeFile) &&
    conflictPair &&
    (candidate.conflictFile === undefined ||
      (typeof candidate.conflictFile === 'string' &&
        isSafeRelativeFile({ path: candidate.conflictFile, kind: 'mod' }))) &&
    (candidate.publishedSha === undefined || FULL_SHA.test(candidate.publishedSha)) &&
    (candidate.publicationAgentSha === undefined || FULL_SHA.test(candidate.publicationAgentSha)) &&
    (candidate.publicationBaseSha === undefined || FULL_SHA.test(candidate.publicationBaseSha)) &&
    (candidate.causalPublicationDeliveredAtMs === undefined ||
      (Number.isFinite(candidate.causalPublicationDeliveredAtMs) &&
        candidate.causalPublicationDeliveredAtMs >= 0)) &&
    (!requiresPublishedSha || FULL_SHA.test(candidate.publishedSha ?? '')) &&
    isOptionalText(candidate.conversationId) &&
    isOptionalText(candidate.turnId) &&
    (candidate.causalWatchPaths === undefined ||
      (Array.isArray(candidate.causalWatchPaths) &&
        candidate.causalWatchPaths.length <= 16 &&
        candidate.causalWatchPaths.every(
          (path) => typeof path === 'string' && path.trim().length > 0
        ))) &&
    isOptionalText(candidate.role) &&
    isOptionalText(candidate.task) &&
    isOptionalText(candidate.attentionReason) &&
    isOptionalText(candidate.detail) &&
    (candidate.retryCount === undefined ||
      (Number.isInteger(candidate.retryCount) && candidate.retryCount >= 0)) &&
    (candidate.nextRetryAtMs === undefined ||
      (Number.isFinite(candidate.nextRetryAtMs) && candidate.nextRetryAtMs >= 0)) &&
    typeof candidate.createdAtMs === 'number' &&
    Number.isFinite(candidate.createdAtMs) &&
    candidate.createdAtMs >= 0 &&
    typeof candidate.updatedAtMs === 'number' &&
    Number.isFinite(candidate.updatedAtMs) &&
    candidate.updatedAtMs >= candidate.createdAtMs
  )
}

/**
 * Journal durable fail-closed du cycle d'un bureau agent.
 *
 * Chaque écriture passe par un temporaire renommé par-dessus l'ancienne version : le fichier est
 * toujours l'ancienne version ou la nouvelle, jamais un morceau. Les `.bak` de l'ancienne écriture
 * restent relus en secours. Après un crash, une entrée illisible ou étrangère est exposée comme
 * `unknown/blocked` : elle reste visible et ne peut jamais autoriser une publication.
 *
 * HORS DU FIL PRINCIPAL (2026-11-05) : `save` et `remove` déposent par
 * `ecriture-hors-fil.ts`. Toute relecture voit d'abord la valeur déposée et pas encore posée
 * (`depotEnCours`), puis le disque. La limite est celle de `ecriture-hors-fil.ts` : un plantage
 * brutal perd la dernière valeur pas encore posée, et le fichier garde sa version d'avant.
 */
export class WorktreeRunStateStore {
  private readonly stateRoot: string
  private readonly worktreeRoot: string
  /** Le dernier état vu par CE processus, seul à écrire ces fichiers. Voir `dernierConnu`. */
  private readonly derniers = new Map<string, WorktreeRunRecord>()

  constructor(
    root: string,
    private readonly repoId: string,
    /**
     * Sans option, les copies restent sous `root`, là où elles sont. Avec `racineCopiesDeTaches`,
     * elles sont attendues sous la racine unique : à n'activer qu'une fois la copie déplacée, sinon
     * le bureau paraîtrait absent alors qu'il est là.
     */
    private readonly options: { racineCopiesDeTaches?: string } = {}
  ) {
    this.worktreeRoot = root
    this.stateRoot = join(root, '.runs')
  }

  pathFor(runId: string): string {
    this.assertRunId(runId)
    return join(this.stateRoot, `${runId}.json`)
  }

  get(runId: string): WorktreeRunRecord | undefined {
    const path = this.pathFor(runId)
    const depot = depotEnCours(path)
    if (depot !== undefined) return depot === null ? undefined : this.interpreter(depot, runId)
    const backup = `${path}.bak`
    if (!existsSync(path) && !existsSync(backup)) return undefined
    try {
      return this.interpreter(readFileSync(existsSync(path) ? path : backup, 'utf8'), runId)
    } catch {
      return this.blocked(runId)
    }
  }

  /**
   * LA MÊME LECTURE, HORS DU FIL PRINCIPAL (conv-1368, 2026-10-31). `readFileSync` ci-dessus a figé
   * la fenêtre 23 s en 7 jours (`gels.jsonl`), dont deux fois 10 s de suite sur le même petit
   * fichier : `finalizeRecoveredAsync` le lisait, puis `persist` le relisait aussitôt.
   */
  async getAsync(runId: string): Promise<WorktreeRunRecord | undefined> {
    const path = this.pathFor(runId)
    const depot = depotEnCours(path)
    if (depot !== undefined) return depot === null ? undefined : this.interpreter(depot, runId)
    for (const source of [path, `${path}.bak`]) {
      let texte: string
      try {
        texte = await readFile(source, 'utf8')
      } catch (erreur) {
        if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') continue
        return this.blocked(runId)
      }
      const record = this.interpreter(texte, runId)
      if (record.attentionReason !== 'state-unreadable') this.derniers.set(runId, record)
      return record
    }
    return undefined
  }

  /**
   * Pour `persist` : la base de la prochaine écriture, sans relire ce que ce processus sait déjà.
   * `get` reste la vérité du disque, c'est lui qui signale un manifeste abîmé.
   */
  dernierConnu(runId: string): WorktreeRunRecord | undefined {
    return this.derniers.get(runId) ?? this.get(runId)
  }

  /** Lève sur un JSON illisible ; un contenu valide mais étranger rend l'état bloqué. */
  private interpreter(texte: string, runId: string): WorktreeRunRecord {
    try {
      const parsed = this.rebaserCheminHerite(JSON.parse(texte) as unknown, runId)
      if (
        !isRecord(parsed, (id) => this.cheminAttendu(id)) ||
        parsed.repoId !== this.repoId ||
        parsed.runId !== runId
      )
        return this.blocked(runId)
      return parsed
    } catch {
      return this.blocked(runId)
    }
  }

  list(): WorktreeRunRecord[] {
    // Un manifeste déposé par ce processus peut ne pas être encore sur le disque. On le demande à
    // l'écriture différée, pas à `derniers` : un second magasin sur le même dossier ne l'a pas vu.
    const noms = [
      ...(existsSync(this.stateRoot) ? readdirSync(this.stateRoot) : []),
      ...cheminsEnCoursDans(this.stateRoot).map((chemin) => basename(chemin))
    ]
    const ids = new Set<string>()
    for (const name of noms) {
      const id = name.match(/^([A-Za-z0-9_-]+)\.json(?:\.bak)?$/)?.[1]
      if (id) ids.add(id)
    }
    return [...ids]
      .sort()
      .filter((id) => depotEnCours(this.pathFor(id)) !== null)
      .map((id) => this.get(id) ?? this.blocked(id))
  }

  save(record: WorktreeRunRecord): void {
    this.assertRunId(record.runId)
    const localRecord = { ...record, repoId: this.repoId }
    if (!isRecord(localRecord, (id) => this.cheminAttendu(id))) {
      throw new Error(`Manifeste de bureau invalide: ${record.runId}`)
    }
    // `ecarter` : l'ancienne version passe en `.bak` avant d'être remplacée, comme l'écriture d'avant.
    // Remplacer un manifeste créé l'instant d'avant tient 20 à 28 s sur ce poste.
    deposerFichier(this.pathFor(record.runId), `${JSON.stringify(localRecord, null, 2)}\n`, {
      ecarter: true
    })
    this.derniers.set(record.runId, localRecord)
  }

  remove(runId: string): void {
    this.derniers.delete(runId)
    // Avec `ecarter`, la suppression retire aussi `.bak` : un run retiré ne revient pas par sa copie.
    deposerFichier(this.pathFor(runId), null, { ecarter: true })
  }

  /**
   * Ramène sous la racine COURANTE un `worktreePath` écrit avant un déménagement du dossier de
   * données.
   *
   * Mesuré le 2026-08-12 sur les données réelles : 52 enregistrements sur 218 étaient rendus
   * « bloqués · state-unreadable » — exactement ceux dont le chemin pointait encore vers
   * `%APPDATA%\autowin-os\worktrees\…`, l'emplacement d'avant le passage au stockage portable
   * `.autowin-data`. La migration avait recopié les fichiers sans réécrire le chemin ABSOLU
   * qu'ils portent, donc `isRecord` les rejetait définitivement, emportant du travail vert.
   * Même cicatrice que `claude-accounts.ts` : « un chemin absolu ne survit pas à un déménagement ».
   *
   * STRICT : on ne réécrit que si le dernier segment est EXACTEMENT `agent__<runId>`. Un chemin
   * qui désigne un autre bureau reste illisible — on répare un déménagement, on n'invente pas une
   * identité.
   */
  private rebaserCheminHerite(parsed: unknown, runId: string): unknown {
    if (!parsed || typeof parsed !== 'object') return parsed
    const candidat = parsed as { worktreePath?: unknown }
    if (typeof candidat.worktreePath !== 'string') return parsed
    const attendu = this.cheminAttendu(runId)
    if (attendu === null) return parsed
    if (canonicalPath(candidat.worktreePath) === canonicalPath(attendu)) return parsed
    const dernierSegment = candidat.worktreePath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop()
    if (dernierSegment !== nomCopieAgentHeritee(runId)) return parsed
    return { ...(parsed as object), worktreePath: attendu }
  }

  // fix-ok: isRecord et rebaserCheminHerite codaient en dur `worktreeRoot/agent__<runId>` ; les tests de la racine unique restaient rouges tant que ce chemin était seul accepté.
  /** Où la copie de ce run doit se trouver, selon la racine active (voir le constructeur). */
  private cheminAttendu(runId: string): string | null {
    const racine = this.options.racineCopiesDeTaches
    if (racine !== undefined) return dossierDeCopieDeTache(racine, runId)
    return join(this.worktreeRoot, nomCopieAgentHeritee(runId))
  }

  private blocked(runId: string): WorktreeRunRecord {
    const now = Date.now()
    return {
      version: 1,
      repoId: this.repoId,
      runId,
      agentName: 'Bureau récupéré',
      worktreePath: '',
      baseBranch: '',
      baseSha: '',
      verdict: 'unknown',
      publication: 'blocked',
      files: [],
      attentionReason: 'state-unreadable',
      createdAtMs: now,
      updatedAtMs: now
    }
  }

  private assertRunId(runId: string): void {
    if (!SAFE_ID.test(runId)) throw new Error(`runId invalide: ${runId}`)
  }
}
