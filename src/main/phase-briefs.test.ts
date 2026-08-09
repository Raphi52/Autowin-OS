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

  it('le brief frame exige un inventaire de confiance ADOSSÉ À DES PREUVES, pas un ressenti', () => {
    const frame = PHASE_BRIEFS.frame

    // La section est un livrable, pas une suggestion.
    expect(frame).toContain('## Confiance')
    // Les trois états d'une affirmation, dont celui qui oblige à nommer sa source.
    expect(frame).toMatch(/VÉRIFIÉ/)
    expect(frame).toMatch(/NON VÉRIFIÉ/)
    // Le cœur : une affirmation vérifiée NOMME l'artefact ouvert — le garde-fou anti-hallucination.
    expect(frame).toMatch(/NOMME l'artefact/)
    // Et l'obligation de RÉSOUDRE, pas seulement de signaler.
    expect(frame).toMatch(/RÉSOUS/)
    expect(frame).toMatch(/jamais un fait silencieux/)
  })

  it('phaseBrief enveloppe la consigne avec un en-tête de phase', () => {
    expect(phaseBrief('scout')).toContain('=== CONSIGNE SCOUT ===')
    expect(phaseBrief('scout')).toContain('SCOUT')
  })

  it('les phases d analyse savent que la lecture seule est leur contrat normal', () => {
    for (const phase of ['scout', 'frame', 'terrain'] as const) {
      expect(PHASE_BRIEFS[phase], phase).toMatch(/lecture seule/i)
      expect(PHASE_BRIEFS[phase], phase).toMatch(/pas un blocage/i)
      expect(PHASE_BRIEFS[phase], phase).toMatch(/tu n'es pas BUILD/i)
    }
  })

  it('kaizen couvre les mécanismes propres à Autowin et reste en proposition', () => {
    const brief = phaseBrief('kaizen')
    expect(brief).toContain('conversation')
    expect(brief).toContain('worktree')
    expect(brief).toContain('RAG')
    expect(brief).toContain('coût')
    expect(brief).toMatch(/ne modifie|lecture seule/i)
  })
  it('ne contient pas de renvois kit qui pendouillent (ENGINE Ch., [[fiche]], → autre-skill)', () => {
    for (const phase of PIPELINE_PHASES) {
      expect(PHASE_BRIEFS[phase], phase).not.toMatch(/ENGINE Ch\.|\[\[|→ `\w+`/)
    }
  })
})
