import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * Entretien legacy du cache `context-values` créé par l'ancien prototype RLM.
 *
 * Le writer n'est plus raccordé au produit, mais des installations ayant exécuté le prototype
 * peuvent encore contenir ces fichiers. On conserve donc uniquement leur purge best-effort.
 */
export function pruneLegacyContextValues(
  base = ensureAutowinAppData(),
  maxAgeDays = 30,
  nowMs = Date.now()
): number {
  const root = join(base, 'context-values')
  if (!existsSync(root)) return 0
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const name of readdirSync(root)) {
    const file = join(root, name)
    try {
      if (statSync(file).mtimeMs < cutoff) {
        unlinkSync(file)
        removed += 1
      }
    } catch {
      // Entretien best-effort : un fichier verrouillé ou disparu n'empêche pas le démarrage.
    }
  }
  return removed
}
