import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorktreeFileChange } from '../../shared/worktree-activity-model'

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
  verdict: WorktreeRunVerdict
  publication: WorktreePublicationState
  files: WorktreeFileChange[]
  conflictFile?: string
  conflictBaseSha?: string
  conflictAgentSha?: string
  publishedSha?: string
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

function isRecord(value: unknown, worktreeRoot: string): value is WorktreeRunRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorktreeRunRecord>
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
    canonicalPath(candidate.worktreePath) ===
      canonicalPath(join(worktreeRoot, `agent__${candidate.runId}`)) &&
    (candidate.worktreeAvailable === undefined ||
      typeof candidate.worktreeAvailable === 'boolean') &&
    isSafeBranch(candidate.baseBranch) &&
    typeof candidate.baseSha === 'string' &&
    FULL_SHA.test(candidate.baseSha) &&
    VERDICT_PUBLICATIONS[verdict].has(publication) &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isSafeRelativeFile) &&
    conflictPair &&
    (candidate.conflictFile === undefined ||
      (typeof candidate.conflictFile === 'string' &&
        isSafeRelativeFile({ path: candidate.conflictFile, kind: 'mod' }))) &&
    (candidate.publishedSha === undefined || FULL_SHA.test(candidate.publishedSha)) &&
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
 * Chaque écriture garde l'ancienne version en `.bak` jusqu'à ce que la nouvelle soit en place.
 * Après un crash, une entrée illisible ou étrangère est exposée comme `unknown/blocked` : elle
 * reste visible et ne peut jamais autoriser une publication.
 */
export class WorktreeRunStateStore {
  private readonly stateRoot: string
  private readonly worktreeRoot: string

  constructor(
    root: string,
    private readonly repoId: string
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
    const backup = `${path}.bak`
    if (!existsSync(path) && !existsSync(backup)) return undefined
    try {
      const source = existsSync(path) ? path : backup
      const parsed = JSON.parse(readFileSync(source, 'utf8')) as unknown
      if (
        !isRecord(parsed, this.worktreeRoot) ||
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
    if (!existsSync(this.stateRoot)) return []
    const ids = readdirSync(this.stateRoot)
      .map((name) => name.match(/^([A-Za-z0-9_-]+)\.json(?:\.bak)?$/)?.[1])
      .filter((id): id is string => Boolean(id))
    return [...new Set(ids)].sort().map((id) => this.get(id) ?? this.blocked(id))
  }

  save(record: WorktreeRunRecord): void {
    this.assertRunId(record.runId)
    const localRecord = { ...record, repoId: this.repoId }
    if (!isRecord(localRecord, this.worktreeRoot)) {
      throw new Error(`Manifeste de bureau invalide: ${record.runId}`)
    }
    mkdirSync(this.stateRoot, { recursive: true })
    const path = this.pathFor(record.runId)
    const backup = `${path}.bak`
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(localRecord, null, 2)}\n`, 'utf8')
    try {
      rmSync(backup, { force: true })
      if (existsSync(path)) renameSync(path, backup)
      renameSync(temporary, path)
      rmSync(backup, { force: true })
    } catch (error) {
      rmSync(temporary, { force: true })
      if (!existsSync(path) && existsSync(backup)) renameSync(backup, path)
      throw error
    }
  }

  remove(runId: string): void {
    const path = this.pathFor(runId)
    rmSync(path, { force: true })
    rmSync(`${path}.bak`, { force: true })
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
