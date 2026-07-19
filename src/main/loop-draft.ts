import type { LoopRunInput } from './loop-runner'

export function parseGeneratedLoop(raw: string, allowedSkills: Set<string>): LoopRunInput {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const parsed = JSON.parse(fenced) as Partial<LoopRunInput>
  if (!Array.isArray(parsed.steps) || parsed.steps.length < 1 || parsed.steps.length > 12)
    throw new Error('La proposition ne contient pas entre 1 et 12 etapes.')
  const phaseRank = (id: string): number => {
    const name = id.split(':').pop()?.toLowerCase()
    return name === 'scout' ? 0 : name === 'frame' ? 1 : name === 'terrain' ? 2 : name === 'build' ? 3 : name === 'clean' ? 4 : name === 'judge' ? 5 : 3
  }
  const steps = parsed.steps.map((step, index) => {
    if (!step || typeof step.skill !== 'string' || !allowedSkills.has(step.skill))
      throw new Error(`Skill invalide a l'etape ${index + 1}.`)
    if (typeof step.prompt !== 'string' || !step.prompt.trim())
      throw new Error(`Prompt manquant a l'etape ${index + 1}.`)
    if (/^(cadre le besoin|prepare le terrain|execute le travail|audite le resultat)/i.test(step.prompt.trim()))
      throw new Error(`Etape ${index + 1} trop generique : elle repete la skill.`)
    return {
      id: typeof step.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(step.id) ? step.id : `step-${index + 1}`,
      skill: step.skill,
      capabilities: Array.isArray(step.capabilities)
        ? step.capabilities.filter(
            (x): x is string => typeof x === 'string' && x !== step.skill && allowedSkills.has(x)
          )
        : [],
      prompt: step.prompt.trim(),
      requires: Array.isArray(step.requires) ? step.requires.filter((x): x is string => typeof x === 'string') : [],
      produces: Array.isArray(step.produces) ? step.produces.filter((x): x is string => typeof x === 'string') : []
    }
  }).sort((a, b) => phaseRank(a.skill) - phaseRank(b.skill))
  return { steps, passes: 1, stopOnFailure: true, carryOutput: true }
}
