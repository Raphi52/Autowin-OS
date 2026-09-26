import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les fichiers dont une reparation modifie le COMPORTEMENT du controle final. S'ils sont plus
 * recents que le bundle execute, rejouer une reparation ne peut rien changer au refus.
 */
const SOURCES_DU_GATE = [
  'src/main/objections-juge.ts',
  'src/main/orchestrator.ts'
]

/**
 * Dossiers dont TOUT fichier .ts (hors tests) fait partie du controle final.
 * fix-ok: conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb — la liste tenue a la main laissait la
 * mesure MUETTE des qu'un fichier du gate n'y figurait pas (deja paye une fois par conv-540 avec
 * default-gate-hooks.ts). Deriver les dossiers ne peut qu'ELARGIR la mesure, jamais la desserrer.
 */
const DOSSIERS_DU_GATE = ['src/main/gates', 'src/main/hooks']

function sourcesDuGate(racine: string): string[] {
  const fichiers = [...SOURCES_DU_GATE]
  for (const dossier of DOSSIERS_DU_GATE) {
    let entrees: string[]
    try {
      entrees = readdirSync(join(racine, dossier))
    } catch {
      continue
    }
    for (const nom of entrees) {
      if (!nom.endsWith('.ts') || nom.endsWith('.test.ts') || nom.endsWith('.d.ts')) continue
      fichiers.push(`${dossier}/${nom}`)
    }
  }
  return fichiers
}

const BUNDLE = 'out/main/index.js'

/**
 * Mesure hors modele : date du bundle execute contre date des sources du gate.
 * Rend `undefined` des qu'une date manque (app lancee depuis les sources, depot partiel) — une
 * mesure absente ne doit jamais inventer un blocage.
 */
export function bundleEstLeCodeExecute(argv: readonly string[] = process.argv): boolean {
  return argv.some((a) => a.split(String.fromCharCode(92)).join('/').endsWith(BUNDLE))
}

export function mesureBundlePerime(
  racine: string,
  demarrageMs: number = Date.now() - process.uptime() * 1000,
  argv: readonly string[] = process.argv
): { bundleMs: number; sourceMs: number; demarrageMs: number; bundle: string } | undefined {
  /**
   * fix-ok: conv-540 tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f — 7 tests d'orchestrateur rouges
   * (greedy, lean-fast, workflow-override) parce que la mesure lisait out/main/index.js du depot
   * REEL alors que le processus tourne depuis les sources (vitest). Un bundle vieux d'une heure
   * arretait donc toute reprise, dans les tests comme pour un developpeur lance par `npm run dev`.
   * La docstring promettait deja ce garde-fou (« app lancee depuis les sources ») sans le faire.
   */
  if (!bundleEstLeCodeExecute(argv)) return undefined
  let bundleMs: number
  try {
    bundleMs = statSync(join(racine, BUNDLE)).mtimeMs
  } catch {
    return undefined
  }
  let sourceMs = 0
  for (const rel of sourcesDuGate(racine)) {
    try {
      sourceMs = Math.max(sourceMs, statSync(join(racine, rel)).mtimeMs)
    } catch {
      /* source absente : elle ne compte pas */
    }
  }
  if (sourceMs === 0) return undefined
  return { bundleMs, sourceMs, demarrageMs, bundle: BUNDLE }
}
