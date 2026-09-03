/**
 * BOÎTE DE RÉCEPTION du savoir — lire, dédoublonner et PROMOUVOIR les candidats de `inbox/`.
 *
 * Pourquoi (2026-08-10) : historiquement, un candidat allait dans `inbox/` et la promotion restait
 * exclusivement humaine. Or aucune surface ne permettait à l'humain
 * de promouvoir quoi que ce soit : les candidats apparaissaient dans le graphe comme des nœuds
 * indistincts, sans action. Le dépôt fonctionnait, la promotion n'existait pas.
 *
 * Deuxième constat, du même fichier (l. 368 et 658) : le garde anti-doublon du serveur compare au savoir
 * CANONIQUE INDEXÉ, au seuil `NEAR_DUP_DENSE = 0.82`. `inbox/` n'étant pas indexé, deux dépôts du même
 * fait créent deux fichiers — observé le 2026-07-30 avec deux fiches jumelles à 09:47 et 09:48. On
 * surfacie donc le quasi-jumeau AU MOMENT DE LA REVUE, là où un humain peut trancher.
 *
 * Honnêteté sur la mesure : le serveur compare des EMBEDDINGS denses. Ici, hors du serveur, on ne
 * dispose pas des vecteurs — la similarité est un cosinus LEXICAL sur sacs de mots. C'est un proxy :
 * il sert à ATTIRER L'ŒIL sur un doublon probable, jamais à décider seul. Rien n'est fusionné
 * automatiquement, aucun dépôt n'est bloqué.
 */
import {
  existsSync,
  closeSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeSync
} from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sourceLocatorProblem } from './brain-remember'
import { foldWindowsOrdinalCase } from './viz/windows-ordinal-case'

/**
 * Le renderer choisit son brain dans une liste, mais un canal IPC accepte n'importe quelle chaîne :
 * on revérifie que la racine demandée EST la racine Brain autorisée, exactement comme le font déjà
 * `loadBrainThemeNodes` et `loadBrainGraphPreviewAsync` dans `viz/fs-brains.ts`.
 */
export function assertBrainVaultRoot(requested: string, allowed: string): string {
  const real = (path: string): { canonical: string; identity: string } | null => {
    try {
      const canonical = realpathSync.native(resolve(path))
      return {
        canonical,
        identity:
          process.platform === 'win32'
            ? foldWindowsOrdinalCase(canonical.replaceAll('/', '\\'))
            : canonical
      }
    } catch {
      return null
    }
  }
  const requestedRoot = real(requested)
  const allowedRoot = real(allowed)
  if (
    requestedRoot === null ||
    allowedRoot === null ||
    requestedRoot.identity !== allowedRoot.identity
  ) {
    throw new Error('brain vault hors périmètre autorisé')
  }
  // Ne propage jamais l'alias contrôlé par l'appelant : il pourrait être repointé après l'autorisation.
  return allowedRoot.canonical
}

const INBOX_DIR = 'inbox'
const KNOWLEDGE_DIR = 'knowledge'
const TRASH_DIR = '.trash'

/**
 * Seuil d'alerte du quasi-jumeau. Aligné sur le `NEAR_DUP_DENSE = 0.82` du serveur cité par
 * `brain-remember.ts` (l. 368) pour que la revue humaine parle du même ordre de grandeur que le garde
 * canonique — sans prétendre calculer la même chose (voir l'en-tête : cosinus lexical, pas dense).
 */
export const INBOX_NEAR_DUP_SIMILARITY = 0.82

/** Ce qu'on peut dire de la source d'un candidat sans réécrire son locator. */
export interface InboxSourceSignal {
  /** Locator tel qu'écrit dans la fiche — jamais normalisé en place. */
  locator: string
  /** Problème de traçabilité, verbatim de `sourceLocatorProblem` ; absent si conforme. */
  problem?: string
  scheme?: string
  path?: string
  sha?: string
  /**
   * `absent` : le locator ne porte pas de sha (rien à comparer).
   * `unknown` : sha présent mais aucun sha courant connu pour ce chemin.
   * `current` / `stale` : comparé au sha courant du dépôt.
   */
  shaState: 'current' | 'stale' | 'unknown' | 'absent'
}

export interface InboxNearDuplicate {
  id: string
  similarity: number
  zone: 'inbox' | 'knowledge'
}

export interface InboxCandidate {
  /** Chemin relatif au brain, sans `.md` — même forme d'identifiant que les nœuds du graphe. */
  id: string
  file: string
  title: string
  type?: string
  scope?: string
  /** Extrait borné pour la liste ; le corps complet se lit à l'ouverture de la fiche. */
  body: string
  bodyTruncated: boolean
  /** Date déclarée dans le frontmatter, sinon dérivée du mtime du fichier. */
  depositedAt?: string
  ageDays?: number
  source?: InboxSourceSignal
  /** Quasi-jumeaux au-dessus du seuil, du plus proche au moins proche. */
  nearDuplicates: InboxNearDuplicate[]
  /** Quasi-jumeaux non transportés après le top-K, ventilés pour une décision honnête. */
  nearDuplicatesOmitted?: { inbox: number; knowledge: number }
  /** Comparaisons canoniques omises sans bloquer la décision humaine. */
  warnings: string[]
}

export interface ListInboxOptions {
  /** Injectable pour un âge déterministe en test. */
  now?: Date
  /** Variante groupée : un seul passage Git pour tous les chemins cités par la revue. */
  headShasFor?: (paths: readonly string[]) => ReadonlyMap<string, string | undefined>
}

const MAX_INBOX_CANDIDATES = 300
export const MAX_INBOX_FILE_BYTES = 256 * 1024
const MOVED_MARKER = '<!-- autowin-inbox-moved:'
const MAX_INBOX_BODY_PREVIEW_CHARS = 400
export const MAX_NEAR_DUPLICATES_PER_CANDIDATE = 10
const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/

function frontmatterBlock(content: string): string {
  return content.match(FRONTMATTER_RE)?.[1] ?? ''
}

function frontmatterField(block: string, field: string): string | undefined {
  const raw = block.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, 'mi'))?.[1]
  const value = raw
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
  return value || undefined
}

function bodyOf(content: string): string {
  return content
    .replace(FRONTMATTER_RE, '')
    .replace(/^#\s+.+$/m, '')
    .trim()
}

/** Extrait UTF-16 borné, sans jamais couper une paire surrogate valide. */
function bodyPreview(body: string): string {
  let preview = body.slice(0, MAX_INBOX_BODY_PREVIEW_CHARS)
  const last = preview.charCodeAt(preview.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) preview = preview.slice(0, -1)
  return preview
}

/**
 * Cosinus lexical sur une projection signée de sac de mots, de taille fixe. Les accents sont
 * neutralisés ; le nombre de dimensions et de tokens empêche un gros vocabulaire de rendre la revue
 * quadratique en mémoire ou en CPU.
 */
interface LexicalBag {
  counts: Int32Array
  norm: number
}

const LEXICAL_VECTOR_DIMENSIONS = 128
const MAX_LEXICAL_TOKENS = 4_096

function lexicalHash(token: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < token.length; index += 1) {
    hash = Math.imul(hash ^ token.charCodeAt(index), 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

function lexicalBag(text: string): LexicalBag {
  const counts = new Int32Array(LEXICAL_VECTOR_DIMENSIONS)
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  let tokenCount = 0
  for (const match of normalized.matchAll(/[a-z0-9]{2,}/g)) {
    const hash = lexicalHash(match[0])
    counts[hash & (LEXICAL_VECTOR_DIMENSIONS - 1)] +=
      (hash & LEXICAL_VECTOR_DIMENSIONS) > 0 ? 1 : -1
    tokenCount += 1
    if (tokenCount >= MAX_LEXICAL_TOKENS) break
  }
  return {
    counts,
    norm: Math.sqrt(counts.reduce((sum, count) => sum + count * count, 0))
  }
}

function lexicalBagSimilarity(left: LexicalBag, right: LexicalBag): number {
  if (left.norm === 0 || right.norm === 0) return 0
  let dot = 0
  for (let index = 0; index < LEXICAL_VECTOR_DIMENSIONS; index += 1) {
    dot += left.counts[index] * right.counts[index]
  }
  const denominator = left.norm * right.norm
  if (denominator === 0) return 0
  // Arrondi à 12 décimales AVANT bornage : sur deux textes IDENTIQUES le calcul flottant rend
  // 0.9999999999999998, et un « 100 % » affiché ne doit pas dépendre du bruit de l'arrondi machine.
  return Math.min(1, Math.round((dot / denominator) * 1e12) / 1e12)
}

/** Découpe un locator conforme sans le réécrire ; le sha n'existe que pour `git:`. */
function readSource(
  locator: string | undefined,
  headShaFor?: (path: string) => string | undefined
): InboxSourceSignal | undefined {
  if (!locator) return undefined
  const problem = sourceLocatorProblem(locator)
  if (problem) return { locator, problem, shaState: 'absent' }
  const separator = locator.indexOf(':')
  const scheme = locator.slice(0, separator).toLowerCase()
  const rest = locator.slice(separator + 1).trim()
  if (scheme !== 'git') return { locator, scheme, path: rest, shaState: 'absent' }
  const at = rest.lastIndexOf('@')
  const path = rest.slice(0, at)
  const sha = rest.slice(at + 1)
  const head = headShaFor?.(path)
  const shaState = !head
    ? 'unknown'
    : head.startsWith(sha) || sha.startsWith(head)
      ? 'current'
      : 'stale'
  return { locator, scheme, path, sha, shaState }
}

interface MarkdownScan {
  files: string[]
  truncated: boolean
}

function markdownFilesUnder(directory: string, root: string): MarkdownScan {
  if (!existsSync(directory)) return { files: [], truncated: false }
  const realRoot = realpathSync.native(root)
  const assertReadablePath = (path: string): void => {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error('lecture hors périmètre autorisé — junction ou symlink refusée')
    }
    const realPath = realpathSync.native(path)
    if (!isInside(realPath, realRoot) || realPath === realRoot) {
      throw new Error('lecture hors périmètre autorisé')
    }
  }
  const found: string[] = []
  const visit = (current: string): void => {
    if (found.length > MAX_INBOX_CANDIDATES) return
    assertReadablePath(current)
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (found.length > MAX_INBOX_CANDIDATES) return
      const child = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('lecture hors périmètre autorisé — junction ou symlink refusée')
      }
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        assertReadablePath(child)
        found.push(child)
      }
    }
  }
  visit(directory)
  const sorted = found.sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
  return {
    files: sorted.slice(0, MAX_INBOX_CANDIDATES),
    truncated: sorted.length > MAX_INBOX_CANDIDATES
  }
}

function idOf(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
}

function readInboxMarkdown(file: string): string {
  if (statSync(file).size > MAX_INBOX_FILE_BYTES) {
    throw new Error(`fiche Brain trop volumineuse (limite ${MAX_INBOX_FILE_BYTES} octets)`)
  }
  const descriptor = openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(MAX_INBOX_FILE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const chunk = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (chunk === 0) break
      bytesRead += chunk
    }
    if (bytesRead > MAX_INBOX_FILE_BYTES) {
      throw new Error(`fiche Brain trop volumineuse (limite ${MAX_INBOX_FILE_BYTES} octets)`)
    }
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Candidats de `inbox/` prêts à être revus : source, âge, et quasi-jumeaux (inbox ET canonique).
 * Lecture seule — rien n'est déplacé ici.
 */
export function listInboxCandidates(
  root: string,
  { now = new Date(), headShasFor }: ListInboxOptions = {}
): InboxCandidate[] {
  const inboxRoot = join(root, INBOX_DIR)
  const warnings: string[] = []
  const inboxScan = markdownFilesUnder(inboxRoot, root)
  if (inboxScan.truncated) {
    warnings.push(`Inbox incomplète : plus de ${MAX_INBOX_CANDIDATES} candidats`)
  }
  const raw = inboxScan.files.flatMap((file) => {
    const content = readInboxMarkdown(file)
    if (content.includes(MOVED_MARKER)) return []
    const block = frontmatterBlock(content)
    const id = idOf(root, file)
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
    const body = bodyOf(content)
    const declared = frontmatterField(block, 'date') ?? frontmatterField(block, 'deposited')
    const parsed = declared ? new Date(declared) : statSync(file).mtime
    const valid = !Number.isNaN(parsed.getTime())
    const preview = bodyPreview(body)
    return [
      {
        id,
        file,
        title: heading ?? frontmatterField(block, 'title') ?? (id.split('/').at(-1) as string),
        type: frontmatterField(block, 'type'),
        scope: frontmatterField(block, 'scope'),
        body: preview,
        bodyTruncated: preview.length < body.length,
        ...(valid
          ? {
              depositedAt: declared ?? parsed.toISOString(),
              ageDays: Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000))
            }
          : {}),
        sourceLocator: frontmatterField(block, 'source'),
        bag: lexicalBag(`${heading ?? ''} ${body}`)
      }
    ]
  })

  const gitPaths = [
    ...new Set(
      raw.flatMap(({ sourceLocator }) => {
        const source = readSource(sourceLocator)
        return source?.scheme === 'git' && source.path ? [source.path] : []
      })
    )
  ]
  const headShas = gitPaths.length > 0 ? headShasFor?.(gitPaths) : undefined
  const resolveHeadSha = (path: string): string | undefined => headShas?.get(path)

  // Le savoir CANONIQUE : le serveur, lui, ne compare que contre lui. On le lit pour pouvoir dire
  // « ce candidat existe déjà, promu » avant que l'humain ne le promeuve une seconde fois.
  const canonical: Array<{ id: string; bag: LexicalBag }> = []
  const canonicalScan = markdownFilesUnder(join(root, KNOWLEDGE_DIR), root)
  if (canonicalScan.truncated) {
    warnings.push(`Comparaison incomplète : plus de ${MAX_INBOX_CANDIDATES} fiches knowledge`)
  }
  for (const file of canonicalScan.files) {
    const id = idOf(root, file)
    try {
      const content = readInboxMarkdown(file)
      const comparable = `${content.match(/^#\s+(.+)$/m)?.[1] ?? ''} ${bodyOf(content)}`
      canonical.push({ id, bag: lexicalBag(comparable) })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      warnings.push(`Comparaison incomplète : ${id} ignorée — ${detail}`)
    }
  }

  return raw.map(({ bag, sourceLocator, ...candidate }) => {
    const nearDuplicates: InboxNearDuplicate[] = []
    for (const other of raw) {
      if (other.id === candidate.id) continue
      const similarity = lexicalBagSimilarity(bag, other.bag)
      if (similarity >= INBOX_NEAR_DUP_SIMILARITY)
        nearDuplicates.push({ id: other.id, similarity, zone: 'inbox' })
    }
    for (const promoted of canonical) {
      const similarity = lexicalBagSimilarity(bag, promoted.bag)
      if (similarity >= INBOX_NEAR_DUP_SIMILARITY)
        nearDuplicates.push({ id: promoted.id, similarity, zone: 'knowledge' })
    }
    const compareDuplicate = (a: InboxNearDuplicate, b: InboxNearDuplicate): number =>
      b.similarity - a.similarity ||
      a.id.localeCompare(b.id) ||
      (a.zone === b.zone ? 0 : a.zone === 'knowledge' ? -1 : 1)
    nearDuplicates.sort(compareDuplicate)
    const selectedDuplicates = nearDuplicates.slice(0, MAX_NEAR_DUPLICATES_PER_CANDIDATE)
    for (const preservedZone of ['knowledge', 'inbox'] as const) {
      const bestInZone = nearDuplicates.find(({ zone }) => zone === preservedZone)
      if (
        bestInZone &&
        !selectedDuplicates.some(({ zone }) => zone === preservedZone) &&
        selectedDuplicates.length > 0
      ) {
        selectedDuplicates[selectedDuplicates.length - 1] = bestInZone
        selectedDuplicates.sort(compareDuplicate)
      }
    }
    const selectedIds = new Set(selectedDuplicates.map(({ zone, id }) => `${zone}\0${id}`))
    const omitted = nearDuplicates.reduce(
      (count, duplicate) => {
        if (!selectedIds.has(`${duplicate.zone}\0${duplicate.id}`)) count[duplicate.zone] += 1
        return count
      },
      { inbox: 0, knowledge: 0 }
    )
    return {
      ...candidate,
      source: readSource(sourceLocator, resolveHeadSha),
      nearDuplicates: selectedDuplicates,
      ...((omitted.inbox > 0 || omitted.knowledge > 0) && { nearDuplicatesOmitted: omitted }),
      warnings
    }
  })
}

/** Corps complet, relu à la demande après la liste légère. */
export function readInboxCandidateBody(root: string, id: string): { id: string; body: string } {
  const file = resolveCandidate(root, id)
  const content = readInboxMarkdown(file)
  if (content.includes(MOVED_MARKER)) throw new Error(`candidat déjà déplacé : ${id}`)
  return { id: idOf(root, file), body: bodyOf(content) }
}

export interface InboxMove {
  ok: true
  from: string
  to: string
  /** Le déplacement avait déjà abouti avant un crash/retry ; aucun second fichier n'a été créé. */
  replayed?: true
}

/**
 * Résout un id de candidat en fichier RÉEL de `inbox/`. Tout ce qui sort de `inbox/` est refusé :
 * une revue de boîte de réception ne doit jamais pouvoir déplacer une fiche canonique.
 */
function resolveCandidate(root: string, id: string): string {
  return resolveMovableNote(root, id, INBOX_DIR, 'candidat')
}

function resolveMovableNote(root: string, id: string, sourceDir: string, label: string): string {
  const inboxRoot = resolve(root, sourceDir)
  const file = resolve(root, `${String(id).replace(/\.md$/i, '')}.md`)
  const inside = relative(inboxRoot, file)
  if (
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside) ||
    inside === '' ||
    resolve(inboxRoot, inside) !== file
  ) {
    throw new Error(`${label} hors de ${sourceDir}/ — refusé : ${id}`)
  }
  if (!existsSync(file)) throw new Error(`${label} introuvable : ${id}`)
  assertRealMutationPath(root, inboxRoot, file, sourceDir)
  return file
}

function isInside(realPath: string, realRoot: string): boolean {
  if (process.platform === 'win32') {
    const pathSegments = resolve(realPath).replaceAll('/', '\\').split('\\')
    const rootSegments = resolve(realRoot).replaceAll('/', '\\').split('\\')
    return (
      pathSegments.length >= rootSegments.length &&
      rootSegments.every(
        (segment, index) =>
          foldWindowsOrdinalCase(segment) === foldWindowsOrdinalCase(pathSegments[index])
      )
    )
  }
  const inside = relative(realRoot, realPath)
  return inside === '' || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`))
}

function assertRealMutationPath(
  root: string,
  directory: string,
  file: string | undefined,
  label: string
): string {
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error(`${label} hors périmètre autorisé — junction ou symlink refusée`)
  }
  const realRoot = realpathSync.native(root)
  const realDirectory = realpathSync.native(directory)
  if (!isInside(realDirectory, realRoot) || realDirectory === realRoot) {
    throw new Error(`${label} hors périmètre autorisé`)
  }
  if (!file) return realDirectory
  if (lstatSync(file).isSymbolicLink()) {
    throw new Error(`candidat hors périmètre autorisé — symlink refusé`)
  }
  const realFile = realpathSync.native(file)
  if (!isInside(realFile, realDirectory) || realFile === realDirectory) {
    throw new Error(`candidat hors périmètre autorisé`)
  }
  return realFile
}

function sameFileIdentity(descriptor: number, path: string): boolean {
  const opened = fstatSync(descriptor, { bigint: true })
  const named = statSync(path, { bigint: true })
  return opened.dev === named.dev && opened.ino === named.ino
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function assertReservedTarget(
  root: string,
  directory: string,
  expectedRealDirectory: string,
  path: string,
  descriptor: number
): void {
  const currentRealDirectory = assertRealMutationPath(root, directory, undefined, 'destination')
  const realTarget = realpathSync.native(path)
  if (
    currentRealDirectory !== expectedRealDirectory ||
    !isInside(realTarget, expectedRealDirectory) ||
    !sameFileIdentity(descriptor, path)
  ) {
    throw new Error('destination hors périmètre autorisé — identité changée')
  }
}

/** Réserve atomiquement un nom : `wx` échoue si un autre processus l'a acquis avant nous. */
function reserveTarget(
  root: string,
  directory: string,
  expectedRealDirectory: string,
  basename: string
): { path: string; descriptor: number } {
  let index = 2
  for (;;) {
    const suffix = index === 2 ? '' : `-${index - 1}`
    const path = join(directory, `${basename}${suffix}.md`)
    try {
      const descriptor = openSync(path, 'wx')
      try {
        assertReservedTarget(root, directory, expectedRealDirectory, path, descriptor)
        return { path, descriptor }
      } catch (error) {
        closeSync(descriptor)
        throw error
      }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      index += 1
    }
  }
}

/** Neutralise une cible incomplète via son handle stable, sans aucune suppression par chemin. */
function neutralizePartialTarget(descriptor: number): void {
  try {
    ftruncateSync(descriptor, 0)
    fsyncSync(descriptor)
  } catch {
    // Le fichier reste réservé et la source intacte ; on ne risque jamais de supprimer un tiers.
  }
}

function markSourceMoved(descriptor: number, originalSize: number, targetId: string): void {
  const marker = Buffer.from(`\n${MOVED_MARKER}${targetId} -->\n`, 'utf8')
  let written = 0
  while (written < marker.length) {
    written += writeSync(
      descriptor,
      marker,
      written,
      marker.length - written,
      originalSize + written
    )
  }
  fsyncSync(descriptor)
}

function copyDescriptor(source: number, target: number): void {
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let position = 0
  for (;;) {
    const bytesRead = readSync(source, buffer, 0, buffer.length, position)
    if (bytesRead === 0) return
    position += bytesRead
    if (position > MAX_INBOX_FILE_BYTES) {
      throw new Error(`fiche Brain trop volumineuse (limite ${MAX_INBOX_FILE_BYTES} octets)`)
    }
    let written = 0
    while (written < bytesRead) {
      written += writeSync(target, buffer, written, bytesRead - written)
    }
  }
}

function replayedMove(
  root: string,
  from: string,
  sourceContent: Buffer,
  destinationDir: string
): InboxMove | undefined {
  const markerPrefix = Buffer.from(`\n${MOVED_MARKER}`, 'utf8')
  const markerStart = sourceContent.lastIndexOf(markerPrefix)
  if (markerStart < 0) return undefined
  const marker = sourceContent.subarray(markerStart + 1).toString('utf8')
  const targetId = /^<!-- autowin-inbox-moved:([^\r\n<>]+) -->\r?\n?$/u.exec(marker)?.[1]?.trim()
  if (!targetId) throw new Error('candidat déplacé avec un marqueur illisible')
  const directory = resolve(root, destinationDir)
  const target = resolve(root, `${targetId.replace(/\.md$/iu, '')}.md`)
  const inside = relative(directory, target)
  if (
    !inside ||
    isAbsolute(inside) ||
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    resolve(directory, inside) !== target ||
    !existsSync(target)
  ) {
    throw new Error(`candidat déjà déplacé vers une autre destination : ${targetId}`)
  }
  assertRealMutationPath(root, directory, target, destinationDir)
  const targetDescriptor = openSync(target, 'r')
  try {
    const targetStats = fstatSync(targetDescriptor)
    const replacedSource = markerStart === 0
    if (
      !targetStats.isFile() ||
      (replacedSource
        ? targetStats.size <= 0 || targetStats.size > MAX_INBOX_FILE_BYTES
        : targetStats.size !== markerStart)
    ) {
      throw new Error('candidat déplacé mais cible incohérente')
    }
    if (!replacedSource) {
      const targetContent = Buffer.allocUnsafe(targetStats.size)
      const bytes = readSync(targetDescriptor, targetContent, 0, targetContent.length, 0)
      if (bytes !== markerStart || !targetContent.equals(sourceContent.subarray(0, markerStart))) {
        throw new Error('candidat déplacé mais contenu cible divergent')
      }
    }
  } finally {
    closeSync(targetDescriptor)
  }
  return { ok: true, from: idOf(root, from), to: idOf(root, target), replayed: true }
}

function move(
  root: string,
  id: string,
  destinationDir: string,
  sourceDir = INBOX_DIR,
  replaceSource = false,
  targetBasename?: string
): InboxMove {
  const from =
    sourceDir === INBOX_DIR
      ? resolveCandidate(root, id)
      : resolveMovableNote(root, id, sourceDir, 'fiche Brain')
  const directory = join(root, destinationDir)
  mkdirSync(directory, { recursive: true })
  const realDirectory = assertRealMutationPath(root, directory, undefined, destinationDir)
  const basename = targetBasename ?? (id.split('/').at(-1) as string).replace(/\.md$/i, '')
  const sourceDescriptor = openSync(from, 'r+')
  try {
    const sourceStats = fstatSync(sourceDescriptor)
    if (!sourceStats.isFile()) throw new Error('candidat hors périmètre autorisé — non fichier')
    if (sourceStats.size > MAX_INBOX_FILE_BYTES) {
      throw new Error(`fiche Brain trop volumineuse (limite ${MAX_INBOX_FILE_BYTES} octets)`)
    }
    const sourceProbe = Buffer.allocUnsafe(sourceStats.size)
    const sourceBytes = readSync(sourceDescriptor, sourceProbe, 0, sourceProbe.length, 0)
    if (!sameFileIdentity(sourceDescriptor, from)) {
      throw new Error('candidat hors périmètre autorisé — identité changée')
    }
    const replay = replayedMove(root, from, sourceProbe.subarray(0, sourceBytes), destinationDir)
    if (replay) return replay

    const target = reserveTarget(root, directory, realDirectory, basename)
    let sourceMarked = false
    try {
      copyDescriptor(sourceDescriptor, target.descriptor)
      fsyncSync(target.descriptor)
      assertReservedTarget(root, directory, realDirectory, target.path, target.descriptor)
      if (!sameFileIdentity(sourceDescriptor, from)) {
        throw new Error('candidat hors périmètre autorisé — identité changée')
      }
      // Le candidat devient un tombstone logique via le DESCRIPTEUR déjà validé. Son contenu reste
      // récupérable sur disque, mais la revue ne le repropose plus et aucune suppression path-based
      // ne peut viser le fichier d'un autre processus.
      if (replaceSource) {
        ftruncateSync(sourceDescriptor, 0)
        markSourceMoved(sourceDescriptor, 0, idOf(root, target.path))
      } else {
        markSourceMoved(sourceDescriptor, sourceStats.size, idOf(root, target.path))
      }
      sourceMarked = true
      assertReservedTarget(root, directory, realDirectory, target.path, target.descriptor)
      return { ok: true, from: idOf(root, from), to: idOf(root, target.path) }
    } catch (error) {
      if (sourceMarked) {
        try {
          ftruncateSync(sourceDescriptor, replaceSource ? 0 : sourceStats.size)
          if (replaceSource) {
            let restored = 0
            while (restored < sourceBytes) {
              restored += writeSync(
                sourceDescriptor,
                sourceProbe,
                restored,
                sourceBytes - restored,
                restored
              )
            }
          }
          fsyncSync(sourceDescriptor)
        } catch {
          // Le contenu original précède toujours le marqueur ; aucun octet candidat n'est perdu.
        }
      }
      neutralizePartialTarget(target.descriptor)
      throw error
    } finally {
      closeSync(target.descriptor)
    }
  } finally {
    closeSync(sourceDescriptor)
  }
}

/** PROMOUVOIR : primitive no-clobber ; l'autorité reste chez l'appelant humain ou causalement attesté. */
export function promoteInboxCandidate(root: string, id: string): InboxMove {
  return move(root, id, KNOWLEDGE_DIR)
}

/** Promotion automatique bornée au corpus `knowledge/domain/<scope>-*` du workspace. */
export function promoteOutcomeLearningCandidate(
  root: string,
  id: string,
  scope: string
): InboxMove {
  const scopeSlug = scope
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
  if (!scopeSlug || scopeSlug === 'global') {
    throw new Error('portée locale invalide pour auto-publication')
  }
  const candidate = (id.split('/').at(-1) as string).replace(/\.md$/iu, '')
  return move(
    root,
    id,
    join(KNOWLEDGE_DIR, 'domain'),
    INBOX_DIR,
    false,
    `${scopeSlug}-${candidate}`
  )
}

/** REJETER : le candidat part en `.trash/`. Réversible — rien n'est supprimé. */
export function rejectInboxCandidate(root: string, id: string): InboxMove {
  return move(root, id, TRASH_DIR)
}

/** Retire une connaissance canonique sans l'effacer : copie en trash puis neutralise la source. */
export function retractKnowledgeCandidate(root: string, id: string): InboxMove {
  return move(root, id, TRASH_DIR, KNOWLEDGE_DIR, true)
}

/** Remplace explicitement une fiche canonique par une autre, sans effacer l'ancienne. */
export function supersedeKnowledgeCandidate(
  root: string,
  obsoleteId: string,
  replacementId: string
): { moved: InboxMove; replacementId: string } {
  const replacement = resolveMovableNote(root, replacementId, KNOWLEDGE_DIR, 'remplacement')
  return {
    moved: retractKnowledgeCandidate(root, obsoleteId),
    replacementId: idOf(root, replacement)
  }
}

/** Restaure une fiche rétractée vers knowledge/ sans écraser une fiche créée entre-temps. */
export function restoreTrashedKnowledge(root: string, id: string): InboxMove {
  return move(root, id, KNOWLEDGE_DIR, TRASH_DIR)
}
