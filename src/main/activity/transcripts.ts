import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
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

export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

/** Liste les sessions (tous projets), triées par mtime décroissant, cappées. */
export function listSessions(cap = 60, root = projectsRoot()): SessionMeta[] {
  const out: SessionMeta[] = []
  let projects: string[] = []
  try {
    projects = readdirSync(root)
  } catch {
    return [] // pas de dossier Claude Code sur ce poste
  }
  for (const project of projects) {
    const dir = join(root, project)
    let files: string[] = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const p = join(dir, f)
      try {
        const st = statSync(p)
        out.push({
          id: basename(f, '.jsonl'),
          project,
          path: p,
          sizeMb: Math.round((st.size / 1024 / 1024) * 10) / 10,
          mtime: st.mtimeMs
        })
      } catch {
        /* fichier disparu entre readdir et stat — ignoré */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, cap)
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

export interface ToolHabits {
  sessionsScanned: number
  totalToolCalls: number
  tools: Array<{ tool: string; count: number }>
  imagesConsulted: number
}

/** Habitudes d'usage : agrégat des compteurs de tools sur les N sessions récentes. */
export async function aggregateHabits(cap = 20, root = projectsRoot()): Promise<ToolHabits> {
  const sessions = listSessions(cap, root)
  const merged: Record<string, number> = {}
  let total = 0
  let imgs = 0
  for (const s of sessions) {
    const a = await parseSession(s)
    for (const [tool, n] of Object.entries(a.toolCounts)) merged[tool] = (merged[tool] ?? 0) + n
    total += a.totalToolCalls
    imgs += a.images.length
  }
  return {
    sessionsScanned: sessions.length,
    totalToolCalls: total,
    tools: Object.entries(merged)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count),
    imagesConsulted: imgs
  }
}
