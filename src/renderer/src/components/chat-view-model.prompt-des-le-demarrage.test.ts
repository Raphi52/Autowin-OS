import { describe, expect, it } from 'vitest'
import { noterChoixDePipeline } from './chat-view-model'
import type { ChatPart, PipelineChoice } from './chat-view-model'

/**
 * DEFAUT MESURE (conv-470, saisie du 2026-09-12 ts=1789192601300 : « j'ai rien en preprompt »).
 *
 * Le tour d'orchestration `52fbe05f-0086-4806-8f07-c8762e8caa35` n'a qu'un evenement `command` dans
 * son journal : pendant TOUTE la phase, la ligne de pipeline ne pouvait montrer aucun prompt, parce
 * que seul le step TERMINE le portait (`completerChoixDePipeline`). Le prompt est pourtant deja
 * construit quand la phase demarre (`execPrompt` juste avant `onPhase` dans `orchestrator.ts`).
 * Une phase de 10 min laissait donc le deplie « prompt envoye » vide.
 */
const lignes = (part: ChatPart): PipelineChoice[] => {
  if (part.kind !== 'action') throw new Error(`part « ${part.kind} » : aucune ligne de pipeline`)
  return part.pipeline ?? []
}

const orchestration = (): ChatPart =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'ma tache' } }) as unknown as ChatPart

describe('le prompt de phase est visible DES le demarrage', () => {
  it('porte le prompt annonce au demarrage sur la ligne creee', () => {
    const parts = noterChoixDePipeline([orchestration()], {
      phase: 'build',
      role: 'subagent',
      provider: 'claude',
      model: 'opus-5',
      prompt: '[system]\nconsigne\n\n[user]\nfais X'
    })
    expect(lignes(parts[0])[0].prompt).toBe('[system]\nconsigne\n\n[user]\nfais X')
  })

  it('un prompt SEUL, sans phase ni agent, ne fabrique aucune ligne', () => {
    const parts = noterChoixDePipeline([orchestration()], { prompt: 'du texte' })
    expect(lignes(parts[0])).toHaveLength(0)
  })
})
