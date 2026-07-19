export interface LoopPromptStep {
  id: string
  skill: string
  capabilities?: string[]
  prompt: string
  requires?: string[]
  produces?: string[]
}

export interface LoopPromptDraft {
  steps: LoopPromptStep[]
  passes: number
  stopOnFailure: boolean
  carryOutput: boolean
}

/** Construit un prompt transportable, sans lancer Hermes ni modifier la loop. */
export function buildLoopPrompt(draft: LoopPromptDraft): string {
  const settings = [
    'une seule passe',
    draft.carryOutput ? 'transmettre la sortie entre les tours' : 'ne pas transmettre la sortie',
    draft.stopOnFailure ? 'arreter au premier echec' : 'continuer apres un echec'
  ].join(' ; ')
  const steps = draft.steps
    .map((step, index) => {
      const requires = step.requires?.length ? `\nEntrees requises : ${step.requires.join(', ')}.` : ''
      const produces = step.produces?.length ? `\nSorties attendues : ${step.produces.join(', ')}.` : ''
      const capabilities = step.capabilities?.length
        ? `\nCapacites contextuelles : ${step.capabilities.join(', ')}.`
        : ''
      return `${index + 1}. Skill principale : ${step.skill}${capabilities}\nInstruction : ${step.prompt.trim()}${requires}${produces}`
    })
    .join('\n\n')
  return `Execute cette loop de maniere sequentielle et explicite.\n\nRegles : ${settings}.\nConserve les sorties utiles et declare clairement chaque echec.\n\nEtapes :\n${steps}`
}
