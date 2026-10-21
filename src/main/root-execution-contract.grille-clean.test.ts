import { describe, expect, it } from 'vitest'
import { etatDeCloture } from './root-execution-contract'
import { evaluateClosure } from './gates/stopgate'
import type { ExecutionEvidence } from './providers/types'

/*
 * DEMANDE conv-1035 (2026-10-21) : la phase clean note les lignes du run sur une grille qualité et
 * termine par `Grille : N ✅ · K ❌ restants · S sans objet`. Tant que K > 0, le run ne ferme pas
 * vert. Le test passe par le site d'appel réel : `etatDeCloture` → `evaluateClosure`, exactement
 * comme le pré-contrôle de `orchestrator.ts` (dod `hasContent: true`).
 */
const TACHE = 'Ajoute un export CSV dans src/main/export.ts'
// Une mutation PROUVÉE : sans elle, la case « Mutation demandée » bloque seule et le jumeau
// accepté ne prouverait plus rien sur la grille.
const MUTATION_PROUVEE = {
  kind: 'mutation',
  status: 'completed',
  ok: true,
  summary: 'edit',
  paths: ['src/main/export.ts']
} as ExecutionEvidence
const BUILD = {
  phase: 'build',
  text: 'Test rouge puis vert : EXIT=0.',
  executionEvidence: [MUTATION_PROUVEE]
}
const CLEAN_AVEC_RESTANT = {
  phase: 'clean',
  text: '| Tests | ❌ restant | src/main/export.ts:40 |\n\nGrille : 11 ✅ · 1 ❌ restant · 0 sans objet'
}
const CLEAN_PROPRE = { phase: 'clean', text: 'Grille : 12 ✅ · 0 ❌ restants · 0 sans objet' }

function preControle(
  phases: { phase: string; text?: string; executionEvidence?: ExecutionEvidence[] }[]
) {
  const cloture = etatDeCloture(TACHE, phases, true, true)
  return evaluateClosure({
    status: cloture.status,
    dod: cloture.dod.map((check) => ({ ...check, hasContent: true }))
  })
}

describe('la grille qualité de clean bloque la fin verte tant qu’il reste un ❌', () => {
  it('un ❌ restant → bloqué, avec le critère nommé', () => {
    const gate = preControle([BUILD, CLEAN_AVEC_RESTANT])
    expect(gate.blocked).toBe(true)
    expect(gate.reasons.join(' ')).toMatch(/1 défaut[^.]*qualité[^.]*Tests/u)
  })

  it('jumeau accepté : zéro ❌ restant → la grille ne bloque pas', () => {
    expect(preControle([BUILD, CLEAN_PROPRE]).blocked).toBe(false)
  })

  it('le refus reste réparable : il ne se déguise pas en « Échec déjà déclaré »', () => {
    // Un statut `red` ajouterait le refus qu'aucune réparation ne lève (stopgate.ts) ; or une
    // réparation rejoue build PUIS clean (orchestrator.ts, phasesApresBuildDeReparation).
    expect(etatDeCloture(TACHE, [BUILD, CLEAN_AVEC_RESTANT], true, true).status).toBe('green')
  })

  it('après réparation, le nouveau clean à zéro ❌ lève le blocage', () => {
    expect(preControle([BUILD, CLEAN_AVEC_RESTANT, BUILD, CLEAN_PROPRE]).blocked).toBe(false)
  })
})
