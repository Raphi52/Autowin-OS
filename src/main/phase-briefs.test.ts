import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS, phaseBrief } from './phase-briefs'
import { PIPELINE_PHASES } from './skill-pipeline'

describe('phase-briefs (consignes courtes in-app)', () => {
  it('couvre les 6 phases avec un brief non vide et COURT', () => {
    for (const phase of PIPELINE_PHASES) {
      const b = PHASE_BRIEFS[phase]
      expect(b, phase).toBeTruthy()
      // Consigne = ~1-2k, jamais le pavé de 8-22k du SKILL.md brut.
      expect(b.length, phase).toBeGreaterThan(150)
      expect(b.length, phase).toBeLessThan(3000)
    }
  })
  it('le brief scout impose la colonne Score (table Score | Type | What | Why | How, tri décroissant)', () => {
    const scout = PHASE_BRIEFS.scout
    expect(scout).toContain('Score')
    // Colonnes dans l'ordre attendu, Score en tête.
    expect(scout).toMatch(/Score\b[^\n]*Type[^\n]*What[^\n]*Why[^\n]*How/)
    // Score agrégé /100 + tri décroissant explicites.
    expect(scout).toMatch(/\/100/)
    expect(scout).toMatch(/d[ée]croissant/i)
  })

  it('phaseBrief enveloppe la consigne avec un en-tête de phase', () => {
    expect(phaseBrief('scout')).toContain('=== CONSIGNE SCOUT ===')
    expect(phaseBrief('scout')).toContain('SCOUT')
  })
  it('ne contient pas de renvois kit qui pendouillent (ENGINE Ch., [[fiche]], → autre-skill)', () => {
    for (const phase of PIPELINE_PHASES) {
      expect(PHASE_BRIEFS[phase], phase).not.toMatch(/ENGINE Ch\.|\[\[|→ `\w+`/)
    }
  })
})
