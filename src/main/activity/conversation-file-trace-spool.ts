import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import type { ExecutionEvidence } from '../providers/types'

const SPOOL_MAX_BYTES = 4 * 1024 * 1024

export interface ConversationFileTrace {
  /** Identifiant stable d'un événement rejouable après crash. */
  eventId?: string
  timestamp: string
  conversationId: string
  turnId?: string
  workspaceRoot: string
  source: 'edit_file' | 'subagent' | 'file_command' | 'chat_tool'
  paths: string[]
  /** Empreinte du diff courant immédiatement après la mutation. */
  pathFingerprints?: Record<string, string>
  pathBaseFingerprints?: Record<string, string | null>
  pathGenerationMarkers?: Record<string, string>
  pathBaseGenerationMarkers?: Record<string, string | null>
  /** Empreintes non réversibles des lignes revendiquées par un outil d'édition, par chemin. */
  pathLineFingerprints?: Record<string, string[]>
  /**
   * Le fil a NOMMÉ ces chemins dans une commande shell d'écriture (`>`, `>>`, `tee`, `sed -i`,
   * `prettier --write`, `eslint --fix` — voir `chemins-ecrits-par-commande.ts`). Distingue un
   * fichier ÉCRIT en ligne de commande d'un fichier seulement VU changer par la comparaison
   * avant/après d'un appel au modèle.
   */
  nommeParCommande?: boolean
}

type ConversationFileTraceAppendResult = 'appended' | 'duplicate' | 'ignored' | 'failed'

function spoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'conversation-file-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function normalizedStoredPath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
}

export function workspaceTracePathKey(path: string): string {
  const normalized = normalizedStoredPath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function normalizeWorkspaceTracePath(path: string, workspaceRoot: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed)
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  const normalized = normalizedStoredPath(rel)
  return normalized.startsWith('.git/') || normalized === '.git' ? null : normalized
}

export function appendConversationFileTrace(
  trace: ConversationFileTrace,
  base = ensureAutowinAppData()
): ConversationFileTraceAppendResult {
  const paths = [...new Set(trace.paths.map(normalizedStoredPath).filter(Boolean))]
  if (!trace.conversationId.trim() || !trace.workspaceRoot.trim() || paths.length === 0)
    return 'ignored'
  try {
    const root = spoolRoot(base)
    const path = join(root, 'events.jsonl')
    const eventId = trace.eventId?.trim()
    if (
      eventId &&
      ['events.archive.jsonl', 'events.previous.jsonl', 'events.jsonl'].some((name) =>
        readFileTraces(join(root, name)).some((existing) => existing.eventId === eventId)
      )
    ) {
      return 'duplicate'
    }
    if (existsSync(path) && statSync(path).size > SPOOL_MAX_BYTES) {
      const previous = join(root, 'events.previous.jsonl')
      if (existsSync(previous)) {
        appendFileSync(join(root, 'events.archive.jsonl'), readFileSync(previous))
        rmSync(previous, { force: true })
      }
      renameSync(path, previous)
    }
    const normalizedFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = Object.entries(trace.pathFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const normalizedBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(trace.pathBaseFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const normalizedGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = Object.entries(trace.pathGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return marker ? [[path, marker]] : []
      })
    )
    const normalizedBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(trace.pathBaseGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const normalizedLineFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprints = Object.entries(trace.pathLineFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return fingerprints?.length ? [[path, fingerprints]] : []
      })
    )
    appendFileSync(
      path,
      `${JSON.stringify({
        ...trace,
        workspaceRoot: canonicalWorkspaceRoot(trace.workspaceRoot),
        paths,
        ...(Object.keys(normalizedFingerprints).length > 0
          ? { pathFingerprints: normalizedFingerprints }
          : {}),
        ...(Object.keys(normalizedBaseFingerprints).length > 0
          ? { pathBaseFingerprints: normalizedBaseFingerprints }
          : {}),
        ...(Object.keys(normalizedGenerationMarkers).length > 0
          ? { pathGenerationMarkers: normalizedGenerationMarkers }
          : {}),
        ...(Object.keys(normalizedBaseGenerationMarkers).length > 0
          ? { pathBaseGenerationMarkers: normalizedBaseGenerationMarkers }
          : {}),
        ...(Object.keys(normalizedLineFingerprints).length > 0
          ? { pathLineFingerprints: normalizedLineFingerprints }
          : {})
      })}\n`,
      'utf8'
    )
    return 'appended'
  } catch {
    // L'observabilité ne doit jamais interrompre la mutation qu'elle décrit.
    return 'failed'
  }
}

export function appendExecutionEvidenceFileTrace(
  evidence: readonly ExecutionEvidence[] | undefined,
  context: {
    conversationId: string
    turnId?: string
    workspaceRoot: string
    /** Le run est vert et publié : les chemins relatifs désignent désormais la base. */
    published?: boolean
    /** Identifiant stable de la publication ; chaque preuve reçoit un suffixe déterministe. */
    eventId?: string
  },
  base = ensureAutowinAppData()
): ConversationFileTraceAppendResult {
  const hasValidatedWorkspaceDelta = evidence?.some(
    (item) => item.ok && item.kind === 'mutation' && item.type === 'workspace_delta'
  )
  let aggregate: ConversationFileTraceAppendResult = 'ignored'
  for (const [evidenceIndex, item] of (evidence ?? []).entries()) {
    if (!item.ok || item.kind !== 'mutation') continue
    if (hasValidatedWorkspaceDelta && item.type !== 'workspace_delta') continue
    const workspaceRoot = context.published
      ? context.workspaceRoot
      : (item.workspaceRoot ?? context.workspaceRoot)
    const paths = (item.paths ?? (item.path ? [item.path] : []))
      .map((path) => normalizeWorkspaceTracePath(path, workspaceRoot))
      .filter((path): path is string => Boolean(path))
    const pathFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = Object.entries(item.pathFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const pathBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(item.pathBaseFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const pathGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = Object.entries(item.pathGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return marker ? [[path, marker]] : []
      })
    )
    const pathBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(item.pathBaseGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const pathLineFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const pathSpecific = Object.entries(item.writtenLineFingerprintsByPath ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        const fingerprints = pathSpecific ?? item.writtenLineFingerprints
        return fingerprints?.length ? [[path, fingerprints]] : []
      })
    )
    const result = appendConversationFileTrace(
      {
        ...(context.eventId ? { eventId: `${context.eventId}:${evidenceIndex}` } : {}),
        timestamp: new Date().toISOString(),
        conversationId: context.conversationId,
        ...(context.turnId ? { turnId: context.turnId } : {}),
        workspaceRoot,
        source: 'subagent',
        paths,
        ...(Object.keys(pathFingerprints).length > 0 ? { pathFingerprints } : {}),
        ...(Object.keys(pathBaseFingerprints).length > 0 ? { pathBaseFingerprints } : {}),
        ...(Object.keys(pathGenerationMarkers).length > 0 ? { pathGenerationMarkers } : {}),
        ...(Object.keys(pathBaseGenerationMarkers).length > 0 ? { pathBaseGenerationMarkers } : {}),
        ...(Object.keys(pathLineFingerprints).length > 0 ? { pathLineFingerprints } : {})
      },
      base
    )
    if (result === 'appended') aggregate = 'appended'
    else if (result === 'failed' && aggregate !== 'appended') aggregate = 'failed'
    else if (result === 'duplicate' && aggregate === 'ignored') aggregate = 'duplicate'
  }
  return aggregate
}

function readFileTraces(path: string): ConversationFileTrace[] {
  if (!existsSync(path)) return []
  const traces: ConversationFileTrace[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ConversationFileTrace
      if (
        typeof parsed.conversationId === 'string' &&
        Array.isArray(parsed.paths) &&
        parsed.paths.every((item) => typeof item === 'string')
      ) {
        traces.push(parsed)
      }
    } catch {
      // Une dernière ligne partielle après crash est ignorée.
    }
  }
  return traces
}

/**
 * TOUTES les traces de fichiers d'une conversation, archives comprises, dans l'ordre d'écriture.
 *
 * Le spool savait déjà répondre « quels fichiers pour CE tour » (`readConversationTurnFilePaths`),
 * mais rien ne rendait la conversation ENTIÈRE : le journal du chat ne pouvait donc pas montrer ce
 * que le travail avait réellement touché, alors que la matière était écrite depuis le début.
 */
export function readConversationFileTraces(
  conversationId: string,
  base = ensureAutowinAppData()
): ConversationFileTrace[] {
  const root = spoolRoot(base)
  return [
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ].filter((trace) => trace.conversationId === conversationId)
}

/**
 * Traces RÉCENTES, tous fils confondus : le journal courant et le précédent (4 Mo max chacun), sans
 * l'archive qui grossit sans borne. Lecture ASYNCHRONE : elle tourne à chaque fin de tour de chat,
 * dans le processus qui fait vivre la fenêtre. Sert à l'enchaînement du chat : savoir si un AUTRE fil
 * a touché un fichier pendant le tour, avant de publier ce fichier au nom du tour.
 */
export async function readRecentConversationFileTraces(
  base = ensureAutowinAppData()
): Promise<ConversationFileTrace[]> {
  const root = spoolRoot(base)
  const traces: ConversationFileTrace[] = []
  for (const name of ['events.previous.jsonl', 'events.jsonl']) {
    let raw: string
    try {
      raw = await readFile(join(root, name), 'utf8')
    } catch {
      continue // journal absent : rien à lire
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as ConversationFileTrace
        if (
          typeof parsed.conversationId === 'string' &&
          Array.isArray(parsed.paths) &&
          parsed.paths.every((item) => typeof item === 'string')
        )
          traces.push(parsed)
      } catch {
        // Une dernière ligne partielle après crash est ignorée.
      }
    }
  }
  return traces
}

/** Chemins absolus attribués à UN tour, pour relier une mutation à sa cause sans deviner au temps. */
export function readConversationTurnFilePaths(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): string[] {
  return readConversationTurnFileMutations(conversationId, turnId, base).paths
}

interface ConversationTurnFileMutations {
  paths: string[]
  lineFingerprintsByPath: Record<string, string[]>
  generationMarkersByPath: Record<string, string>
}

/** Attribution exacte d'un tour : chemins absolus et lignes revendiquées par ses outils d'édition. */
export function readConversationTurnFileMutations(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): ConversationTurnFileMutations {
  const root = spoolRoot(base)
  const traces = [
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ].filter((trace) => trace.conversationId === conversationId && trace.turnId === turnId)
  const lineFingerprintsByPath: Record<string, string[]> = {}
  const generationMarkersByPath: Record<string, string> = {}
  const paths = traces.flatMap((trace) =>
    trace.paths.map((path) => {
      const absolute = canonicalWorkspaceRoot(
        resolve(trace.workspaceRoot, normalizedStoredPath(path))
      )
      const fingerprints = Object.entries(trace.pathLineFingerprints ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
      )?.[1]
      if (fingerprints?.length) {
        lineFingerprintsByPath[absolute] = [
          ...(lineFingerprintsByPath[absolute] ?? []),
          ...fingerprints
        ]
      }
      const generationMarker = Object.entries(trace.pathGenerationMarkers ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
      )?.[1]
      if (generationMarker) generationMarkersByPath[absolute] = generationMarker
      return absolute
    })
  )
  return { paths: [...new Set(paths)], lineFingerprintsByPath, generationMarkersByPath }
}

interface ConversationPathOwnership {
  conversationId: string
  workspaceRoot: string
  path: string
  fingerprint?: string
  generationMarker?: string
}

/** Un fil de la génération courante d'un chemin, avec le DERNIER de ses tours qui l'a touché. */
export interface CurrentPathOwner extends ConversationPathOwnership {
  turnId?: string
  timestamp: string
}

interface PathGeneration {
  fingerprint?: string
  generationMarker?: string
  owners: Map<string, CurrentPathOwner>
}

function pathGenerationKey(workspaceRoot: string, path: string): string {
  return `${canonicalWorkspaceRoot(workspaceRoot)}\0${workspaceTracePathKey(path)}`
}

/**
 * Génération causale courante par workspace+chemin. Une chaîne before→after conserve tous ses
 * contributeurs ; une base absente ou différente ouvre une nouvelle génération et révoque l'ancienne.
 * Lue dans les DEUX sens : par fil (onglet Fichiers) et par chemin (`proprietaire_fichier`).
 */
function readCurrentPathGenerations(base: string): Map<string, PathGeneration> {
  const root = spoolRoot(base)
  const generations = new Map<string, PathGeneration>()
  const traces = [
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  for (const trace of traces) {
    if (typeof trace.workspaceRoot !== 'string') continue
    const workspaceRoot = canonicalWorkspaceRoot(trace.workspaceRoot)
    for (const path of trace.paths) {
      const normalized = normalizedStoredPath(path)
      const fingerprint = Object.entries(trace.pathFingerprints ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )?.[1]
      const baseMatch = Object.entries(trace.pathBaseFingerprints ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )
      const baseGenerationMatch = Object.entries(trace.pathBaseGenerationMarkers ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )
      const generationMarker = Object.entries(trace.pathGenerationMarkers ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )?.[1]
      const key = pathGenerationKey(workspaceRoot, normalized)
      const generation: PathGeneration = generations.get(key) ?? { owners: new Map() }
      if (
        !baseMatch ||
        !baseGenerationMatch ||
        baseMatch[1] !== generation.fingerprint ||
        baseGenerationMatch[1] !== generation.generationMarker
      ) {
        generation.owners.clear()
      }
      generation.fingerprint = fingerprint
      generation.generationMarker = generationMarker
      generation.owners.set(trace.conversationId, {
        conversationId: trace.conversationId,
        workspaceRoot,
        path: normalized,
        ...(fingerprint ? { fingerprint } : {}),
        ...(generationMarker ? { generationMarker } : {}),
        ...(trace.turnId ? { turnId: trace.turnId } : {}),
        timestamp: trace.timestamp
      })
      generations.set(key, generation)
    }
  }
  return generations
}

/** Empreinte et marqueur de la génération, qui priment sur ceux du dernier tour du fil. */
function ownerOfGeneration(generation: PathGeneration, owner: CurrentPathOwner): CurrentPathOwner {
  return {
    ...owner,
    ...(generation.fingerprint ? { fingerprint: generation.fingerprint } : {}),
    ...(generation.generationMarker ? { generationMarker: generation.generationMarker } : {})
  }
}

export function readCurrentConversationPathOwnership(
  conversationId: string,
  base = ensureAutowinAppData()
): ConversationPathOwnership[] {
  return [...readCurrentPathGenerations(base).values()].flatMap((generation) =>
    [...generation.owners.values()]
      .filter((ownership) => ownership.conversationId === conversationId)
      // Forme rendue INCHANGÉE pour l'onglet Fichiers : le tour et l'heure ne servent qu'au sens
      // « par chemin » ci-dessous.
      .map((owner): ConversationPathOwnership => {
        const {
          turnId: _turnId,
          timestamp: _timestamp,
          ...ownership
        } = ownerOfGeneration(generation, owner)
        return ownership
      })
  )
}

/**
 * L'INVERSE de `readCurrentConversationPathOwnership` : pour chaque chemin d'un workspace, TOUS les
 * fils de sa génération courante, quel que soit le fil qui demande. Scout conv-1086 : l'agent
 * refaisait le réflexe 14 à la main (514 appels git dans 143 journaux) alors que cette donnée
 * existait, lue seulement par l'interface et seulement pour le fil affiché.
 * Rendu aligné sur `paths` (même ordre, une liste — vide — par chemin).
 *
 * fix-ok: conv-1086 — `readCurrentConversationPathOwnership` filtre sur le fil qui DEMANDE, il ne
 * peut donc pas dire à conv-b que conv-a tient le fichier : ce filtre remis dans
 * proprietaire-fichier.ts donne 2 rouges sur 9 (« signale à conv-b… »). D'où la génération
 * factorisée, lue par chemin sans filtre de fil.
 */
export function readCurrentPathOwners(
  workspaceRoot: string,
  paths: readonly string[],
  base = ensureAutowinAppData()
): CurrentPathOwner[][] {
  const generations = readCurrentPathGenerations(base)
  return paths.map((path) => {
    const generation = generations.get(pathGenerationKey(workspaceRoot, normalizedStoredPath(path)))
    return generation
      ? [...generation.owners.values()].map((owner) => ownerOfGeneration(generation, owner))
      : []
  })
}
