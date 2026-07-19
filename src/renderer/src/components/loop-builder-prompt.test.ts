import { describe, expect, it } from 'vitest'
import { buildLoopPrompt } from './loop-builder-prompt'

describe('buildLoopPrompt', () => {
  it('produit un prompt autonome avec ordre, regles et artefacts', () => {
    const prompt = buildLoopPrompt({
      passes: 1,
      carryOutput: true,
      stopOnFailure: true,
      steps: [
        { id: 'frame', skill: 'autowin:frame', prompt: 'Cadre le besoin.', produces: ['plan'] },
        { id: 'build', skill: 'autowin:build', capabilities: ['autowin:see'], prompt: 'Implemente.', requires: ['plan'] }
      ]
    })
    expect(prompt).toContain('une seule passe')
    expect(prompt).toContain('1. Skill principale : autowin:frame')
    expect(prompt).toContain('Capacites contextuelles : autowin:see.')
    expect(prompt).toContain('Sorties attendues : plan.')
    expect(prompt).toContain('Entrees requises : plan.')
  })
})
