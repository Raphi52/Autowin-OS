/**
 * BOÎTE DE RÉCEPTION du savoir — lire, dédoublonner et PROMOUVOIR les candidats de `inbox/`.
 *
 * Pourquoi (2026-08-10) : `brain-remember.ts` le dit dès sa ligne 13 — « un candidat va dans `inbox/`,
 * JAMAIS dans `knowledge/` : la promotion reste HUMAINE ». Or aucune surface ne permettait à l'humain
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
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync
} from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { sourceLocatorProblem } from './brain-remember'

/**
 * Le renderer choisit son brain dans une liste, mais un canal IPC accepte n'importe quelle chaîne :
 * on revérifie que la racine demandée EST la racine Brain autorisée, exactement comme le font déjà
 * `loadBrainThemeNodes` et `loadBrainGraphPreviewAsync` dans `viz/fs-brains.ts`.
 */
export function assertBrainVaultRoot(requested: string, allowed: string): string {
  const real = (path: string): string => {
    try {
      return realpathSync(resolve(path)).toLowerCase()
    } catch {
      return resolve(path).toLowerCase()
    }
  }
  if (real(requested) !== real(allowed)) throw new Error('brain vault hors périmètre autorisé')
  return requested
}

export const INBOX_DIR = 'inbox'
export const KNOWLEDGE_DIR = 'knowledge'
export const TRASH_DIR = '.trash'

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
  body: string
  /** Date déclarée dans le frontmatter, sinon dérivée du mtime du fichier. */
  depositedAt?: string
  ageDays?: number
  source?: InboxSourceSignal
  /** Quasi-jumeaux au-dessus du seuil, du plus proche au moins proche. */
  nearDuplicates: InboxNearDuplicate[]
}

export interface ListInboxOptions {
  /** Injectable pour un âge déterministe en test. */
  now?: Date
  /** Sha courant du dépôt portant ce chemin, ou `undefined` s'il est inconnu. */
  headShaFor?: (path: string) => string | undefined
}

const MAX_INBOX_CANDIDATES = 300
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

/**
 * Cosinus lexical sur sacs de mots. Les mots d'un seul caractère et les accents sont neutralisés : deux
 * rédactions du même fait ne doivent pas être séparées par une cédille.
 */
export function textSimilarity(a: string, b: string): number {
  const bag = (text: string): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const token of text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1)) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
    return counts
  }
  const left = bag(a)
  const right = bag(b)
  if (left.size === 0 || right.size === 0) return 0
  let dot = 0
  for (const [token, count] of left) dot += count * (right.get(token) ?? 0)
  const norm = (counts: Map<string, number>): number =>
    Math.sqrt([...counts.values()].reduce((sum, count) => sum + count * count, 0))
  const denominator = norm(left) * norm(right)
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

function markdownFilesUnder(directory: string, root: string): string[] {
  if (!existsSync(directory)) return []
  const found: string[] = []
  const visit = (current: string): void => {
    if (found.length >= MAX_INBOX_CANDIDATES) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (found.length >= MAX_INBOX_CANDIDATES) return
      const child = join(current, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(child)
    }
  }
  visit(directory)
  return found.sort((a, b) => relative(root, a).localeCompare(relative(root, b)))
}

function idOf(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, '/').replace(/\.md$/i, '')
}

/**
 * Candidats de `inbox/` prêts à être revus : source, âge, et quasi-jumeaux (inbox ET canonique).
 * Lecture seule — rien n'est déplacé ici.
 */
export function listInboxCandidates(
  root: string,
  { now = new Date(), headShaFor }: ListInboxOptions = {}
): InboxCandidate[] {
  const inboxRoot = join(root, INBOX_DIR)
  const raw = markdownFilesUnder(inboxRoot, root).map((file) => {
    const content = readFileSync(file, 'utf8')
    const block = frontmatterBlock(content)
    const id = idOf(root, file)
    const declared = frontmatterField(block, 'date') ?? frontmatterField(block, 'deposited')
    const parsed = declared ? new Date(declared) : statSync(file).mtime
    const valid = !Number.isNaN(parsed.getTime())
    return {
      id,
      file,
      title:
        content.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
        frontmatterField(block, 'title') ??
        (id.split('/').at(-1) as string),
      type: frontmatterField(block, 'type'),
      scope: frontmatterField(block, 'scope'),
      body: bodyOf(content),
      ...(valid
        ? {
            depositedAt: declared ?? parsed.toISOString(),
            ageDays: Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000))
          }
        : {}),
      source: readSource(frontmatterField(block, 'source'), headShaFor),
      comparable: `${content.match(/^#\s+(.+)$/m)?.[1] ?? ''} ${bodyOf(content)}`
    }
  })

  // Le savoir CANONIQUE : le serveur, lui, ne compare que contre lui. On le lit pour pouvoir dire
  // « ce candidat existe déjà, promu » avant que l'humain ne le promeuve une seconde fois.
  const canonical = markdownFilesUnder(join(root, KNOWLEDGE_DIR), root).map((file) => {
    const content = readFileSync(file, 'utf8')
    return {
      id: idOf(root, file),
      comparable: `${content.match(/^#\s+(.+)$/m)?.[1] ?? ''} ${bodyOf(content)}`
    }
  })

  return raw.map(({ comparable, ...candidate }) => {
    const nearDuplicates: InboxNearDuplicate[] = []
    for (const other of raw) {
      if (other.id === candidate.id) continue
      const similarity = textSimilarity(comparable, other.comparable)
      if (similarity >= INBOX_NEAR_DUP_SIMILARITY)
        nearDuplicates.push({ id: other.id, similarity, zone: 'inbox' })
    }
    for (const promoted of canonical) {
      const similarity = textSimilarity(comparable, promoted.comparable)
      if (similarity >= INBOX_NEAR_DUP_SIMILARITY)
        nearDuplicates.push({ id: promoted.id, similarity, zone: 'knowledge' })
    }
    nearDuplicates.sort((a, b) => b.similarity - a.similarity)
    return { ...candidate, nearDuplicates }
  })
}

export interface InboxMove {
  ok: true
  from: string
  to: string
}

/**
 * Résout un id de candidat en fichier RÉEL de `inbox/`. Tout ce qui sort de `inbox/` est refusé :
 * une revue de boîte de réception ne doit jamais pouvoir déplacer une fiche canonique.
 */
function resolveCandidate(root: string, id: string): string {
  const inboxRoot = resolve(root, INBOX_DIR)
  const file = resolve(root, `${String(id).replace(/\.md$/i, '')}.md`)
  const inside = relative(inboxRoot, file)
  if (inside.startsWith('..') || inside === '' || resolve(inboxRoot, inside) !== file) {
    throw new Error(`candidat hors de ${INBOX_DIR}/ — refusé : ${id}`)
  }
  if (!existsSync(file)) throw new Error(`candidat introuvable : ${id}`)
  return file
}

/** Destination libre : on n'écrase JAMAIS une fiche existante, on suffixe. */
function freeTarget(directory: string, basename: string): string {
  let attempt = join(directory, `${basename}.md`)
  let index = 2
  while (existsSync(attempt)) {
    attempt = join(directory, `${basename}-${index}.md`)
    index += 1
  }
  return attempt
}

function move(root: string, id: string, destinationDir: string): InboxMove {
  const from = resolveCandidate(root, id)
  const directory = join(root, destinationDir)
  mkdirSync(directory, { recursive: true })
  const basename = (id.split('/').at(-1) as string).replace(/\.md$/i, '')
  const to = freeTarget(directory, basename)
  renameSync(from, to)
  return { ok: true, from: idOf(root, from), to: idOf(root, to) }
}

/** PROMOUVOIR : le candidat entre dans le savoir canonique. Décision humaine, jamais automatique. */
export function promoteInboxCandidate(root: string, id: string): InboxMove {
  return move(root, id, KNOWLEDGE_DIR)
}

/** REJETER : le candidat part en `.trash/`. Réversible — rien n'est supprimé. */
export function rejectInboxCandidate(root: string, id: string): InboxMove {
  return move(root, id, TRASH_DIR)
}
