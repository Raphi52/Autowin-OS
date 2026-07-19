import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Charge le bloc kit condensé (SOUL) injecté en système sur CHAQUE tour, quel
 * que soit le provider. Source = resources/kit-soul.md (bundlé). Résolution
 * robuste dev (racine projet) / prod (resources packagées).
 */
let cached: string | undefined

export function loadKitSoul(): string {
  if (cached !== undefined) return cached
  const candidates = [
    join(process.cwd(), 'resources', 'kit-soul.md'), // dev
    join(app?.getAppPath?.() ?? '.', 'resources', 'kit-soul.md'),
    join(process.resourcesPath ?? '.', 'kit-soul.md') // prod (extraResources)
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      cached = readFileSync(p, 'utf8')
      return cached
    }
  }
  cached = '' // pas de kit trouvé → injection vide (systemInjected sera false)
  return cached
}
