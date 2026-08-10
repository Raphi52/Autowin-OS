import { createReadStream, existsSync, promises as fsPromises } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * Lecture (SEULE) des transcripts Claude Code — `~/.claude/projects/<projet>/<session>.jsonl`.
 * C'est la source de vérité de « tout ce que fait le modèle » : tours, tool calls,
 * screenshots consultés (Read d'images). Parse en STREAMING (fichiers jusqu'à ~25 Mo)
 * avec cache par mtime : on ne re-parse jamais un transcript inchangé.
 */

export interface SessionMeta {
  id: string
  project: string
  path: string
  sizeMb: number
  mtime: number
}

export interface SessionRef {
  id: string
  project: string
}

export interface ToolCall {
  tool: string
  /** Détail saillant de l'appel (chemin, commande, description…) — tronqué. */
  detail?: string
  ts?: string
  sidechain?: boolean
}

export interface TurnEntry {
  kind: 'user' | 'assistant'
  ts?: string
  text: string
  tools: ToolCall[]
  sidechain?: boolean
}

export interface ImageRef {
  path: string
  ts?: string
  exists: boolean
}

export interface SessionActivity {
  meta: SessionMeta
  turns: TurnEntry[]
  toolCounts: Record<string, number>
  images: ImageRef[]
  totalToolCalls: number
}

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i
const TEXT_CAP = 280
const DETAIL_CAP = 160
const SESSION_CACHE_TTL_MS = 15_000
const SESSION_SCAN_CONCURRENCY = 8
const sessionListCache = new Map<string, { expiresAt: number; sessions: SessionMeta[] }>()

export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

function retainRecent(sessions: SessionMeta[], candidate: SessionMeta, cap: number): void {
  if (cap <= 0) return
  sessions.push(candidate)
  if (sessions.length <= cap) return
  let oldest = 0
  for (let index = 1; index < sessions.length; index += 1) {
    if (sessions[index].mtime < sessions[oldest].mtime) oldest = index
  }
  sessions.splice(oldest, 1)
}

/**
 * Inventaire asynchrone et borné pour les IPC UI. Le scan ne bloque pas la boucle Electron,
 * conserve seulement les `cap` sessions les plus récentes et amortit les rafraîchissements.
 */
export async function listSessionsAsync(
  cap = 60,
  root = projectsRoot(),
  cacheTtlMs = SESSION_CACHE_TTL_MS
): Promise<SessionMeta[]> {
  const boundedCap = Math.max(0, Math.floor(cap))
  const cacheKey = `${root}\u0000${boundedCap}`
  const now = Date.now()
  const cached = sessionListCache.get(cacheKey)
  if (cacheTtlMs > 0 && cached && cached.expiresAt > now) return cached.sessions.slice()

  let projects: import('node:fs').Dirent[]
  try {
    projects = await fsPromises.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const recent: SessionMeta[] = []
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < projects.length) {
      const project = projects[cursor]
      cursor += 1
      if (!project.isDirectory()) continue
      const dir = join(root, project.name)
      let files: import('node:fs').Dirent[]
      try {
        files = await fsPromises.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
        const path = join(dir, file.name)
        try {
          const stats = await fsPromises.stat(path)
          retainRecent(
            recent,
            {
              id: basename(file.name, '.jsonl'),
              project: project.name,
              path,
              sizeMb: Math.round((stats.size / 1024 / 1024) * 10) / 10,
              mtime: stats.mtimeMs
            },
            boundedCap
          )
        } catch {
          // Fichier disparu entre l'inventaire et le stat : ignoré.
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SESSION_SCAN_CONCURRENCY, projects.length) }, async () =>
      worker()
    )
  )
  const sessions = recent.sort((a, b) => b.mtime - a.mtime)
  if (cacheTtlMs > 0)
    sessionListCache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, sessions })
  return sessions.slice()
}

export async function resolveListedSessionAsync(
  ref: SessionRef,
  cap = 60,
  root = projectsRoot()
): Promise<SessionMeta | null> {
  const sessions = await listSessionsAsync(cap, root)
  return (
    sessions.find((session) => session.id === ref.id && session.project === ref.project) ?? null
  )
}

/** Une image n'est lisible que si un transcript autorisé l'a réellement référencée. */
export async function resolveListedSessionImage(
  ref: SessionRef,
  imagePath: string,
  cap = 60,
  root = projectsRoot()
): Promise<string | null> {
  const session = await resolveListedSessionAsync(ref, cap, root)
  if (!session) return null
  const activity = await parseSession(session)
  return activity.images.some((image) => image.exists && image.path === imagePath)
    ? imagePath
    : null
}

/** Extrait le texte des blocs d'un message (string ou blocs typés). */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: string; text: string } => !!b && b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/** Détail saillant d'un tool_use : chemin > commande > description > prompt. */
function detailOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined
  const pick =
    (input.file_path as string) ||
    (input.command as string) ||
    (input.description as string) ||
    (input.pattern as string) ||
    (input.prompt as string) ||
    (input.url as string)
  if (!pick) return undefined
  const s = String(pick).replace(/\s+/g, ' ')
  return s.length > DETAIL_CAP ? `${s.slice(0, DETAIL_CAP)}…` : s
}

const cache = new Map<string, { mtime: number; data: SessionActivity }>()

/** Parse un transcript en streaming — tolérant : toute ligne/type inconnu est ignoré. */
export async function parseSession(meta: SessionMeta): Promise<SessionActivity> {
  const hit = cache.get(meta.path)
  if (hit && hit.mtime === meta.mtime) return hit.data

  const turns: TurnEntry[] = []
  const toolCounts: Record<string, number> = {}
  const images: ImageRef[] = []
  let totalToolCalls = 0

  const rl = createInterface({
    input: createReadStream(meta.path, 'utf8'),
    crlfDelay: Infinity
  })
  for await (const line of rl) {
    let e: {
      type?: string
      timestamp?: string
      isSidechain?: boolean
      isMeta?: boolean
      message?: { content?: unknown }
    }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue
    if (e.isMeta) continue
    const content = e.message?.content

    if (e.type === 'user') {
      const text = textOf(content).trim()
      // Les tool_result reviennent en événements 'user' sans texte → pas un tour humain.
      if (text) {
        turns.push({
          kind: 'user',
          ts: e.timestamp,
          text: text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text,
          tools: [],
          sidechain: e.isSidechain || undefined
        })
      }
      continue
    }

    // assistant : texte + tool calls
    const tools: ToolCall[] = []
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_use') continue
        const name = String(b.name ?? '?')
        toolCounts[name] = (toolCounts[name] ?? 0) + 1
        totalToolCalls++
        const input = b.input as Record<string, unknown> | undefined
        tools.push({
          tool: name,
          detail: detailOf(input),
          ts: e.timestamp,
          sidechain: e.isSidechain || undefined
        })
        const fp = String(input?.file_path ?? '')
        if (IMG_RE.test(fp)) {
          images.push({ path: fp, ts: e.timestamp, exists: existsSync(fp) })
        }
      }
    }
    const text = textOf(content).trim()
    if (text || tools.length > 0) {
      const prev = turns[turns.length - 1]
      // Regroupe les blocs assistant consécutifs (un « tour » lisible, pas 50 lignes).
      if (prev && prev.kind === 'assistant' && !text) {
        prev.tools.push(...tools)
      } else {
        turns.push({
          kind: 'assistant',
          ts: e.timestamp,
          text: text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text,
          tools,
          sidechain: e.isSidechain || undefined
        })
      }
    }
  }

  const data: SessionActivity = { meta, turns, toolCounts, images, totalToolCalls }
  cache.set(meta.path, { mtime: meta.mtime, data })
  return data
}
