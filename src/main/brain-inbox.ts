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
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
 * Dossier canonique de chaque type de fiche — miroir de `TYPE_DIRS` dans
 * `brain/tooling/brain_curate.py`. Une fiche promue vit dans `knowledge/<dossier>/` : la racine de
 * `knowledge/` est refusée par `brain_validate.py`.
 */
const KNOWLEDGE_TYPE_DIRS: Readonly<Record<string, string>> = {
  lesson: 'lessons',
  decision: 'decisions',
  domain: 'domain',
  preference: 'preferences'
}

/** Champs sans lesquels `brain_curate._audit` refuse un candidat : la promotion de l'app exige les mêmes. */
const PROMOTION_REQUIRED_FIELDS = [
  'type',
  'scope',
  'author_agent',
  'model',
  'created',
  'status',
  'source'
] as const

/**
 * Relecteur inscrit dans une fiche promue depuis l'app. Même identité que `CURATION_REVIEWER`
 * (`brain-curation-run.ts`) : `brain_validate.py` exige une famille d'agent distincte de l'auteur
 * (`autowin-os`), sinon la fiche est invalide.
 */
export const APP_PROMOTION_REVIEWER = 'autowin-app-curation'

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
    // `inbox/README.md` documente la boîte de réception, il n'a JAMAIS été déposé par `remember` :
    // le compter gonflait le nombre de candidats en attente d'une unité (constaté le 2026-09-16,
    // 5 annoncés pour 4 réels). La procédure de curation l'exclut déjà côté outillage Python.
    if (/^readme\.md$/i.test(basename(file))) return []
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

function writeDescriptor(target: number, content: Buffer): void {
  let written = 0
  while (written < content.length) {
    written += writeSync(target, content, written, content.length - written)
  }
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

/**
 * Fiche à écrire À LA PLACE de la copie octet pour octet : sous-dossier de `destinationDir`, nom et
 * contenu, tous dérivés des octets lus par le descripteur déjà validé (jamais d'une relecture par chemin).
 */
interface RenderedNote {
  subdirectory: string
  basename: string
  content: Buffer
}

function move(
  root: string,
  id: string,
  destinationDir: string,
  sourceDir = INBOX_DIR,
  replaceSource = false,
  targetBasename?: string,
  render?: (source: Buffer) => RenderedNote
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

    const rendered = render?.(sourceProbe.subarray(0, sourceBytes))
    if (rendered && rendered.content.length > MAX_INBOX_FILE_BYTES) {
      throw new Error(`fiche Brain trop volumineuse (limite ${MAX_INBOX_FILE_BYTES} octets)`)
    }
    const targetDirectory = rendered ? join(directory, rendered.subdirectory) : directory
    if (rendered) mkdirSync(targetDirectory, { recursive: true })
    const realTargetDirectory = rendered
      ? assertRealMutationPath(
          root,
          targetDirectory,
          undefined,
          `${destinationDir}/${rendered.subdirectory}`
        )
      : realDirectory
    const target = reserveTarget(
      root,
      targetDirectory,
      realTargetDirectory,
      rendered?.basename ?? basename
    )
    let sourceMarked = false
    try {
      if (rendered) writeDescriptor(target.descriptor, rendered.content)
      else copyDescriptor(sourceDescriptor, target.descriptor)
      fsyncSync(target.descriptor)
      assertReservedTarget(
        root,
        targetDirectory,
        realTargetDirectory,
        target.path,
        target.descriptor
      )
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
      assertReservedTarget(
        root,
        targetDirectory,
        realTargetDirectory,
        target.path,
        target.descriptor
      )
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

const CANDIDATE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u

/** Lecture de l'en-tête — miroir de `brain_curate._frontmatter` (clé `[A-Za-z_]+`, guillemets doubles ôtés). */
function candidateFields(block: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of block.split(/\r?\n/u)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    if (!/^[A-Za-z_]+$/u.test(key)) continue
    fields.set(
      key,
      line
        .slice(colon + 1)
        .trim()
        .replace(/^"+|"+$/gu, '')
    )
  }
  return fields
}

function unquoted(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/gu, '')
}

/** Miroir de `brain_curate._slug` : même nom de fichier, même segment d'uid. */
function knowledgeSlug(text: string): string {
  const ascii = text.normalize('NFKD').replace(/[^\p{ASCII}]/gu, '')
  return (
    ascii
      .replace(/[^A-Za-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .toLowerCase()
      .slice(0, 80) || 'note'
  )
}

/** Miroir de `brain_curate._list_field` : liste en ligne JSON de chaînes, sinon refus. */
function inlineList(raw: string | undefined, field: string): string[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`candidat invalide — ${field} n'est pas une liste en ligne : ${raw}`)
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`candidat invalide — ${field} n'est pas une liste de chaînes : ${raw}`)
  }
  return value as string[]
}

/** Même rendu que `json.dumps(list, ensure_ascii=False)` : les fiches déjà promues restent homogènes. */
function inlineListText(items: readonly string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(', ')}]`
}

function isoDay(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function defaultTheme(scope: string): string {
  const folded = scope.toLowerCase()
  if (folded.includes('autowin')) return 'theme/autowin-os'
  if (folded === 'rig' || folded.startsWith('rig-') || folded.startsWith('rig/')) return 'theme/rig'
  return 'theme/gouvernance'
}

function defaultMocs(scope: string): string[] {
  const folded = scope.toLowerCase()
  if (folded.includes('autowin')) return ['knowledge/_maps/autowin-os']
  if (folded === 'rig' || folded.startsWith('rig-') || folded.startsWith('rig/')) {
    return ['knowledge/_maps/rig']
  }
  return ['knowledge/_maps/brain']
}

const CONFIDENCE_V1: Readonly<Record<string, string>> = {
  low: 'hypothesis',
  medium: 'derived',
  high: 'derived'
}

/**
 * Convertit un candidat `amitel-brain/candidate-v1` en fiche `amitel-brain/v1`, champ pour champ
 * comme `brain_curate._promote` : même dossier par type, même nom tiré du titre, même en-tête.
 * Refuse plutôt que d'écrire une fiche que `brain_validate.py` rejetterait.
 */
function renderPromotedNote(source: Buffer, reviewer: string, today: string): RenderedNote {
  const decoded = source.toString('utf8')
  // Une marque d'ordre des octets (U+FEFF) en tête masquerait l'en-tête `---`.
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  const match = CANDIDATE_RE.exec(text)
  if (!match) throw new Error('candidat sans en-tête — promotion refusée')
  const meta = candidateFields(match[1])
  const body = match[2]
  for (const field of PROMOTION_REQUIRED_FIELDS) {
    if (!meta.get(field)?.trim()) {
      throw new Error(`candidat incomplet — champ ${field} manquant, promotion refusée`)
    }
  }
  const status = unquoted(meta.get('status') as string)
  if (status !== 'candidate') {
    throw new Error(`candidat au statut ${status} — seul un statut candidate se promeut`)
  }
  const type = unquoted(meta.get('type') as string)
  if (!Object.hasOwn(KNOWLEDGE_TYPE_DIRS, type)) {
    throw new Error(`type de candidat non pris en charge : ${type}`)
  }
  const heading = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim()
  if (!body.trim() || !body.trimStart().startsWith('#') || !heading) {
    throw new Error('candidat sans titre « # » — promotion refusée')
  }
  const author = unquoted(meta.get('author_agent') as string)
  const family = (agent: string): string => (agent.split(':')[0] as string).trim().toLowerCase()
  if (family(reviewer) === family(author)) {
    throw new Error("le relecteur doit appartenir à une autre famille d'agent que l'auteur")
  }
  const scope = unquoted(meta.get('scope') as string)
  const kind = unquoted(meta.get('kind') ?? '') || (type === 'domain' ? 'concept' : type)
  const tags = inlineList(meta.get('tags'), 'tags')
  if (!tags.some((tag) => tag.startsWith('theme/'))) tags.push(defaultTheme(scope))
  const mocs = inlineList(meta.get('mocs'), 'mocs')
  const confidenceKey = unquoted(meta.get('confidence') ?? 'medium')
  const confidence = Object.hasOwn(CONFIDENCE_V1, confidenceKey)
    ? CONFIDENCE_V1[confidenceKey]
    : 'hypothesis'
  const lines = [
    '---',
    'schema: amitel-brain/v1',
    `uid: ${knowledgeSlug(scope)}/${knowledgeSlug(kind)}/${knowledgeSlug(heading)}`,
    `type: ${type}`,
    `kind: ${kind}`,
    `scope: ${JSON.stringify(scope)}`,
    `author_agent: ${JSON.stringify(author)}`,
    `model: ${meta.get('model')}`,
    `created: ${meta.get('created')}`,
    `updated: ${today}`,
    'status: active',
    `confidence: ${confidence}`,
    `sources: ${inlineListText([unquoted(meta.get('source') as string)])}`,
    `supersedes: ${inlineListText(inlineList(meta.get('supersedes'), 'supersedes'))}`,
    `reviewed_by: ${inlineListText([reviewer])}`,
    `reviewed_at: ${today}`,
    `mocs: ${inlineListText(mocs.length > 0 ? mocs : defaultMocs(scope))}`,
    `tags: ${inlineListText(tags)}`,
    '---'
  ]
  return {
    subdirectory: KNOWLEDGE_TYPE_DIRS[type] as string,
    basename: knowledgeSlug(heading),
    content: Buffer.from(`${lines.join('\n')}\n\n${body.trimStart()}`, 'utf8')
  }
}

export interface PromoteInboxOptions {
  /** Injectable pour des dates `updated` / `reviewed_at` déterministes en test. */
  now?: Date
  reviewer?: string
}

/**
 * PROMOUVOIR : primitive no-clobber ; l'autorité reste chez l'appelant humain ou causalement attesté.
 *
 * Pourquoi (2026-09-29) : la promotion copiait le candidat TEL QUEL à la racine de `knowledge/`, et
 * laissait dans `inbox/` l'original entier suivi du marqueur « déplacé ». Deux défauts constatés à la
 * curation du jour : `brain_validate.py` refuse une fiche à la racine de `knowledge/` au format
 * candidat, et `brain_curate.py` ne lit pas le marqueur — il reprenait l'original comme une
 * proposition en attente. Cinq doublons ont dû être retirés à la main.
 *
 * Désormais la fiche est écrite au format v1 dans `knowledge/<type>/`, et le candidat est RÉDUIT à
 * la seule ligne-marqueur : sans en-tête ni contenu, il n'est plus vu comme candidat par la revue,
 * `brain_curate.py` ni `brain_validate.py`, et il garde la reprise sans doublon après un plantage.
 */
export function promoteInboxCandidate(
  root: string,
  id: string,
  { now = new Date(), reviewer = APP_PROMOTION_REVIEWER }: PromoteInboxOptions = {}
): InboxMove {
  const today = isoDay(now)
  return move(root, id, KNOWLEDGE_DIR, INBOX_DIR, true, undefined, (source) =>
    renderPromotedNote(source, reviewer, today)
  )
}

/**
 * Promotion automatique bornée au corpus `knowledge/domain/<scope>-*` du workspace.
 *
 * Le candidat est copié à l'identique vers `knowledge/domain/`, puis RÉDUIT à sa ligne-marqueur dans
 * `inbox/` (même raison que `promoteInboxCandidate`) : laissé entier, il gardait son en-tête
 * `status: candidate` et `brain_curate.py` le reprenait comme une proposition encore en attente.
 */
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
  return move(root, id, join(KNOWLEDGE_DIR, 'domain'), INBOX_DIR, true, `${scopeSlug}-${candidate}`)
}

/**
 * REJETER : le candidat part en `.trash/`. Réversible — rien n'est supprimé : la copie complète vit
 * dans `.trash/`, et `inbox/` n'en garde que la ligne-marqueur.
 *
 * Pourquoi (2026-09-29) : le rejet laissait dans `inbox/` le candidat entier, marqueur ajouté À LA
 * FIN. Son en-tête `status: candidate` restait en tête, et `brain_curate.py` (qui ne lit pas le
 * marqueur) le reprenait comme proposition en attente — la curation automatique lancée à chaque
 * session (`brain-curation-run.ts`, `--apply`) pouvait donc republier un candidat rejeté.
 */
export function rejectInboxCandidate(root: string, id: string): InboxMove {
  return move(root, id, TRASH_DIR, INBOX_DIR, true)
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
