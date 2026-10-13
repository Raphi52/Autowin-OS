import { describe, expect, it } from 'vitest'
import {
  RAISONNEMENT_MAX,
  ajouterRaisonnementDePipeline,
  completerChoixDePipeline
} from './chat-view-model'
import type { ChatPart, OrchStep, PipelineChoice } from './chat-view-model'

/**
 * DEMANDE (conv-918, 2026-10-13) : « dans le bloc orchestration ya du texte qui defile en dessous
 * mais quand je depplie ce bloc je vois nulle part ce qui s'ecrit dans la 2e ligne du mode reduit ».
 *
 * Cause lue dans le code : le raisonnement du sous-agent partait comme une NOTE d'activite
 * (`orchestrator.ts`, `onDelta('exec', '', c.reasoning)`), chaque fragment ecrasait la ligne de vie
 * (`commands.ts`) et aucun n'etait garde. Il est desormais ACCUMULE sous la ligne de sa phase.
 */
const lignes = (part: ChatPart): PipelineChoice[] => {
  if (part.kind !== 'action') throw new Error(`part « ${part.kind} » : aucune ligne de pipeline`)
  return part.pipeline ?? []
}

const orchestration = (pipeline: PipelineChoice[], over: Record<string, unknown> = {}): ChatPart =>
  ({
    kind: 'action',
    name: 'orchestrate',
    args: { task: 'ma tache' },
    pipeline,
    ...over
  }) as unknown as ChatPart

describe('le raisonnement s accumule sous sa phase', () => {
  it('recolle les fragments, dans l ordre, sous la ligne de la phase qui les emet', () => {
    let parts = [
      orchestration([
        { phase: 'think', model: 'm' },
        { phase: 'build', model: 'm' }
      ])
    ]
    parts = ajouterRaisonnementDePipeline(parts, 'and now ', 'think')
    parts = ajouterRaisonnementDePipeline(parts, '1/2 could', 'think')
    expect(lignes(parts[0])[0].raisonnement).toBe('and now 1/2 could')
    expect(lignes(parts[0])[1].raisonnement).toBeUndefined()
  })

  it('sans phase connue, la ligne la plus recente est celle qui tourne', () => {
    const parts = ajouterRaisonnementDePipeline(
      [orchestration([{ phase: 'think' }, { phase: 'build' }])],
      'je reflechis'
    )
    expect(lignes(parts[0])[1].raisonnement).toBe('je reflechis')
  })

  it('refuse de choisir entre deux membres d un eventail de la meme phase', () => {
    const avant = [
      orchestration([
        { phase: 'frame', model: 'a' },
        { phase: 'frame', model: 'b' }
      ])
    ]
    expect(ajouterRaisonnementDePipeline(avant, 'de qui ?', 'frame')).toBe(avant)
  })

  it('ne rouvre pas une orchestration deja close', () => {
    const avant = [orchestration([{ phase: 'think' }], { ok: true })]
    expect(ajouterRaisonnementDePipeline(avant, 'en retard', 'think')).toBe(avant)
  })

  it('garde la FIN quand le texte depasse la borne', () => {
    const long = 'a'.repeat(RAISONNEMENT_MAX)
    let parts = [orchestration([{ phase: 'think' }])]
    parts = ajouterRaisonnementDePipeline(parts, long, 'think')
    parts = ajouterRaisonnementDePipeline(parts, 'FIN', 'think')
    const texte = lignes(parts[0])[0].raisonnement!
    expect(texte).toHaveLength(RAISONNEMENT_MAX)
    expect(texte.endsWith('FIN')).toBe(true)
  })
})

describe('l etape terminee complete le raisonnement sans ecraser le direct', () => {
  const step = (thinking: string): OrchStep =>
    ({
      step: 'exec',
      status: 'done',
      model: 'm',
      text: 'rendu',
      thinking,
      execution: { phase: 'think' }
    }) as unknown as OrchStep

  it('garde le texte recu en direct, recolle juste', () => {
    const parts = completerChoixDePipeline(
      [orchestration([{ phase: 'think', model: 'm', raisonnement: 'and now 1/2 could' }])],
      step('and now\n1/2 could')
    )
    expect(lignes(parts[0])[0].raisonnement).toBe('and now 1/2 could')
    expect(lignes(parts[0])[0].outcome).toBe('rendu')
  })

  it('prend celui de l etape quand rien n est arrive en direct', () => {
    const parts = completerChoixDePipeline(
      [orchestration([{ phase: 'think', model: 'm' }])],
      step('pense en bloc')
    )
    expect(lignes(parts[0])[0].raisonnement).toBe('pense en bloc')
  })
})
