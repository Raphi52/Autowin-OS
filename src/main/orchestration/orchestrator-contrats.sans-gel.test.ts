import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExecutionEvidence } from '../providers/types'
import { watchdogClaimsFromEvidence } from './orchestrator-contrats'

/**
 * Lue dans le processus qui fait vivre la fenêtre, à chaque publication d'un travail d'agent
 * (`os.ts`, `orchestrator-run.ts`). Mesuré le 06/11/2026 : 10,3 s pour 2 344 fichiers, parce que
 * chaque chemin était cherché parmi tous ceux de la preuve.
 */
describe('watchdogClaimsFromEvidence — sans tenir la fenêtre', () => {
  it('3 000 fichiers publiés : lignes et marqueurs relus en moins de 1 s', () => {
    const chemins = Array.from({ length: 3_000 }, (_, i) => `src/dossier-${i % 50}/fichier-${i}.ts`)
    const parChemin = <T>(valeur: (i: number) => T): Record<string, T> =>
      Object.fromEntries(chemins.map((chemin, i) => [chemin, valeur(i)]))
    const preuve = {
      ok: true,
      kind: 'mutation',
      type: 'workspace_delta',
      paths: chemins,
      writtenLineFingerprintsByPath: parChemin((i) => [`ligne-${i}`]),
      pathGenerationMarkers: parChemin((i) => `marqueur-${i}`)
    } as unknown as ExecutionEvidence

    const debut = performance.now()
    const claims = watchdogClaimsFromEvidence([preuve], 'C:/depot')
    const dureeMs = performance.now() - debut

    const dernier = resolve('C:/depot', chemins[2_999]!)
    expect(claims.mutatedPaths).toHaveLength(3_000)
    expect(claims.mutatedLineFingerprints?.[dernier]).toEqual(['ligne-2999'])
    expect(claims.mutatedPathGenerationMarkers?.[dernier]).toBe('marqueur-2999')
    expect(dureeMs, `3 000 fichiers : ${Math.round(dureeMs)} ms`).toBeLessThan(1_000)
  })

  it('un chemin écrit avec des barres inverses retrouve ses lignes, la première entrée gagne', () => {
    const preuve = {
      ok: true,
      kind: 'mutation',
      type: 'workspace_delta',
      paths: ['src/a.ts'],
      writtenLineFingerprintsByPath: { 'src\\a.ts': ['premiere'], './src/a.ts': ['seconde'] },
      pathGenerationMarkers: { 'src\\a.ts': 'm1' }
    } as unknown as ExecutionEvidence

    const claims = watchdogClaimsFromEvidence([preuve], 'C:/depot')

    const absolu = resolve('C:/depot', 'src/a.ts')
    expect(claims.mutatedLineFingerprints?.[absolu]).toEqual(['premiere'])
    expect(claims.mutatedPathGenerationMarkers?.[absolu]).toBe('m1')
  })
})
