import { statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les fichiers dont une reparation modifie le COMPORTEMENT du controle final. S'ils sont plus
 * recents que le bundle execute, rejouer une reparation ne peut rien changer au refus.
 */
const SOURCES_DU_GATE = [
  'src/main/gates/stopgate.ts',
  'src/main/gates/hooks.ts',
  'src/main/objections-juge.ts',
  'src/main/orchestrator.ts'
]

const BUNDLE = 'out/main/index.js'

/**
 * Mesure hors modele : date du bundle execute contre date des sources du gate.
 * Rend `undefined` des qu'une date manque (app lancee depuis les sources, depot partiel) — une
 * mesure absente ne doit jamais inventer un blocage.
 */
export function mesureBundlePerime(
  racine: string
): { bundleMs: number; sourceMs: number; bundle: string } | undefined {
  let bundleMs: number
  try {
    bundleMs = statSync(join(racine, BUNDLE)).mtimeMs
  } catch {
    return undefined
  }
  let sourceMs = 0
  for (const rel of SOURCES_DU_GATE) {
    try {
      sourceMs = Math.max(sourceMs, statSync(join(racine, rel)).mtimeMs)
    } catch {
      /* source absente : elle ne compte pas */
    }
  }
  if (sourceMs === 0) return undefined
  return { bundleMs, sourceMs, bundle: BUNDLE }
}
