import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import {
  buildSemanticTemporalProjection,
  semanticTemporalInputDigest,
  semanticTemporalProjectionDigest,
  type SemanticTemporalEdge,
  type SemanticTemporalNode,
  type SemanticTemporalProjectionInput,
  type SemanticTemporalProjectionV1
} from './semantic-temporal-projection'

export interface SemanticTemporalStoreOptions {
  base?: string
  /** Canonical shared Brain root. The derived store is mechanically forbidden below it. */
  brainRoot: string
  /** Test seam for proving exclusive temporary-file creation. */
  temporaryId?: () => string
  /** Deterministic race injection; production callers leave this undefined. */
  testHooks?: Partial<
    Record<'beforeTemporaryOpen' | 'afterTemporaryOpen' | 'beforePublish', () => void>
  >
}

interface ProjectionCacheEntry {
  size: number
  mtimeMs: number
  ctimeMs: number
  verifiedAgainstInput: boolean
  projection: SemanticTemporalProjectionV1
}

const projectionCache = new Map<string, ProjectionCacheEntry>()

interface FileIdentity {
  dev: bigint
  ino: bigint
}

export function semanticTemporalProjectionPath(base = ensureAutowinAppData()): string {
  return join(base, 'semantic-timeline', 'projection-v1.json')
}

function isWithin(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function canonicalTarget(path: string): string {
  let existing = resolve(path)
  const missing: string[] = []
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    missing.unshift(basename(existing))
    existing = parent
  }
  const canonical = existsSync(existing) ? realpathSync.native(existing) : existing
  return resolve(canonical, ...missing)
}

function validProjection(value: unknown): value is SemanticTemporalProjectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const projection = value as Partial<SemanticTemporalProjectionV1>
  if (
    projection.schema !== 'autowin.semantic-temporal/v1' ||
    (projection.inputDigest !== undefined && !/^[a-f0-9]{64}$/.test(projection.inputDigest)) ||
    typeof projection.sourceDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(projection.sourceDigest) ||
    !Array.isArray(projection.nodes) ||
    !Array.isArray(projection.edges)
  ) {
    return false
  }
  const ids = new Set<string>()
  for (const node of projection.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || ids.has(node.id))
      return false
    ids.add(node.id)
  }
  const edgesValid = projection.edges.every(
    (edge) =>
      edge &&
      typeof edge === 'object' &&
      typeof edge.id === 'string' &&
      typeof edge.source === 'string' &&
      typeof edge.target === 'string' &&
      ids.has(edge.source) &&
      ids.has(edge.target)
  )
  return (
    edgesValid &&
    projection.sourceDigest ===
      semanticTemporalProjectionDigest(
        projection.nodes as SemanticTemporalNode[],
        projection.edges as SemanticTemporalEdge[]
      )
  )
}

function guardedPath(options: SemanticTemporalStoreOptions): string {
  const path = semanticTemporalProjectionPath(options.base)
  if (isWithin(canonicalTarget(options.brainRoot), canonicalTarget(path))) {
    throw new Error('Projection temporelle refusée dans le Brain canonique')
  }
  return path
}

function identityOf(path: string): FileIdentity {
  const stat = statSync(path, { bigint: true })
  return { dev: stat.dev, ino: stat.ino }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assertStableParent(
  path: string,
  options: SemanticTemporalStoreOptions,
  expected?: FileIdentity
): FileIdentity {
  const parent = canonicalTarget(dirname(path))
  if (isWithin(canonicalTarget(options.brainRoot), parent)) {
    throw new Error('Repertoire de projection redirige vers le Brain canonique')
  }
  const current = identityOf(parent)
  if (expected && !sameIdentity(current, expected)) {
    throw new Error('Repertoire de projection remplace pendant la publication')
  }
  return current
}

function openedTemporaryIdentity(
  descriptor: number,
  temporary: string,
  parentIdentity: FileIdentity,
  options: SemanticTemporalStoreOptions
): FileIdentity {
  assertStableParent(temporary, options, parentIdentity)
  const opened = fstatSync(descriptor, { bigint: true })
  if (!opened.isFile() || opened.nlink !== 1n) {
    throw new Error('Fichier temporaire de projection non exclusif')
  }
  const current = identityOf(temporary)
  const identity = { dev: opened.dev, ino: opened.ino }
  if (!sameIdentity(identity, current)) {
    throw new Error('Fichier temporaire de projection remplace pendant son ouverture')
  }
  if (isWithin(canonicalTarget(options.brainRoot), canonicalTarget(temporary))) {
    throw new Error('Fichier temporaire de projection redirige vers le Brain canonique')
  }
  return identity
}

function removeOwnedTemporary(
  temporary: string,
  temporaryIdentity: FileIdentity | undefined,
  parentIdentity: FileIdentity | undefined,
  options: SemanticTemporalStoreOptions
): void {
  if (!temporaryIdentity || !parentIdentity) return
  try {
    assertStableParent(temporary, options, parentIdentity)
    if (!sameIdentity(identityOf(temporary), temporaryIdentity)) return
    if (isWithin(canonicalTarget(options.brainRoot), canonicalTarget(temporary))) return
    rmSync(temporary, { force: true })
  } catch {
    // Fail closed: never remove through a path whose parent or identity changed.
  }
}

function immutableProjection(
  projection: SemanticTemporalProjectionV1
): SemanticTemporalProjectionV1 {
  for (const node of projection.nodes) {
    Object.freeze(node.source)
    Object.freeze(node)
  }
  for (const edge of projection.edges) Object.freeze(edge)
  Object.freeze(projection.nodes)
  Object.freeze(projection.edges)
  return Object.freeze(projection)
}

function cacheProjection(
  path: string,
  projection: SemanticTemporalProjectionV1,
  verifiedAgainstInput = false
): SemanticTemporalProjectionV1 {
  const { size, mtimeMs, ctimeMs } = statSync(path)
  const immutable = immutableProjection(projection)
  projectionCache.set(path, {
    size,
    mtimeMs,
    ctimeMs,
    verifiedAgainstInput,
    projection: immutable
  })
  return immutable
}

function memoryCachedProjection(path: string): ProjectionCacheEntry | undefined {
  if (!existsSync(path)) {
    projectionCache.delete(path)
    return undefined
  }
  const { size, mtimeMs, ctimeMs } = statSync(path)
  const cached = projectionCache.get(path)
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs && cached.ctimeMs === ctimeMs) {
    return cached
  }
  projectionCache.delete(path)
  return undefined
}

/** Atomic replacement of a fully rebuildable derived view. */
export function rebuildSemanticTemporalProjection(
  input: SemanticTemporalProjectionInput,
  options: SemanticTemporalStoreOptions
): SemanticTemporalProjectionV1 {
  const path = guardedPath(options)
  const inputDigest = semanticTemporalInputDigest(input)
  const memoryCached = memoryCachedProjection(path)
  if (memoryCached?.verifiedAgainstInput && memoryCached.projection.inputDigest === inputDigest) {
    return memoryCached.projection
  }
  const diskCached = readSemanticTemporalProjection(options)
  const projection = buildSemanticTemporalProjection(input, inputDigest)
  if (
    diskCached?.inputDigest === inputDigest &&
    diskCached.sourceDigest === projection.sourceDigest
  ) {
    return cacheProjection(path, projection, true)
  }
  const temporary = `${path}.${options.temporaryId?.() ?? randomUUID()}.tmp`
  let descriptor: number | undefined
  let ownsTemporary = false
  let parentIdentity: FileIdentity | undefined
  let temporaryIdentity: FileIdentity | undefined
  try {
    mkdirSync(dirname(path), { recursive: true })
    guardedPath(options)
    parentIdentity = assertStableParent(temporary, options)
    options.testHooks?.beforeTemporaryOpen?.()
    assertStableParent(temporary, options, parentIdentity)
    descriptor = openSync(temporary, 'wx', 0o600)
    ownsTemporary = true
    temporaryIdentity = openedTemporaryIdentity(descriptor, temporary, parentIdentity, options)
    options.testHooks?.afterTemporaryOpen?.()
    openedTemporaryIdentity(descriptor, temporary, parentIdentity, options)
    writeFileSync(descriptor, JSON.stringify(projection), 'utf8')
    openedTemporaryIdentity(descriptor, temporary, parentIdentity, options)
    closeSync(descriptor)
    descriptor = undefined
    options.testHooks?.beforePublish?.()
    assertStableParent(temporary, options, parentIdentity)
    if (!temporaryIdentity || !sameIdentity(identityOf(temporary), temporaryIdentity)) {
      throw new Error('Fichier temporaire de projection remplace avant publication')
    }
    guardedPath(options)
    renameSync(temporary, path)
    ownsTemporary = false
    return cacheProjection(path, projection, true)
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // Preserve the original publication error.
      }
    }
    if (ownsTemporary) {
      removeOwnedTemporary(temporary, temporaryIdentity, parentIdentity, options)
    }
    throw error
  }
}

export function readSemanticTemporalProjection(
  options: SemanticTemporalStoreOptions
): SemanticTemporalProjectionV1 | undefined {
  const path = guardedPath(options)
  const memoryCached = memoryCachedProjection(path)
  if (memoryCached) return memoryCached.projection
  if (!existsSync(path)) return undefined
  try {
    const { size, mtimeMs, ctimeMs } = statSync(path)
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!validProjection(parsed)) {
      projectionCache.delete(path)
      return undefined
    }
    const immutable = immutableProjection(parsed)
    projectionCache.set(path, {
      size,
      mtimeMs,
      ctimeMs,
      verifiedAgainstInput: false,
      projection: immutable
    })
    return immutable
  } catch {
    projectionCache.delete(path)
    return undefined
  }
}
