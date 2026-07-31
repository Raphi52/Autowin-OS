import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { ArtifactKind, ChatArtifact, ProviderArtifactCandidate } from '../../shared/artifacts'
import type { ExecutionEvidence } from './types'

const MAX_INLINE_BYTES = 20 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  md: 'text/markdown',
  mdx: 'text/mdx',
  txt: 'text/plain',
  log: 'text/plain',
  patch: 'text/x-diff',
  diff: 'text/x-diff',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  mmd: 'text/x-mermaid',
  mermaid: 'text/x-mermaid',
  dot: 'text/vnd.graphviz',
  gv: 'text/vnd.graphviz',
  puml: 'text/x-plantuml',
  plantuml: 'text/x-plantuml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ipynb: 'application/x-ipynb+json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  html: 'text/html',
  htm: 'text/html',
  zip: 'application/zip',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'model/obj',
  stl: 'model/stl',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  exe: 'application/x-msdownload',
  dll: 'application/x-msdownload',
  msi: 'application/x-msi',
  com: 'application/x-msdownload'
}

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'cs',
  'java',
  'kt',
  'rs',
  'go',
  'c',
  'h',
  'cpp',
  'hpp',
  'css',
  'scss',
  'less',
  'sql',
  'sh',
  'ps1',
  'bat',
  'cmd',
  'ini',
  'env'
])

const extension = (name: string): string => extname(name).slice(1).toLowerCase()

export function artifactMimeType(name: string, supplied = ''): string {
  return (
    supplied.trim().toLowerCase() ||
    MIME_BY_EXTENSION[extension(name)] ||
    'application/octet-stream'
  )
}

export function artifactKindFor(name: string, suppliedMimeType = ''): ArtifactKind {
  const ext = extension(name)
  const mime = artifactMimeType(name, suppliedMimeType)
  if (mime === 'image/svg+xml' || ext === 'svg') return 'vector'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'text/markdown' || mime === 'text/mdx' || ext === 'md' || ext === 'mdx')
    return 'markdown'
  if (mime === 'text/x-diff' || ext === 'diff' || ext === 'patch') return 'diff'
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime.includes('opendocument.text') ||
    mime === 'application/rtf'
  )
    return 'document'
  if (
    mime.includes('presentationml') ||
    mime.includes('powerpoint') ||
    mime.includes('presentation')
  )
    return 'presentation'
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || mime.includes('spreadsheet'))
    return 'spreadsheet'
  if (
    mime === 'application/json' ||
    mime === 'application/x-ndjson' ||
    mime.includes('yaml') ||
    mime.includes('toml') ||
    mime.includes('xml')
  )
    return 'structured-data'
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') return 'table'
  if (mime.includes('mermaid') || mime.includes('graphviz') || mime.includes('plantuml'))
    return 'diagram'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/x-ipynb+json' || ext === 'ipynb') return 'notebook'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'text/html') return 'web'
  if (
    mime.includes('zip') ||
    mime.includes('tar') ||
    mime.includes('gzip') ||
    mime.includes('rar') ||
    mime.includes('7z')
  )
    return 'archive'
  if (mime.startsWith('model/') || ['glb', 'gltf', 'obj', 'stl'].includes(ext)) return 'model3d'
  if (mime.startsWith('font/') || ['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font'
  if (
    mime.includes('msdownload') ||
    mime.includes('x-msi') ||
    ['exe', 'dll', 'msi', 'com'].includes(ext)
  )
    return 'executable'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (mime.startsWith('text/')) return 'text'
  return 'binary'
}

function safeWorkspacePath(path: string, workspaceRoot?: string): string | undefined {
  if (!workspaceRoot) return undefined
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return absolute
}

function decodedSize(content: string, encoding: 'utf8' | 'base64'): number {
  return encoding === 'base64'
    ? Buffer.byteLength(content.replace(/^data:[^,]*,/, ''), 'base64')
    : Buffer.byteLength(content, 'utf8')
}

function safeRemoteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export interface ArtifactNormalizationContext {
  provider: string
  model?: string
  workspaceRoot?: string
  now?: () => number
}

export function normalizeProviderArtifacts(
  candidates: ProviderArtifactCandidate[],
  context: ArtifactNormalizationContext
): ChatArtifact[] {
  const normalized: ChatArtifact[] = []
  const seen = new Set<string>()
  for (const candidate of candidates.slice(0, 32)) {
    const path = candidate.path
      ? safeWorkspacePath(candidate.path, context.workspaceRoot)
      : undefined
    if (candidate.path && (!path || !existsSync(path) || !statSync(path).isFile())) continue
    const name = (candidate.name || (path ? basename(path) : '') || 'artefact').slice(0, 240)
    const mimeType = artifactMimeType(name, candidate.mimeType)
    const kind = candidate.kind ?? artifactKindFor(name, mimeType)
    const encoding =
      candidate.encoding ??
      (candidate.content !== undefined
        ? kind === 'markdown' ||
          kind === 'text' ||
          kind === 'code' ||
          kind === 'diff' ||
          kind === 'structured-data' ||
          kind === 'table' ||
          kind === 'diagram' ||
          kind === 'web' ||
          kind === 'notebook'
          ? 'utf8'
          : 'base64'
        : undefined)
    const contentSize =
      candidate.content !== undefined && encoding
        ? decodedSize(candidate.content, encoding)
        : undefined
    const size = Math.max(0, path ? statSync(path).size : (contentSize ?? candidate.size ?? 0))
    const content =
      candidate.content !== undefined && (contentSize ?? 0) <= MAX_INLINE_BYTES
        ? candidate.content.replace(/^data:[^,]*,/, '')
        : undefined
    const url = safeRemoteUrl(candidate.url)
    if (!path && content === undefined && !url) continue
    const digest = createHash('sha256')
      .update(
        [
          context.provider,
          context.model ?? '',
          name,
          mimeType,
          path ?? '',
          url ?? '',
          content ? content.slice(0, 4096) : '',
          String(size)
        ].join('\u0000')
      )
      .digest('hex')
      .slice(0, 24)
    const id = candidate.id?.trim().slice(0, 160) || `artifact-${digest}`
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      name,
      mimeType,
      kind,
      size,
      createdAt: (context.now ?? Date.now)(),
      ...(encoding && content !== undefined ? { encoding, content } : {}),
      ...(path ? { path } : {}),
      ...(url ? { url } : {}),
      source: {
        provider: context.provider,
        ...(context.model ? { model: context.model } : {}),
        ...(candidate.tool ? { tool: candidate.tool } : {}),
        ...(path ? { originalPath: path } : {}),
        ...(url ? { url } : {})
      }
    })
  }
  return normalized
}

function baseFingerprintFor(evidence: ExecutionEvidence, path: string): string | null | undefined {
  const entries = Object.entries(evidence.pathBaseFingerprints ?? {})
  const target = path.replaceAll('\\', '/').toLowerCase()
  return entries.find(
    ([candidate]) => candidate.replaceAll('\\', '/').toLowerCase() === target
  )?.[1]
}

export function artifactsFromExecutionEvidence(
  evidence: ExecutionEvidence[],
  context: ArtifactNormalizationContext
): ChatArtifact[] {
  const candidates: ProviderArtifactCandidate[] = []
  for (const item of evidence) {
    if (!item.ok || item.kind !== 'mutation') continue
    const workspaceRoot = item.workspaceRoot ?? context.workspaceRoot
    for (const path of item.paths ?? (item.path ? [item.path] : [])) {
      const kind = artifactKindFor(path)
      const isNew = baseFingerprintFor(item, path) === null
      const isOutputFormat = !['code', 'text', 'markdown', 'diff', 'structured-data'].includes(kind)
      if (!isNew && !isOutputFormat) continue
      candidates.push({ path, tool: item.type })
    }
    if (workspaceRoot && !context.workspaceRoot) context = { ...context, workspaceRoot }
  }
  return normalizeProviderArtifacts(candidates, context)
}
