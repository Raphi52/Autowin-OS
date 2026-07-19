import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { normalize, topByDegree, filterByCommunity, type RawGraph, type VizGraph } from './graph'

/**
 * Accès DISQUE aux graphes de connaissance réels (graphify) — côté main uniquement.
 * Scanne les dossiers `projects/<repo>/graphify-out/graph.json` d'un ou plusieurs
 * roots (ex. le partage Amitel Brain) et charge un graphe en le CAPANT en LOD
 * (un graphe de 56 Mo / ~45k nœuds tuerait la visu 3D — on ne renvoie que le
 * top-N par degré).
 */
export interface BrainGraphRef {
  id: string
  label: string
  path: string
  sizeMb: number
  kind: 'vault' | 'graphify'
  themes?: BrainTheme[]
}

export interface BrainTheme {
  id: string
  label: string
}

/** Métadonnées légères d'une note, disponibles même lorsqu'elle est hors LOD. */
export interface BrainNoteSearchResult {
  id: string
  label: string
  file: string
  themes: string[]
}

export const AMITEL_BRAIN_ROOT = '\\\\ged2\\rig\\Projets IA\\Amitel Brain'
export const AMITEL_BRAIN_THEMES: BrainTheme[] = [
  { id: 'category/brain', label: 'Brain' },
  { id: 'category/rig', label: 'Comprendre RIG' },
  { id: 'category/documentation', label: 'Documentation source RIG' },
  { id: 'category/procedures', label: 'Parcours et procédures des greffes' },
  { id: 'category/justice', label: 'Justice et dossiers judiciaires' },
  { id: 'category/rcs', label: 'Registre du commerce et entreprises' },
  { id: 'category/facturation', label: 'Facturation, encaissement et éditions' },
  { id: 'category/moteur-ui', label: 'Moteur d’application et écrans' },
  { id: 'category/donnees', label: 'Données et paramétrage métier' },
  { id: 'category/echanges-services', label: 'Échanges, services et traitements automatiques' },
  { id: 'category/build-diagnostic', label: 'Développer, livrer et diagnostiquer RIG' },
  { id: 'category/decisions', label: 'Décisions' },
  { id: 'category/runbooks', label: 'Runbooks' },
  { id: 'category/standards', label: 'Standards et contribution' },
  { id: 'project/rig-tv', label: 'Projet · RIG-TV' },
  { id: 'project/rig-processus', label: 'Projet · RIG Processus' },
  { id: 'project/rig-etapercs', label: 'Projet · Étapes RCS' },
  { id: 'project/rig-etapejudiciaire', label: 'Projet · Étapes judiciaires' },
  { id: 'project/rig-etapefacture', label: 'Projet · Étapes facture' },
  { id: 'project/rig-operations', label: 'Projet · Opérations' },
  { id: 'project/rig-rig_ult_metier', label: 'Projet · ULT Métier' },
  { id: 'project/rig-rig_ope_metier', label: 'Projet · OPE Métier' }
]

/** Racines par défaut où chercher des graphes graphify. */
export function defaultBrainRoots(): string[] {
  return [join(AMITEL_BRAIN_ROOT, 'projects'), join(process.env.USERPROFILE ?? '.', '.graphify')]
}

/** Découvre les graphes graphify-out/graph.json sous les roots donnés. */
export function scanBrainGraphs(
  roots: string[] = defaultBrainRoots(),
  vaultRoot = AMITEL_BRAIN_ROOT,
  includeVaultThemes = true
): BrainGraphRef[] {
  const found: BrainGraphRef[] = []
  if (existsSync(vaultRoot)) {
    found.push({
      id: 'amitel-brain',
      label: 'Amitel Brain',
      path: vaultRoot,
      sizeMb: 0,
      kind: 'vault',
      // Le catalogue fixe garde les catégories historiques ; les tags YAML
      // permettent aux nouveaux domaines (ex. theme/autowin-os) d'apparaître
      // sans nouvelle livraison de l'application.
      themes: includeVaultThemes ? vaultThemeCatalog(vaultRoot) : AMITEL_BRAIN_THEMES
    })
  }
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      const gpath = join(root, name, 'graphify-out', 'graph.json')
      if (existsSync(gpath)) {
        let sizeMb = 0
        try {
          sizeMb = Math.round(statSync(gpath).size / (1024 * 1024))
        } catch {
          /* stat impossible — laisse 0 */
        }
        const id = name.replace(/^rig-/, '')
        found.push({ id, label: id, path: gpath, sizeMb, kind: 'graphify' })
      }
    }
  }
  return found.sort((a, b) =>
    a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'vault' ? -1 : 1
  )
}

/** Plafond de sécurité sur la taille lue (évite d'avaler un fichier aberrant). */
const MAX_GRAPH_BYTES = 120 * 1024 * 1024

/**
 * Charge un graphe graphify depuis le disque, normalise, et CAPE en LOD :
 * top-N nœuds par degré (param lod, défaut 300), filtre communauté optionnel.
 */
export function loadBrainGraph(path: string, lod = 300, community?: number): VizGraph {
  if (!existsSync(path)) throw new Error(`graphe introuvable: ${path}`)
  if (statSync(path).isDirectory()) {
    const requestedRoot = realpathSync(resolve(path)).toLowerCase()
    const allowedRoot = realpathSync(resolve(AMITEL_BRAIN_ROOT)).toLowerCase()
    if (requestedRoot !== allowedRoot) throw new Error('brain vault hors périmètre autorisé')
    return loadVaultBrainGraph(path, lod)
  }
  if (statSync(path).size > MAX_GRAPH_BYTES) throw new Error('graphe trop volumineux à charger')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawGraph
  let g = normalize(raw)
  if (typeof community === 'number') g = filterByCommunity(g, community)
  // LOD : ne garde que les top-N par degré, puis les liens entre nœuds retenus.
  const keep = new Set(topByDegree(g, lod).map((n) => n.id))
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    links: g.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    totalNodes: g.nodes.length
  }
}

const SKIPPED_VAULT_DIRS = new Set(['.git', '.obsidian', 'node_modules', 'tooling'])
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g

/** Charge les notes Markdown du Brain comme un graphe navigable, sans les modifier. */
export function loadVaultBrainGraph(root: string, lod = 300): VizGraph {
  const records = vaultNoteRecords(root)
  return graphFromVaultRecords(records, lod)
}

/** Variante asynchrone : les petites notes réseau sont lues en parallèle hors du main Electron. */
export async function loadVaultBrainGraphAsync(root: string, lod = 300): Promise<VizGraph> {
  const records = await vaultNoteRecordsAsync(root)
  return graphFromVaultRecords(records, lod)
}

/** Premier lot borné pour afficher Memory avant l'indexation complète du vault. */
export async function loadVaultBrainGraphPreviewAsync(root: string, lod = 100): Promise<VizGraph> {
  const files = await markdownFilesAsync(root)
  const selectedFiles = files.slice(0, Math.max(1, Math.min(lod, 100)))
  const records = await mapWithConcurrency(selectedFiles, 32, async (file) => {
    const content = await readFile(file, 'utf8')
    const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
    const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
    return { id, file, content, label, themes: noteThemes(id, content) }
  })
  return { ...graphFromVaultRecords(records, records.length), totalNodes: files.length }
}

export async function loadBrainGraphPreviewAsync(path: string, lod = 100): Promise<VizGraph> {
  if (!existsSync(path) || !statSync(path).isDirectory()) return loadBrainGraph(path, lod)
  const requestedRoot = realpathSync(resolve(path)).toLowerCase()
  const allowedRoot = realpathSync(resolve(AMITEL_BRAIN_ROOT)).toLowerCase()
  if (requestedRoot !== allowedRoot) throw new Error('brain vault hors périmètre autorisé')
  return loadVaultBrainGraphPreviewAsync(path, lod)
}

function graphFromVaultRecords(records: VaultNoteRecord[], lod: number): VizGraph {
  const themes = themeCatalog(records)
  const ids = new Set(records.map((record) => record.id))
  const byBasename = new Map<string, string[]>()
  for (const record of records) {
    const basename = record.id.split('/').at(-1) ?? record.id
    byBasename.set(basename, [...(byBasename.get(basename) ?? []), record.id])
  }
  const links: VizGraph['links'] = []
  for (const record of records) {
    for (const match of record.content.matchAll(WIKI_LINK_RE)) {
      const target = match[1].split('|', 1)[0].split('#', 1)[0].trim().replace(/\\/g, '/')
      if (!target) continue
      const resolved = resolveWikiTarget(record.id, target, ids, byBasename)
      if (resolved) links.push({ source: record.id, target: resolved, weight: 1 })
    }
  }
  const graph: VizGraph = {
    nodes: records.map((record) => ({
      id: record.id,
      label: record.label,
      group: Math.max(
        0,
        themes.findIndex((theme) => record.themes.includes(theme.id))
      ),
      file: record.file,
      themes: record.themes
    })),
    links
  }
  const keep = new Set(topByDegree(graph, lod).map((node) => node.id))
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    links: graph.links.filter((link) => keep.has(link.source) && keep.has(link.target)),
    totalNodes: graph.nodes.length
  }
}

export async function loadBrainGraphAsync(
  path: string,
  lod = 300,
  community?: number
): Promise<VizGraph> {
  if (!existsSync(path) || !statSync(path).isDirectory()) return loadBrainGraph(path, lod, community)
  const requestedRoot = realpathSync(resolve(path)).toLowerCase()
  const allowedRoot = realpathSync(resolve(AMITEL_BRAIN_ROOT)).toLowerCase()
  if (requestedRoot !== allowedRoot) throw new Error('brain vault hors périmètre autorisé')
  return loadVaultBrainGraphAsync(path, lod)
}

/** Charge uniquement un nœud du vault et ses voisins directs. */
export function loadVaultBrainNeighborhood(root: string, nodeId: string): VizGraph {
  return graphNeighborhood(loadVaultBrainGraph(root, Number.MAX_SAFE_INTEGER), nodeId)
}

/**
 * Charge un voisinage borné depuis une source autorisée. Le renderer fusionne ce
 * delta avec son LOD courant au lieu de remplacer le graphe déjà positionné.
 */
export function loadBrainNeighborhood(path: string, nodeId: string): VizGraph {
  if (!existsSync(path)) throw new Error(`graphe introuvable: ${path}`)
  if (statSync(path).isDirectory()) {
    const requestedRoot = realpathSync(resolve(path)).toLowerCase()
    const allowedRoot = realpathSync(resolve(AMITEL_BRAIN_ROOT)).toLowerCase()
    if (requestedRoot !== allowedRoot) throw new Error('brain vault hors périmètre autorisé')
    return loadVaultBrainNeighborhood(path, nodeId)
  }
  return graphNeighborhood(loadBrainGraph(path, Number.MAX_SAFE_INTEGER), nodeId)
}

function graphNeighborhood(graph: VizGraph, nodeId: string): VizGraph {
  const keep = new Set([nodeId])
  for (const link of graph.links) {
    if (link.source === nodeId) keep.add(link.target)
    if (link.target === nodeId) keep.add(link.source)
  }
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    links: graph.links.filter((link) => keep.has(link.source) && keep.has(link.target)),
    totalNodes: graph.totalNodes ?? graph.nodes.length
  }
}

/**
 * Recherche dans les métadonnées de TOUT le vault, et non seulement dans le
 * sous-graphe LOD chargé à l'écran. Le renderer peut ensuite demander le
 * voisinage de la note trouvée sans rendre tout le Brain.
 */
export function searchVaultBrainNotes(
  root: string,
  query: string,
  limit = 40
): BrainNoteSearchResult[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized || limit <= 0) return []
  return vaultNoteRecords(root)
    .filter((record) =>
      `${record.id}\n${record.label}\n${record.themes.join('\n')}`.toLowerCase().includes(normalized)
    )
    .slice(0, limit)
    .map(({ id, label, file, themes }) => ({ id, label, file, themes }))
}

type VaultNoteRecord = BrainNoteSearchResult & { content: string }
const vaultRecordsCache = new Map<string, VaultNoteRecord[]>()
const vaultRecordsPromises = new Map<string, Promise<VaultNoteRecord[]>>()

function vaultNoteRecords(root: string): VaultNoteRecord[] {
  const cached = vaultRecordsCache.get(root)
  if (cached) return cached
  const records = markdownFiles(root).map((file) => {
    const content = readFileSync(file, 'utf8')
    const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
    const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
    return { id, file, content, label, themes: noteThemes(id, content) }
  })
  vaultRecordsCache.set(root, records)
  return records
}

async function vaultNoteRecordsAsync(root: string): Promise<VaultNoteRecord[]> {
  const cached = vaultRecordsCache.get(root)
  if (cached) return cached
  const pending = vaultRecordsPromises.get(root)
  if (pending) return pending
  const loading = (async () => {
    const files = await markdownFilesAsync(root)
    const records = await mapWithConcurrency(files, 32, async (file) => {
      const content = await readFile(file, 'utf8')
      const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
      const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
      return { id, file, content, label, themes: noteThemes(id, content) }
    })
    vaultRecordsCache.set(root, records)
    vaultRecordsPromises.delete(root)
    return records
  })()
  vaultRecordsPromises.set(root, loading)
  return loading
}

async function markdownFilesAsync(root: string): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory() && !SKIPPED_VAULT_DIRS.has(entry.name))
          return visit(join(directory, entry.name))
        if (entry.isFile() && extname(entry.name).toLowerCase() === '.md')
          return [join(directory, entry.name)]
        return []
      })
    )
    return nested.flat()
  }
  return (await visit(root)).sort()
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++
        results[index] = await map(values[index])
      }
    })
  )
  return results
}

function vaultThemeCatalog(root: string): BrainTheme[] {
  return themeCatalog(vaultNoteRecords(root))
}

export function loadBrainThemes(path: string): BrainTheme[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return []
  const requestedRoot = realpathSync(resolve(path)).toLowerCase()
  const allowedRoot = realpathSync(resolve(AMITEL_BRAIN_ROOT)).toLowerCase()
  if (requestedRoot !== allowedRoot) throw new Error('brain vault hors périmètre autorisé')
  return vaultThemeCatalog(path)
}

function themeCatalog(records: readonly Pick<VaultNoteRecord, 'themes'>[]): BrainTheme[] {
  const known = new Set(AMITEL_BRAIN_THEMES.map((theme) => theme.id))
  const dynamic = new Set<string>()
  for (const record of records) {
    for (const theme of record.themes) if (!known.has(theme)) dynamic.add(theme)
  }
  return [
    ...AMITEL_BRAIN_THEMES,
    ...[...dynamic]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ id, label: themeLabel(id) }))
  ]
}

function themeLabel(id: string): string {
  if (id === 'theme/autowin-os') return 'Autowin OS'
  return id
    .split('/')
    .at(-1)!
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

function markdownFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIPPED_VAULT_DIRS.has(entry.name))
        visit(join(directory, entry.name))
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md')
        files.push(join(directory, entry.name))
    }
  }
  visit(root)
  return files.sort()
}

function noteThemes(id: string, content: string): string[] {
  const normalizedId = id.replace(/\\/g, '/').toLowerCase()
  // Les wikilinks servent à relier les catégories, pas à les hériter implicitement.
  const semanticContent = content.replace(WIKI_LINK_RE, '')
  const haystack = `${normalizedId}\n${semanticContent}`.toLowerCase()
  const title = semanticContent.match(/^#\s+(.+)$/m)?.[1] ?? ''
  const identity = `${normalizedId}\n${title}`.toLowerCase()
  const categories = new Set<string>()
  // Le frontmatter est la source explicite de thèmes. Les règles historiques
  // ci-dessous restent un filet de sécurité pour les anciennes notes sans tag.
  for (const tag of frontmatterTags(content)) categories.add(tag)
  const add = (category: string, condition: boolean): void => {
    if (condition) categories.add(category)
  }

  add(
    'category/brain',
    /^(home|index|readme|governance|inbox\/|knowledge\/(decisions|lessons|runbooks|standards|_maps\/brain|_maps\/contribution))/.test(
      normalizedId
    )
  )
  add(
    'category/rig',
    normalizedId.startsWith('knowledge/domain/rig') ||
      normalizedId.startsWith('knowledge/_maps/rig') ||
      normalizedId.startsWith('projects/rig-')
  )
  add(
    'category/documentation',
    normalizedId.startsWith('knowledge/domain/rigapplication-documentation/')
  )
  add(
    'category/procedures',
    normalizedId.includes('/proc/') ||
      normalizedId.includes('rig-processus') ||
      /proc_|processus|workflow|parcours/.test(identity)
  )
  add(
    'category/justice',
    /judiciaire|mandataire|juridiction|proc[ée]dure collective|proc_mjud/.test(identity)
  )
  add('category/rcs', /\brcs\b|kbis|registre du commerce|immatriculation/.test(identity))
  add('category/facturation', /factur|encaissement|paiement|crystal reports|bodacc/.test(identity))
  add(
    'category/moteur-ui',
    /host|plugin|moteur graphique|rigclientaccueil|\betp_|\bope_|\bult_|[ée]cran|contr[oô]le/.test(
      haystack
    )
  )
  add(
    'category/donnees',
    /\bsql\b|base de donn[ée]es|rigdatabase|rigbasegreffe|rigmetier|\bdao\b|\borm\b|modele_/.test(
      haystack
    )
  )
  add(
    'category/echanges-services',
    /\bedi\b|amimessage|\bwcf\b|service windows|batch|supervision|[ée]change|int[ée]gration/.test(
      haystack
    )
  )
  add(
    'category/build-diagnostic',
    /build|deploy|d[ée]ploiement|azure devops|\bgac\b|debug|diagnostic|compil/.test(haystack)
  )
  add('category/decisions', normalizedId.startsWith('knowledge/decisions/'))
  add('category/runbooks', normalizedId.startsWith('knowledge/runbooks/'))
  add(
    'category/standards',
    normalizedId.startsWith('knowledge/standards/') ||
      normalizedId.startsWith('governance/') ||
      normalizedId === 'knowledge/_maps/contribution'
  )

  for (const project of [
    'rig-tv',
    'rig-processus',
    'rig-etapercs',
    'rig-etapejudiciaire',
    'rig-etapefacture',
    'rig-operations',
    'rig-rig_ult_metier',
    'rig-rig_ope_metier'
  ]) {
    add(`project/${project}`, normalizedId.startsWith(`projects/${project}/`))
  }

  const order = new Map(AMITEL_BRAIN_THEMES.map((theme, index) => [theme.id, index]))
  return [...categories].sort(
    (left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999) || left.localeCompare(right)
  )
}

function frontmatterTags(content: string): string[] {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!frontmatter) return []
  const block = frontmatter[1]
  const inline = block.match(/^tags\s*:\s*\[([^\]]*)\]\s*$/m)?.[1]
  const listed = block.match(/^tags\s*:\s*\r?\n((?:\s+-\s+[^\r\n]+\r?\n?)*)/m)?.[1]
  const candidates = inline
    ? inline.split(',')
    : listed
      ? [...listed.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => match[1])
      : []
  return candidates
    .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
    .filter((tag) => /^(?:theme|category|project)\/[a-z0-9][a-z0-9/_-]*$/i.test(tag))
}

function resolveWikiTarget(
  sourceId: string,
  target: string,
  ids: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, string[]>
): string | undefined {
  const clean = target.replace(/\.md$/i, '')
  if (ids.has(clean)) return clean
  const fromSource = join(dirname(sourceId), clean).replace(/\\/g, '/')
  if (ids.has(fromSource)) return fromSource
  const matches = byBasename.get(clean.split('/').at(-1) ?? clean)
  return matches?.length === 1 ? matches[0] : undefined
}

/** Racines autorisées en LECTURE de fichier (navigation nœud→texte, anti-traversal). */
function allowedReadRoots(): string[] {
  const home = process.env.USERPROFILE ?? '.'
  return [
    '\\\\ged2\\rig\\Projets IA\\Amitel Brain',
    join(home, '.graphify'),
    join(home, '.claude', 'runs'), // RUN.md du pipeline (vue Workflow)
    'C:\\Nouveau dossier',
    'C:\\Amitel',
    'C:\\Code RIG'
  ].map((p) => p.toLowerCase())
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024

/**
 * Lit un fichier texte pour la navigation nœud→fichier, UNIQUEMENT s'il est
 * contenu dans une racine autorisée (protection anti-path-traversal : on résout
 * le chemin réel et on vérifie le préfixe). Renvoie un extrait borné.
 */
export function readNodeFile(path: string): { path: string; content: string } {
  if (!existsSync(path)) throw new Error('fichier introuvable')
  const real = realpathSync(resolve(path)).toLowerCase()
  const insideAllowedRoot = allowedReadRoots().some((root) => {
    const remainder = relative(root, real)
    return remainder === '' || (!remainder.startsWith('..') && !isAbsolute(remainder))
  })
  if (!insideAllowedRoot) {
    throw new Error('fichier hors périmètre autorisé')
  }
  if (statSync(path).size > MAX_TEXT_BYTES) throw new Error('fichier trop volumineux')
  return { path, content: readFileSync(path, 'utf8').slice(0, 200_000) }
}
