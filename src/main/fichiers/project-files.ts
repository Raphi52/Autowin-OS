/**
 * LECTURE / ÉCRITURE de fichiers du PROJET pour l'onglet « Projet » (arborescence + éditeur).
 *
 * Contrat, volontairement étroit :
 *  - tout chemin est RELATIF à la racine du projet, résolu puis VÉRIFIÉ sous cette racine ;
 *    un `..`, un chemin absolu ou un lien symbolique qui sort → refus (`hors-racine`).
 *  - l'écriture ne CRÉE jamais un fichier : elle ne remplace que le contenu d'un fichier existant.
 *  - le listage est PAR DOSSIER (pas récursif) : un dépôt avec node_modules ne doit pas figer l'UI.
 */
import { promises as fs } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export type ProjectEntry = { name: string; path: string; kind: 'dir' | 'file' }
export type ProjectListResult =
  { ok: true; path: string; entries: ProjectEntry[] } | { ok: false; reason: string }
export type ProjectReadResult =
  { ok: true; path: string; content: string } | { ok: false; reason: string }
export type ProjectWriteResult = { ok: true; path: string } | { ok: false; reason: string }

/** Dossiers qu'on ne propose jamais : ils noient l'arborescence sans rien apprendre. */
const IGNORES = new Set(['.git', 'node_modules', 'dist', 'out', '.autowin-data'])

/** Taille au-delà de laquelle on refuse d'ouvrir dans l'éditeur (1 Mo). */
export const MAX_EDIT_BYTES = 1_000_000

function normalizeRel(relPath: string): string {
  return String(relPath ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/**
 * Résout un chemin relatif SOUS la racine. Rend `null` dès qu'il en sort — y compris via un lien
 * symbolique, d'où la comparaison faite aussi sur les chemins réels quand ils existent.
 */
export async function resolveInsideRoot(root: string, relPath: string): Promise<string | null> {
  const rel = normalizeRel(relPath)
  if (/^[a-zA-Z]:/.test(rel)) return null
  const base = resolve(root)
  const target = resolve(base, rel)
  if (target !== base && !target.startsWith(base.endsWith(sep) ? base : base + sep)) return null
  try {
    const realBase = await realpath(base)
    const realTarget = await realpath(target)
    if (
      realTarget !== realBase &&
      !realTarget.startsWith(realBase.endsWith(sep) ? realBase : realBase + sep)
    ) {
      return null
    }
  } catch {
    // La cible n'existe pas encore : la vérification textuelle ci-dessus fait foi.
  }
  return target
}

export async function listProjectDir(root: string, relPath = ''): Promise<ProjectListResult> {
  const abs = await resolveInsideRoot(root, relPath)
  if (!abs) return { ok: false, reason: 'hors-racine' }
  try {
    const raw = await fs.readdir(abs, { withFileTypes: true })
    const rel = normalizeRel(relPath)
    const entries: ProjectEntry[] = raw
      .filter((d) => !IGNORES.has(d.name))
      .map((d) => ({
        name: d.name,
        path: rel ? `${rel}/${d.name}` : d.name,
        kind: d.isDirectory() ? ('dir' as const) : ('file' as const)
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1
      )
    return { ok: true, path: normalizeRel(relPath), entries }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

export async function readProjectFile(root: string, relPath: string): Promise<ProjectReadResult> {
  const abs = await resolveInsideRoot(root, relPath)
  if (!abs) return { ok: false, reason: 'hors-racine' }
  try {
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return { ok: false, reason: 'pas-un-fichier' }
    if (stat.size > MAX_EDIT_BYTES) return { ok: false, reason: 'fichier-trop-gros' }
    const content = await fs.readFile(abs, 'utf8')
    if (content.includes('\u0000')) return { ok: false, reason: 'fichier-binaire' }
    return { ok: true, path: normalizeRel(relPath), content }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

/** Remplace le contenu d'un fichier EXISTANT sous la racine. Ne crée rien. */
export async function writeProjectFile(
  root: string,
  relPath: string,
  content: string
): Promise<ProjectWriteResult> {
  const abs = await resolveInsideRoot(root, relPath)
  if (!abs) return { ok: false, reason: 'hors-racine' }
  if (typeof content !== 'string') return { ok: false, reason: 'contenu-invalide' }
  try {
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return { ok: false, reason: 'pas-un-fichier' }
  } catch {
    return { ok: false, reason: 'fichier-inexistant' }
  }
  try {
    await fs.writeFile(abs, content, 'utf8')
    return { ok: true, path: normalizeRel(relPath) }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
