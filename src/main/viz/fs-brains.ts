import {
  closeSync,
  existsSync,
  fstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs'
import { readFile, readdir, realpath as realpathAsync, stat as statAsync } from 'node:fs/promises'
import { dirname, extname, join, posix, relative, resolve, win32 } from 'node:path'
import { amitelBrainRoot, amitelWorkspaces } from '../amitel-paths'
import { brainSourcePathAllowed } from '../brain-corpus-scope'
import type { BrainNavigation } from '../brain-retrieval'
import { openVaultNoteDescriptor, readVaultNote, readVaultNoteSync } from './brain-file-reader'
import {
  normalize,
  topByDegree,
  filterByCommunity,
  type RawGraph,
  type VizGraph,
  type VizNode
} from './graph'
import { foldWindowsOrdinalCase } from './windows-ordinal-case'

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
  count?: number
}

/** Métadonnées légères d'une note, disponibles même lorsqu'elle est hors LOD. */
export interface BrainNoteSearchResult {
  id: string
  label: string
  file: string
  themes: string[]
  score: number
  denseScore?: number
  lexicalScore?: number
  graphScore?: number
  fusedScore?: number
  relations: Array<{
    type: 'related' | 'supersedes' | 'contradicts' | 'caused_by' | 'links_to'
    target: string
  }>
}

interface NormalizedRetrievalPath {
  kind: 'unc' | 'volume' | 'windows' | 'path'
  value: string
  absolute: boolean
}

function normalizeRetrievalPath(path: string): NormalizedRetrievalPath {
  let slashed = path.replace(/\\/g, '/')
  if (/^\/\/[?.]\/unc\//i.test(slashed)) {
    slashed = `//${slashed.slice(8)}`
  } else if (/^\/\/[?.]\/[a-z]:\//i.test(slashed)) {
    slashed = slashed.slice(4)
  }
  if (/^\/\/[?.]\/volume\{[0-9a-f-]+\}(?:\/|$)/i.test(slashed)) {
    return {
      kind: 'volume',
      value: win32.normalize(slashed).replace(/\\/g, '/').replace(/\/$/, ''),
      absolute: true
    }
  }
  if (slashed.startsWith('//')) {
    const value = win32.normalize(slashed).replace(/\\/g, '/').replace(/\/$/, '')
    return {
      kind: value.startsWith('//') ? 'unc' : 'path',
      value,
      absolute: true
    }
  }
  if (/^[a-z]:(?:\/|$)/i.test(slashed)) {
    return {
      kind: 'windows',
      value: win32.normalize(slashed).replace(/\\/g, '/').replace(/\/$/, ''),
      absolute: true
    }
  }
  return {
    kind: 'path',
    value: slashed ? posix.normalize(slashed).replace(/\/$/, '') : '',
    absolute: slashed.startsWith('/')
  }
}

function retrievalNoteId(path: string, root?: string, stripMarkdownExtension = true): string {
  const normalizedPath = normalizeRetrievalPath(path)
  const normalizedRoot = root ? normalizeRetrievalPath(root) : undefined
  const pathIdentity = foldWindowsOrdinalCase(normalizedPath.value)
  const rootPrefix = normalizedRoot
    ? normalizedRoot.value.endsWith('/')
      ? normalizedRoot.value
      : `${normalizedRoot.value}/`
    : undefined
  const rootPrefixIdentity = rootPrefix ? foldWindowsOrdinalCase(rootPrefix) : undefined
  const outsideRootId = `@${normalizedPath.kind}:${normalizedPath.value}`
  let relativePath: string
  if (!normalizedRoot || !root) {
    relativePath = normalizedPath.value
  } else if (!normalizedPath.absolute) {
    const operational = operationalLocalRelative(win32.resolve(root, path), root)
    relativePath = operational === null ? outsideRootId : (operational ?? normalizedPath.value)
  } else if (
    normalizedPath.kind === normalizedRoot.kind &&
    rootPrefix &&
    rootPrefixIdentity &&
    pathIdentity.startsWith(rootPrefixIdentity)
  ) {
    const operational = operationalLocalRelative(path, root)
    relativePath =
      operational === null
        ? outsideRootId
        : (operational ?? normalizedPath.value.slice(rootPrefix.length))
  } else {
    relativePath = operationalLocalRelative(path, root) ?? outsideRootId
  }
  const id = relativePath.replace(/^\/+/, '')
  return foldWindowsOrdinalCase(stripMarkdownExtension ? id.replace(/\.md$/i, '') : id)
}

/** Identité textuelle d'une racine, sans accès disque ni résolution réseau. */
function retrievalRootId(root: string): string {
  const normalized = normalizeRetrievalPath(root)
  if (normalized.kind === 'unc') {
    return `unc:${foldWindowsOrdinalCase(normalized.value.slice(2))}`
  }
  if (normalized.kind === 'windows') {
    return `windows:${foldWindowsOrdinalCase(normalized.value)}`
  }
  if (normalized.kind === 'volume') {
    return `volume:${foldWindowsOrdinalCase(normalized.value)}`
  }
  return `path:${normalized.value}`
}

/**
 * Les namespaces drive `\\?\` / `\\.\` ne suivent pas toujours les réductions de `win32.normalize`
 * au niveau de la racine. Node peut parcourir `\\?\C:\`, mais refuse `\\?\C:`, `\\?\C:\.` et
 * `\\?\C:\Windows\..` alors que les trois se replient textuellement sur `C:`. Les accepter comme
 * alias injecterait une navigation que le worker n'a pas réellement pu lire.
 */
function unusableDeviceRoot(root: string): boolean {
  const slashed = root.replace(/\\/g, '/')
  const volumeMatch = /^(\/\/[?.]\/volume\{[0-9a-f-]+\})(.*)$/i.exec(slashed)
  if (volumeMatch) {
    if (volumeMatch[2] === '/') return false
    const normalized = win32.normalize(slashed).replace(/[\\/]+$/, '')
    const volumeRoot = win32.normalize(`${volumeMatch[1]}/`).replace(/[\\/]+$/, '')
    return foldWindowsOrdinalCase(normalized) === foldWindowsOrdinalCase(volumeRoot)
  }
  if (!/^\/\/[?.]\/[a-z]:(?:\/|$)/i.test(slashed)) return false
  const drivePath = slashed.slice(4)
  if (/^[a-z]:\/$/i.test(drivePath)) return false
  const normalized = win32.normalize(drivePath)
  return /^[a-z]:$/i.test(drivePath) || win32.parse(normalized).root === normalized
}

function isLocalDrivePath(path: string): boolean {
  const kind = normalizeRetrievalPath(path).kind
  return kind === 'windows' || kind === 'volume'
}

function ordinalPathRelative(path: string, root: string): string | null {
  const normalizedPath = normalizeRetrievalPath(path)
  const normalizedRoot = normalizeRetrievalPath(root)
  if (normalizedPath.kind !== normalizedRoot.kind) return null
  const pathSegments = normalizedPath.value.split('/')
  const rootSegments = normalizedRoot.value.split('/')
  if (
    pathSegments.length < rootSegments.length ||
    rootSegments.some(
      (segment, index) =>
        foldWindowsOrdinalCase(segment) !== foldWindowsOrdinalCase(pathSegments[index])
    )
  ) {
    return null
  }
  return pathSegments.slice(rootSegments.length).join('/')
}

/** Contenance réelle pour les alias locaux que la comparaison textuelle ne peut pas exprimer. */
function operationalLocalRelative(path: string, root: string): string | null | undefined {
  if (!isLocalDrivePath(path) || !isLocalDrivePath(root) || unusableDeviceRoot(root)) {
    return undefined
  }
  try {
    const realRoot = realpathSync.native(root)
    const realPath = realpathSync.native(path)
    return ordinalPathRelative(realPath, realRoot)
  } catch {
    return undefined
  }
}

function retrievalRootsMatch(navigationRoot: string, expectedRoot: string): boolean {
  if (unusableDeviceRoot(navigationRoot) || unusableDeviceRoot(expectedRoot)) return false
  if (retrievalRootId(navigationRoot) === retrievalRootId(expectedRoot)) return true
  // Ne jamais transformer une comparaison textuelle en accès réseau : la résolution opérationnelle
  // supplémentaire sert uniquement aux alias locaux DOS 8.3 / noms longs et aux jonctions de drive,
  // y compris sous un préfixe device réellement parcourable.
  if (!isLocalDrivePath(navigationRoot) || !isLocalDrivePath(expectedRoot)) return false
  try {
    // Les alias DOS 8.3, jonctions et noms longs ne sont comparables correctement qu'après la
    // résolution que le runtime Node applique réellement. Ce chemin n'est pris qu'après l'échec de
    // l'identité textuelle commune, donc la recherche normale n'ajoute aucun accès disque.
    return (
      retrievalRootId(realpathSync.native(navigationRoot)) ===
      retrievalRootId(realpathSync.native(expectedRoot))
    )
  } catch {
    return false
  }
}

/** Frontière synchrone commune à toutes les lectures renderer d'un vault. */
export function assertAuthorizedBrainVaultSync(
  requestedRoot: string,
  allowedRoot = AMITEL_BRAIN_ROOT
): string {
  let requestedRealRoot: string
  let allowedRealRoot: string
  try {
    requestedRealRoot = realpathSync.native(resolve(requestedRoot))
    allowedRealRoot = realpathSync.native(resolve(allowedRoot))
  } catch {
    throw new Error('brain vault hors périmètre autorisé')
  }
  if (!retrievalRootsMatch(requestedRealRoot, allowedRealRoot)) {
    throw new Error('brain vault hors périmètre autorisé')
  }
  return requestedRealRoot
}

function realPathIsWithinRoot(realPath: string, root: string): boolean {
  try {
    return ordinalPathRelative(realPath, realpathSync.native(resolve(root))) !== null
  } catch {
    return false
  }
}

interface FileIdentity {
  dev: bigint
  ino: bigint
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  try {
    const info = await statAsync(path, { bigint: true })
    if (info.dev === 0n && info.ino === 0n) return undefined
    return { dev: info.dev, ino: info.ino }
  } catch {
    return undefined
  }
}

function identitiesMatch(left?: FileIdentity, right?: FileIdentity): boolean {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

async function retrievalRootsMatchAsync(
  navigationRoot: string,
  expectedRoot: string
): Promise<boolean> {
  if (unusableDeviceRoot(navigationRoot) || unusableDeviceRoot(expectedRoot)) return false
  if (retrievalRootsMatch(navigationRoot, expectedRoot)) return true
  const [navigationIdentity, expectedIdentity] = await Promise.all([
    fileIdentity(navigationRoot),
    fileIdentity(expectedRoot)
  ])
  return identitiesMatch(navigationIdentity, expectedIdentity)
}

/** Autorise un vault avant tout appel au retrieval global, avec la même identité disque que la fusion. */
export async function assertAuthorizedBrainVaultAsync(
  requestedRoot: string,
  allowedRoot = AMITEL_BRAIN_ROOT
): Promise<string> {
  let requestedRealRoot: string
  let allowedRealRoot: string
  try {
    ;[requestedRealRoot, allowedRealRoot] = await Promise.all([
      realpathAsync(resolve(requestedRoot)),
      realpathAsync(resolve(allowedRoot))
    ])
  } catch {
    throw new Error('brain vault hors périmètre autorisé')
  }
  if (!(await retrievalRootsMatchAsync(requestedRealRoot, allowedRealRoot))) {
    throw new Error('brain vault hors périmètre autorisé')
  }
  return requestedRealRoot
}

async function operationalRelativeAsync(
  path: string,
  realRoot: string,
  rootIdentity?: FileIdentity
): Promise<string | null> {
  let realPath: string
  try {
    realPath = await realpathAsync(path)
  } catch {
    return null
  }
  const direct = ordinalPathRelative(realPath, realRoot)
  if (direct !== null) return direct
  if (!rootIdentity) return null

  const segments: string[] = []
  let cursor = realPath
  for (let depth = 0; depth < 256; depth += 1) {
    if (identitiesMatch(await fileIdentity(cursor), rootIdentity)) {
      return segments.reverse().join('/')
    }
    const parent = win32.dirname(cursor)
    if (parent === cursor) return null
    segments.push(win32.basename(cursor))
    cursor = parent
  }
  return null
}

/** Ajoute aux résultats locaux les scores signés produits par le retriever Brain. */
export function applyBrainRetrievalScores(
  results: readonly BrainNoteSearchResult[],
  navigation?: BrainNavigation,
  expectedRoot?: string
): BrainNoteSearchResult[] {
  if (
    !navigation ||
    (expectedRoot !== undefined &&
      (!navigation.root || !retrievalRootsMatch(navigation.root, expectedRoot)))
  ) {
    return results.map((result) => ({ ...result }))
  }
  const candidates = new Map(
    navigation.candidates.map((candidate) => [
      retrievalNoteId(candidate.path, navigation.root),
      candidate
    ])
  )
  return results.map((result) => {
    const candidate = candidates.get(retrievalNoteId(result.id, undefined, false))
    if (!candidate) return { ...result }
    const relations = [...result.relations]
    const seen = new Set(relations.map((relation) => `${relation.type}\0${relation.target}`))
    for (const relation of candidate.relations ?? []) {
      const key = `${relation.type}\0${relation.target}`
      if (!seen.has(key)) {
        relations.push(relation)
        seen.add(key)
      }
    }
    return {
      ...result,
      ...(candidate.denseScore !== undefined ? { denseScore: candidate.denseScore } : {}),
      ...(candidate.lexicalScore !== undefined ? { lexicalScore: candidate.lexicalScore } : {}),
      ...(candidate.graphScore !== undefined ? { graphScore: candidate.graphScore } : {}),
      ...(candidate.fusedScore !== undefined ? { fusedScore: candidate.fusedScore } : {}),
      relations
    }
  })
}

export async function applyBrainRetrievalScoresAsync(
  results: readonly BrainNoteSearchResult[],
  navigation?: BrainNavigation,
  expectedRoot?: string
): Promise<BrainNoteSearchResult[]> {
  if (!navigation?.root || !expectedRoot) {
    return applyBrainRetrievalScores(results, navigation, expectedRoot)
  }
  const navigationRoot = navigation.root
  const navigationKind = normalizeRetrievalPath(navigationRoot).kind
  const expectedKind = normalizeRetrievalPath(expectedRoot).kind
  if (navigationKind !== 'unc' && expectedKind !== 'unc') {
    return applyBrainRetrievalScores(results, navigation, expectedRoot)
  }
  if (!(await retrievalRootsMatchAsync(navigationRoot, expectedRoot))) {
    return results.map((result) => ({ ...result }))
  }
  let realRoot: string
  try {
    realRoot = await realpathAsync(navigationRoot)
  } catch {
    return results.map((result) => ({ ...result }))
  }
  const rootIdentity = await fileIdentity(realRoot)
  const candidates = (
    await mapWithConcurrency(navigation.candidates, 8, async (candidate) => {
      const candidatePath = normalizeRetrievalPath(candidate.path).absolute
        ? candidate.path
        : win32.resolve(navigationRoot, candidate.path)
      const relativePath = await operationalRelativeAsync(candidatePath, realRoot, rootIdentity)
      return relativePath === null ? undefined : { ...candidate, path: relativePath }
    })
  ).filter((candidate): candidate is BrainNavigation['candidates'][number] => Boolean(candidate))
  return applyBrainRetrievalScores(
    results,
    { ...navigation, root: expectedRoot, candidates },
    expectedRoot
  )
}

/** Racine du Brain — SOURCE UNIQUE dans `amitel-paths.ts`, surchargeable par `AMITEL_BRAIN_ROOT`. */
export const AMITEL_BRAIN_ROOT = amitelBrainRoot()
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
    const root = assertAuthorizedBrainVaultSync(path)
    return loadVaultBrainGraph(root, lod)
  }
  // Confinement (défense en profondeur, audit sécu #3) : un graphe FICHIER doit vivre sous une racine
  // de graphes légitime (defaultBrainRoots) ou le vault — sinon lecture de fichier arbitraire via IPC.
  const realFile = realpathSync.native(resolve(path))
  const underAllowedGraphRoot = [...defaultBrainRoots(), AMITEL_BRAIN_ROOT].some((root) =>
    realPathIsWithinRoot(realFile, root)
  )
  if (!underAllowedGraphRoot) throw new Error('graphe hors périmètre autorisé')
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

const SKIPPED_VAULT_DIRS = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  'tooling',
  'inbox',
  '.trash',
  'escrow'
])
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g

/** Charge les notes Markdown du Brain comme un graphe navigable, sans les modifier. */
export function loadVaultBrainGraph(root: string, lod = 300, corpus?: readonly string[]): VizGraph {
  if (corpus?.length === 0) return { nodes: [], links: [], totalNodes: 0 }
  const records = vaultNoteRecords(root, corpus)
  return graphFromVaultRecords(records, lod)
}

export function loadVaultBrainNodesForThemes(
  root: string,
  themeIds: readonly string[],
  corpus?: readonly string[]
): VizNode[] {
  const activeThemes = new Set(themeIds)
  if (activeThemes.size === 0 || corpus?.length === 0) return []
  return vaultNoteRecords(root, corpus)
    .filter((record) => record.themes.some((theme) => activeThemes.has(theme)))
    .map(({ id, label, file, themes }) => ({ id, label, file, themes, group: 0 }))
}

/** Métadonnées exhaustives des nœuds d'un thème, indépendantes du LOD 3D. */
export function loadBrainThemeNodes(
  path: string,
  themeIds: readonly string[],
  corpus?: readonly string[]
): VizNode[] {
  if (corpus?.length === 0) return []
  if (!existsSync(path)) throw new Error(`graphe introuvable: ${path}`)
  if (statSync(path).isDirectory()) {
    const root = assertAuthorizedBrainVaultSync(path)
    return loadVaultBrainNodesForThemes(root, themeIds, corpus)
  }
  const activeThemes = new Set(themeIds)
  if (activeThemes.size === 0) return []
  return loadBrainGraph(path, Number.MAX_SAFE_INTEGER).nodes.filter((node) =>
    (node.themes?.length ? node.themes : [`community/${node.group}`]).some((theme) =>
      activeThemes.has(theme)
    )
  )
}

/** Variante asynchrone : les petites notes réseau sont lues en parallèle hors du main Electron. */
export async function loadVaultBrainGraphAsync(
  root: string,
  lod = 300,
  corpus?: readonly string[]
): Promise<VizGraph> {
  if (corpus?.length === 0) return { nodes: [], links: [], totalNodes: 0 }
  const records = await vaultNoteRecordsAsync(root, corpus)
  return graphFromVaultRecords(records, lod)
}

/** Premier lot borné pour afficher Memory avant l'indexation complète du vault. */
export async function loadVaultBrainGraphPreviewAsync(
  root: string,
  lod = 100,
  corpus?: readonly string[]
): Promise<VizGraph> {
  if (corpus?.length === 0) return { nodes: [], links: [], totalNodes: 0 }
  const files = (await markdownFilesAsync(root)).filter((file) =>
    brainSourcePathAllowed(file, corpus)
  )
  const selectedFiles = files.slice(0, Math.max(1, Math.min(lod, 100)))
  const records = await mapWithConcurrency(selectedFiles, 32, async (file) => {
    const content = await readFile(file, 'utf8')
    const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
    const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
    return {
      id,
      file,
      content,
      label,
      themes: noteThemes(id, content),
      score: 0,
      relations: noteRelations(content)
    }
  })
  return { ...graphFromVaultRecords(records, records.length), totalNodes: files.length }
}

export async function loadBrainGraphPreviewAsync(
  path: string,
  lod = 100,
  corpus?: readonly string[]
): Promise<VizGraph> {
  if (!existsSync(path) || !statSync(path).isDirectory()) return loadBrainGraph(path, lod)
  const root = assertAuthorizedBrainVaultSync(path)
  return loadVaultBrainGraphPreviewAsync(root, lod, corpus)
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
    for (const relation of record.relations) {
      // Les wiki-liens sont déjà projetés ci-dessus. Ici, on conserve le type des relations
      // frontmatter explicites afin que Knowledge puisse distinguer remplacement et contradiction.
      if (relation.type === 'links_to') continue
      const resolved = resolveWikiTarget(record.id, relation.target, ids, byBasename)
      if (resolved) {
        links.push({
          source: record.id,
          target: resolved,
          weight: 1,
          relation: relation.type
        })
      }
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
  community?: number,
  corpus?: readonly string[]
): Promise<VizGraph> {
  if (!existsSync(path) || !statSync(path).isDirectory())
    return loadBrainGraph(path, lod, community)
  const root = assertAuthorizedBrainVaultSync(path)
  return loadVaultBrainGraphAsync(root, lod, corpus)
}

/** Charge uniquement un nœud du vault et ses voisins directs. */
export function loadVaultBrainNeighborhood(
  root: string,
  nodeId: string,
  corpus?: readonly string[]
): VizGraph {
  if (corpus?.length === 0) return { nodes: [], links: [], totalNodes: 0 }
  const records = vaultNoteRecords(root, corpus)
  return graphNeighborhood(graphFromVaultRecords(records, Number.MAX_SAFE_INTEGER), nodeId)
}

/**
 * Charge un voisinage borné depuis une source autorisée. Le renderer fusionne ce
 * delta avec son LOD courant au lieu de remplacer le graphe déjà positionné.
 */
export function loadBrainNeighborhood(
  path: string,
  nodeId: string,
  corpus?: readonly string[]
): VizGraph {
  if (corpus?.length === 0) return { nodes: [], links: [], totalNodes: 0 }
  if (!existsSync(path)) throw new Error(`graphe introuvable: ${path}`)
  if (statSync(path).isDirectory()) {
    const root = assertAuthorizedBrainVaultSync(path)
    return loadVaultBrainNeighborhood(root, nodeId, corpus)
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

export async function searchVaultBrainNotesAsync(
  root: string,
  query: string,
  options: {
    limit?: number
    allowedRoot?: string
    corpus?: readonly string[]
  } = {}
): Promise<BrainNoteSearchResult[]> {
  const { limit = 40, allowedRoot = AMITEL_BRAIN_ROOT, corpus } = options
  const normalized = normalizeSearchText(query)
  const tokens = normalized.split(/[^a-z0-9_.-]+/).filter((token) => token.length >= 2)
  if (!normalized || tokens.length === 0 || limit <= 0 || corpus?.length === 0) return []
  const requestedRoot = await assertAuthorizedBrainVaultAsync(root, allowedRoot)
  return rankVaultSearchResults(
    await vaultNoteRecordsAsync(requestedRoot, corpus),
    normalized,
    tokens,
    limit
  )
}

function rankVaultSearchResults(
  records: readonly VaultNoteRecord[],
  normalized: string,
  tokens: string[],
  limit: number
): BrainNoteSearchResult[] {
  return records
    .map((record) => ({ record, score: vaultSearchScore(record, normalized, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.label.localeCompare(b.record.label))
    .slice(0, limit)
    .map(({ record, score }) => ({
      id: record.id,
      label: record.label,
      file: record.file,
      themes: record.themes,
      relations: record.relations,
      score
    }))
}

type VaultNoteRecord = BrainNoteSearchResult & { content: string }
const vaultRecordsCache = new Map<string, VaultNoteRecord[]>()
const vaultRecordsPromises = new Map<string, Promise<VaultNoteRecord[]>>()

export function invalidateVaultBrainNotesCache(): void {
  vaultRecordsCache.clear()
  vaultRecordsPromises.clear()
}

function vaultRecordsKey(root: string, corpus?: readonly string[]): string {
  const scope = corpus === undefined ? '*' : JSON.stringify([...new Set(corpus)].sort())
  return `${root}\0${scope}`
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function noteRelations(content: string): BrainNoteSearchResult['relations'] {
  const relations: BrainNoteSearchResult['relations'] = []
  const seen = new Set<string>()
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)?.[1] ?? ''
  for (const type of ['related', 'supersedes', 'contradicts', 'caused_by'] as const) {
    // Seul le YAML signé fait foi : une phrase du corps ne doit jamais devenir une relation de
    // santé simplement parce qu'elle commence par `contradicts:` ou `supersedes:`.
    const raw = frontmatter.match(new RegExp(`^${type}\\s*:\\s*(.+)$`, 'mi'))?.[1] ?? ''
    for (const target of raw
      .replace(/^\[|\]$/g, '')
      .split(/[,;]/)
      .map((value) => {
        let clean = value.trim().replace(/^['"]|['"]$/g, '')
        // Le Brain partagé emploie aussi la forme wiki dans les listes YAML :
        // `supersedes: [[workflow-contribution-brain]]`. L'enveloppe de liste retirée ci-dessus
        // laisse alors `[workflow-contribution-brain]`; enlever les crochets restants préserve les
        // chemins bruts tout en rendant les deux écritures équivalentes.
        clean = clean.replace(/^\[+|\]+$/g, '')
        return clean.split('|')[0].split('#')[0].trim()
      })
      .filter(Boolean)) {
      const key = `${type}\0${target}`
      if (!seen.has(key)) {
        relations.push({ type, target })
        seen.add(key)
      }
    }
  }
  for (const match of content.matchAll(WIKI_LINK_RE)) {
    const target = (match[1] ?? '').split('|')[0].split('#')[0].trim()
    const key = `links_to\0${target}`
    if (target && !seen.has(key)) {
      relations.push({ type: 'links_to', target })
      seen.add(key)
    }
  }
  return relations
}

function vaultSearchScore(record: VaultNoteRecord, phrase: string, tokens: string[]): number {
  const id = normalizeSearchText(record.id)
  const label = normalizeSearchText(record.label)
  const themes = normalizeSearchText(record.themes.join(' '))
  const relations = normalizeSearchText(
    record.relations.map((relation) => relation.target).join(' ')
  )
  const content = normalizeSearchText(record.content)
  const all = `${id} ${label} ${themes} ${relations} ${content}`
  if (!tokens.every((token) => all.includes(token))) return 0
  let score = 0
  if (label.includes(phrase)) score += 12
  if (id.includes(phrase)) score += 8
  if (themes.includes(phrase)) score += 6
  if (relations.includes(phrase)) score += 5
  if (content.includes(phrase)) score += 4
  for (const token of tokens) {
    if (label.includes(token)) score += 4
    if (id.includes(token)) score += 3
    if (themes.includes(token)) score += 2
    if (relations.includes(token)) score += 2
    if (content.includes(token)) score += 1
  }
  return score
}

function vaultNoteRecords(root: string, corpus?: readonly string[]): VaultNoteRecord[] {
  const cacheKey = vaultRecordsKey(root, corpus)
  const cached = vaultRecordsCache.get(cacheKey)
  if (cached) return cached
  const files = markdownFiles(root).filter((file) => brainSourcePathAllowed(file, corpus))
  const records = files.map((file) => {
    const content = readVaultNoteSync(file)
    const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
    const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
    return {
      id,
      file,
      content,
      label,
      themes: noteThemes(id, content),
      score: 0,
      relations: noteRelations(content)
    }
  })
  vaultRecordsCache.set(cacheKey, records)
  return records
}

async function vaultNoteRecordsAsync(
  root: string,
  corpus?: readonly string[]
): Promise<VaultNoteRecord[]> {
  const cacheKey = vaultRecordsKey(root, corpus)
  const cached = vaultRecordsCache.get(cacheKey)
  if (cached) return cached
  const pending = vaultRecordsPromises.get(cacheKey)
  if (pending) return pending
  const loading = (async () => {
    const files = (await markdownFilesAsync(root)).filter((file) =>
      brainSourcePathAllowed(file, corpus)
    )
    const records = await mapWithConcurrency(files, 32, async (file) => {
      const content = await readVaultNote(file)
      const id = relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
      const label = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id.split('/').at(-1) ?? id
      return {
        id,
        file,
        content,
        label,
        themes: noteThemes(id, content),
        score: 0,
        relations: noteRelations(content)
      }
    })
    vaultRecordsCache.set(cacheKey, records)
    return records
  })()
  vaultRecordsPromises.set(cacheKey, loading)
  return loading.finally(() => {
    if (vaultRecordsPromises.get(cacheKey) === loading) vaultRecordsPromises.delete(cacheKey)
  })
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

function vaultThemeCatalog(root: string, corpus?: readonly string[]): BrainTheme[] {
  return themeCatalog(vaultNoteRecords(root, corpus))
}

export function loadBrainThemes(
  path: string,
  corpus?: readonly string[],
  allowedRoot = AMITEL_BRAIN_ROOT
): BrainTheme[] {
  if (corpus?.length === 0) return []
  if (!existsSync(path) || !statSync(path).isDirectory()) return []
  const root = assertAuthorizedBrainVaultSync(path, allowedRoot)
  // PAS de branche sans compteur pour `corpus === undefined`.
  //
  // Elle renvoyait `vaultThemeCatalog`, qui rend les themes SANS `count`. Depuis que la portee par
  // workspace est retiree, `undefined` est le cas NORMAL : la vue affichait donc « 0 » a gauche et
  // perdait ses etiquettes flottantes, alors que cliquer un theme surlignait toujours les bons noeuds
  // — le lien theme/notes etait intact, seul le DENOMBREMENT manquait.
  //
  // `vaultNoteRecords(root, undefined)` rend deja toutes les notes (hors quarantaine) : le comptage
  // ci-dessous fonctionne donc a l'identique, avec ou sans corpus.
  const records = vaultNoteRecords(root, corpus)
  const counts = new Map<string, number>()
  for (const record of records) {
    for (const theme of record.themes) counts.set(theme, (counts.get(theme) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => ({ id, label: themeLabel(id), count }))
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
    (left, right) =>
      (order.get(left) ?? 999) - (order.get(right) ?? 999) || left.localeCompare(right)
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
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  // `C:\Nouveau dossier` a ete RETIRE de cette liste le 2026-07-29. Ce n'etait pas un simple residu
  // de bricolage : c'est une liste blanche ANTI-TRAVERSAL, donc un nom de dossier generique y offrait
  // un droit de LECTURE sur tout ce que quiconque y deposerait. Les racines d'entreprise viennent
  // maintenant de la source unique `amitel-paths.ts`, surchargeable par environnement.
  // La racine de donnees EFFECTIVE peut etre deplacee hors de %APPDATA% (mode portable :
  // `<workspace>/.autowin-data/autowin-os`). Le main process la publie dans
  // `AUTOWIN_APP_DATA_ROOT`, heritee par le worker Brain. Sans elle, les RUN.md reellement ecrits
  // etaient refuses par cette liste blanche, qui ne connaissait que l'emplacement %APPDATA%.
  const effectiveAppDataRoot = process.env.AUTOWIN_APP_DATA_ROOT?.trim()
  return [
    amitelBrainRoot(),
    join(home, '.graphify'),
    join(home, '.claude', 'runs'), // RUN.md du pipeline (vue Workflow)
    join(appData, 'autowin-os', 'runs'), // RUN.md créés par les conversations Autowin
    ...(effectiveAppDataRoot ? [join(effectiveAppDataRoot, 'runs')] : []),
    ...amitelWorkspaces()
  ]
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024

/**
 * Lit un fichier texte pour la navigation nœud→fichier, UNIQUEMENT s'il est
 * contenu dans une racine autorisée (protection anti-path-traversal : on résout
 * le chemin réel et on vérifie le préfixe). Renvoie un extrait borné.
 */
export function readNodeFile(
  path: string,
  vaultRoot?: string,
  corpus?: readonly string[],
  allowedVaultRoot = AMITEL_BRAIN_ROOT,
  openDescriptor: (canonicalPath: string) => number = openVaultNoteDescriptor
): { path: string; content: string } {
  if (!existsSync(path)) throw new Error('fichier introuvable')
  const real = realpathSync.native(resolve(path))
  let authorizedVault: string | undefined
  if (vaultRoot !== undefined) {
    authorizedVault = assertAuthorizedBrainVaultSync(vaultRoot, allowedVaultRoot)
    if (!realPathIsWithinRoot(real, authorizedVault) || !brainSourcePathAllowed(real, corpus)) {
      throw new Error('fichier hors corpus du workspace')
    }
  }
  // `readNodeFile` sert aussi aux RUN hors Brain. En revanche, toute lecture qui tombe sous le
  // Brain canonique reste soumise au corpus, même si un ancien appelant omet `vaultRoot`.
  if (
    authorizedVault === undefined &&
    realPathIsWithinRoot(real, allowedVaultRoot) &&
    !brainSourcePathAllowed(real, corpus)
  ) {
    throw new Error('fichier hors corpus du workspace')
  }
  const insideAllowedRoot =
    (authorizedVault !== undefined && realPathIsWithinRoot(real, authorizedVault)) ||
    allowedReadRoots().some((root) => realPathIsWithinRoot(real, root))
  if (!insideAllowedRoot) {
    throw new Error('fichier hors périmètre autorisé')
  }
  // Ouvre l'objet CANONIQUE déjà autorisé, puis vérifie et lit ce même descripteur. Une junction
  // repointée après `realpathSync` ne peut ainsi ni changer le fichier lu, ni contourner la taille.
  const descriptor = openDescriptor(real)
  try {
    const reopenedReal = realpathSync.native(real)
    const openedIdentity = fstatSync(descriptor, { bigint: true })
    const namedIdentity = statSync(reopenedReal, { bigint: true })
    if (
      retrievalRootId(reopenedReal) !== retrievalRootId(real) ||
      openedIdentity.dev !== namedIdentity.dev ||
      openedIdentity.ino !== namedIdentity.ino
    ) {
      throw new Error('fichier hors périmètre autorisé — identité changée')
    }
    if (
      authorizedVault !== undefined &&
      (!realPathIsWithinRoot(reopenedReal, authorizedVault) ||
        !brainSourcePathAllowed(reopenedReal, corpus))
    ) {
      throw new Error('fichier hors corpus du workspace')
    }
    const reopenedInsideAllowedRoot =
      (authorizedVault !== undefined && realPathIsWithinRoot(reopenedReal, authorizedVault)) ||
      allowedReadRoots().some((root) => realPathIsWithinRoot(reopenedReal, root))
    if (!reopenedInsideAllowedRoot) {
      throw new Error('fichier hors périmètre autorisé')
    }
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) throw new Error('chemin autorisé non fichier')
    if (stats.size > MAX_TEXT_BYTES) throw new Error('fichier trop volumineux')
    return { path, content: readFileSync(descriptor, 'utf8').slice(0, 200_000) }
  } finally {
    closeSync(descriptor)
  }
}
