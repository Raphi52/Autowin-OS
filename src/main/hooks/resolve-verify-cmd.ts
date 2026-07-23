import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Résout la commande de vérification à REJOUER pour verify-replay, à partir de la commande de test
 * DÉCLARÉE par le projet (package.json → scripts.test) — une CONVENTION dérivée du workspace, jamais
 * devinée. Absente → undefined (verify-replay reste dormant, pas de faux-vert). Injectable (readPkg) → testable.
 */
export function resolveVerifyCmd(
  cwd: string,
  readPackageJson: (dir: string) => string | null = defaultReadPackageJson
): string | undefined {
  const raw = readPackageJson(cwd)
  if (!raw) return undefined
  try {
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    const test = pkg.scripts?.test
    if (!test || !test.trim()) return undefined
    // On lance le script déclaré via npm (pas le contenu brut) → respecte l'intention du projet.
    return 'npm test'
  } catch {
    return undefined
  }
}

function defaultReadPackageJson(dir: string): string | null {
  const p = join(dir, 'package.json')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}
