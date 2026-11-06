import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Souveraineté sur les fichiers de contexte projet (décision : PLIER).
 *
 * Autowin — et non le CLI par-vendeur — est l'autorité sur le contexte injecté. On plie les fichiers
 * retenus dans le system prompt de chaque phase et de chaque tour du chat, puis on supprime l'auto-load
 * du CLI (Codex `project_doc_max_bytes=0`, Claude `--setting-sources ""`) → source UNIQUE, portable sur
 * tous les modèles importés (c'est Autowin qui lit, pas le CLI).
 *
 * NB : depuis l'unification chat↔orchestrateur, le `system` explicite des phases porte la
 * CONSTITUTION (source unique, constitution.ts) + la discipline (PIPELINE_DISCIPLINE_INSTRUCTION)
 * + le brief de phase ; ce bloc de contexte projet s'y ajoute. Les réflexes porteurs sont aussi
 * enforce par le GATE déterministe.
 *
 * DANS UN DOSSIER : une chaîne de précédence, premier-trouvé-gagne, jamais deux fichiers du même
 * dossier. Ordre : `AGENTS.md` (Codex/OpenAI) → `CLAUDE.md` (Claude) → `.cursorrules` (Cursor).
 * On accepte les variantes de casse usuelles.
 *
 * ENTRE LES DOSSIERS (conv-1067, 2026-10-22) : on EMPILE, de la racine du dépôt git jusqu'au dossier
 * de travail, le plus proche en dernier. Avant, seul le dossier de travail était lu : un fil rangé sur
 * `App/front` perdait les consignes de `App/AGENTS.md`, que Codex (racine git → cwd) et Claude Code
 * (remontée depuis le cwd) chargent tous les deux nativement — et que nous leur interdisons de lire.
 * Hors dépôt git, on ne remonte pas : un AGENTS.md du disque ou du profil n'est pas celui du projet.
 */
export const PROJECT_CONTEXT_CHAIN: string[] = [
  'AGENTS.md',
  'agents.md',
  'CLAUDE.md',
  'claude.md',
  '.cursorrules'
]

/**
 * Plafond de lecture, PARTAGÉ par tous les fichiers empilés (garde-fou : le contexte projet ne doit
 * pas noyer le system). Le plus proche du dossier de travail est servi d'abord ; les plus éloignés
 * sont coupés, puis omis — et la coupe est toujours DITE dans le texte replié.
 */
export const PROJECT_CONTEXT_MAX_BYTES = 32_768

export interface ProjectContext {
  file: string
  content: string
}

/** Un fichier replié dans le prompt. */
export interface ProjectContextPart {
  /** Dossier qui porte le fichier. */
  dir: string
  /** Nom retenu dans la chaîne (`AGENTS.md`…). */
  file: string
  /** Chemin complet du fichier. */
  path: string
  /** Texte replié : le fichier entier, ou sa tête suivie de l'avis de coupe. */
  content: string
  /** Taille réelle du fichier, en octets. */
  bytes: number
  /** Octets réellement repliés : `bytes` sans coupe, 0 quand le fichier est omis faute de place. */
  keptBytes: number
}

/** Ce que le chargeur replie pour un dossier de travail. */
export interface ProjectContextStack {
  /** Racine du dépôt git qui borne la remontée ; absente hors dépôt (seul le dossier est lu). */
  repoRoot?: string
  /** Dossiers lus, de la racine du dépôt au dossier de travail. */
  dossiers: string[]
  /** Au plus un fichier par dossier, dans le même ordre. */
  parts: ProjectContextPart[]
}

interface Gagnant {
  file: string
  path: string
  buf: Buffer
}

/**
 * Le dossier qui porte `.git` (dossier, ou FICHIER pour une copie de travail git), en remontant depuis
 * `dir`. `undefined` hors dépôt. C'est la borne de Codex (`project_root_markers` = `.git` par défaut).
 */
export function racineDuDepot(dir: string): string | undefined {
  let cursor = resolve(dir)
  for (;;) {
    if (existsSync(join(cursor, '.git'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

/** Les dossiers à lire, de la racine du dépôt au dossier de travail (lui seul hors dépôt). */
function dossiersEmpiles(workspace: string): { repoRoot?: string; dossiers: string[] } {
  const dir = resolve(workspace)
  // Un dossier absent ne doit pas faire remonter vers les consignes d'un parent qui, lui, existe.
  if (!existsSync(dir)) return { dossiers: [dir] }
  const repoRoot = racineDuDepot(dir)
  if (!repoRoot) return { dossiers: [dir] }
  const dossiers: string[] = []
  let cursor = dir
  for (;;) {
    dossiers.push(cursor)
    if (cursor === repoRoot) break
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return { repoRoot, dossiers: dossiers.reverse() }
}

/**
 * Le premier fichier lisible et non vide de la chaîne dans `dir`, ou `null` (cas courant).
 * Lecture défensive : une source illisible (partage hors ligne, permission) est sautée.
 */
function gagnantDuDossier(dir: string, chain: string[]): Gagnant | null {
  for (const file of chain) {
    const path = join(dir, file)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) continue
      const buf = readFileSync(path)
      if (buf.toString('utf8').trim().length === 0) continue
      return { file, path, buf }
    } catch {
      continue
    }
  }
  return null
}

/**
 * L'avis de coupe (conv-1067) : ce qui manque, et où lire la suite. « …[tronqué] » seul laissait
 * l'agent croire qu'il avait toutes les consignes du projet.
 */
function avisDeCoupe(path: string, bytes: number, kept: number, maxBytes: number): string {
  if (kept === 0)
    return `…[omis : ${bytes} octets — le plafond de ${maxBytes} octets du contexte projet est pris par les fichiers plus proches ; lis ${path}]`
  return `…[tronqué : ${bytes - kept} octets sur ${bytes} manquent (plafond de ${maxBytes} octets du contexte projet) ; lis ${path} pour la suite]`
}

function replier(
  gagnant: Gagnant,
  dir: string,
  budget: number,
  maxBytes: number
): ProjectContextPart {
  const bytes = gagnant.buf.byteLength
  const base = { dir, file: gagnant.file, path: gagnant.path, bytes }
  if (bytes <= budget) return { ...base, content: gagnant.buf.toString('utf8'), keptBytes: bytes }
  // Mesure en BYTES réels (pas des unités UTF-16) : un doc FR accentué a 1 char ≈ 2 bytes. Décodage
  // non-fatal du préfixe : un caractère multi-byte coupé en fin devient U+FFFD, qu'on retire → jamais
  // de surrogate isolé / octet partiel injecté dans le system prompt.
  const head =
    budget > 0
      ? new TextDecoder('utf-8').decode(gagnant.buf.subarray(0, budget)).replace(/�+$/, '')
      : ''
  const kept = Buffer.byteLength(head, 'utf8')
  const avis = avisDeCoupe(gagnant.path, bytes, kept, maxBytes)
  return { ...base, content: head ? `${head}\n${avis}` : avis, keptBytes: kept }
}

/**
 * Tout ce que le chargeur replie pour `workspace` : un fichier par dossier, de la racine du dépôt au
 * dossier de travail. Le plafond est servi du plus proche au plus éloigné ; dès qu'un fichier est
 * coupé, les plus éloignés n'ont plus rien (un reste de quelques octets ne vaut pas une consigne).
 */
export function loadProjectContextStack(
  workspace: string,
  chain: string[] = PROJECT_CONTEXT_CHAIN,
  maxBytes: number = PROJECT_CONTEXT_MAX_BYTES
): ProjectContextStack {
  const { repoRoot, dossiers } = dossiersEmpiles(workspace)
  const gagnants = dossiers.flatMap((dir) => {
    const gagnant = gagnantDuDossier(dir, chain)
    return gagnant ? [{ dir, gagnant }] : []
  })
  const parts: ProjectContextPart[] = []
  let restant = maxBytes
  for (let rang = gagnants.length - 1; rang >= 0; rang -= 1) {
    const part = replier(gagnants[rang].gagnant, gagnants[rang].dir, restant, maxBytes)
    restant = part.keptBytes < part.bytes ? 0 : restant - part.keptBytes
    parts.unshift(part)
  }
  return { ...(repoRoot ? { repoRoot } : {}), dossiers, parts }
}

/**
 * Le fichier retenu par la chaîne dans CE dossier seul (sans empilement), plafond entier.
 * Rend `null` si aucun présent (cas courant).
 */
export function loadProjectContext(
  workspace: string,
  chain: string[] = PROJECT_CONTEXT_CHAIN,
  maxBytes: number = PROJECT_CONTEXT_MAX_BYTES
): ProjectContext | null {
  const dir = resolve(workspace)
  const gagnant = gagnantDuDossier(dir, chain)
  if (!gagnant) return null
  const part = replier(gagnant, dir, maxBytes, maxBytes)
  return { file: part.file, content: part.content }
}

/**
 * Bloc à plier dans le system prompt (vide si aucun fichier). Étiqueté par le ou les fichiers repliés
 * pour la traçabilité (le juge/observabilité voit d'où vient le contexte : `rag-trace-model.ts` lit
 * l'étiquette entre parenthèses et borne le bloc au prochain `\n=== `, d'où des séparateurs `---`).
 *
 * Un seul fichier, posé dans le dossier de travail même : forme historique, inchangée. Sinon chaque
 * fichier est précédé de son chemin complet, et l'en-tête dit lequel l'emporte en cas de contradiction.
 */
export function projectContextBlock(
  workspace: string,
  chain: string[] = PROJECT_CONTEXT_CHAIN,
  maxBytes: number = PROJECT_CONTEXT_MAX_BYTES
): string {
  const { repoRoot, parts } = loadProjectContextStack(workspace, chain, maxBytes)
  if (parts.length === 0) return ''
  const dir = resolve(workspace)
  if (parts.length === 1 && parts[0].dir === dir)
    return `\n=== CONTEXTE PROJET (${parts[0].file}) ===\n${parts[0].content}\n`
  const base = repoRoot ?? dir
  const etiquette = parts
    .map((part) => (relative(base, part.path) || part.file).split(sep).join('/'))
    .join(' + ')
    .replace(/[()]/g, '')
  const corps = parts.map((part) => `--- ${part.path} ---\n${part.content}`).join('\n\n')
  return (
    `\n=== CONTEXTE PROJET (${etiquette}) ===\n` +
    `Consignes empilées de la racine du dépôt (${base}) au dossier de travail (${dir}) : ` +
    `en cas de contradiction, le fichier le plus proche du dossier de travail l'emporte.\n\n` +
    `${corps}\n`
  )
}
