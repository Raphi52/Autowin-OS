import { describe, expect, it } from 'vitest'
import { buildBehaviourComposition } from './behaviour-composition'
import { RoleModelConfig } from './roles'
import { CONSTITUTION } from './constitution'

/**
 * Choix utilisateur du 2026-08-28 : kaizen APPLIQUE ses editions au lieu d'attendre un accord
 * humain. La regle vit dans la CONSTITUTION (§19), mais elle ne vaut que si le BRIEF de la phase
 * kaizen ne la contredit pas -- defaut vecu : `phase-briefs.ts` imposait « lecture seule » et
 * « une recommandation a soumettre a l'humain », ce qui annulait la regle sur la seule phase
 * qu'elle concerne.
 */
describe('kaizen sans gate humain', () => {
  const composition = buildBehaviourComposition(new RoleModelConfig(), {}, undefined, null)

  const briefKaizen = (): string =>
    composition.orchestrated.systemPrompt
      .filter((p) => p.phase === 'kaizen')
      .flatMap((p) => p.blocks)
      .filter((b) => b.label === 'consigne:kaizen')
      .map((b) => b.excerpt ?? '')
      .join('\n')

  it('la constitution porte la regle 19 APPLIQUEE, pas une attente d accord', () => {
    expect(CONSTITUTION).toContain('éditions précises APPLIQUÉES directement')
    expect(CONSTITUTION).toContain('commit dédié')
    expect(CONSTITUTION).not.toContain('attente d’un accord humain explicite')
  })

  it('le brief de phase kaizen ne redemande PAS une approbation humaine', () => {
    const brief = briefKaizen()
    expect(brief.length).toBeGreaterThan(0)
    expect(brief).not.toMatch(/approbation humaine|lecture seule/iu)
    expect(brief).not.toMatch(/soumettre à l['’]humain/iu)
  })

  it('le brief de phase kaizen impose la contrepartie : annonce + commit dedie', () => {
    const brief = briefKaizen()
    expect(brief).toMatch(/COMMIT DÉDIÉ/u)
    expect(brief).toMatch(/ANNONCÉE/u)
  })

  it('la constitution atteint aussi le chat direct (source unique)', () => {
    const direct = composition.direct.systemPrompt.map((b) => b.excerpt ?? '').join('\n')
    expect(direct).toContain('Kaizen provider-neutral')
  })
})
