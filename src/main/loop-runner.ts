import { listLoopSkills, readLoopSkills } from './loop-skills'
import type { ProviderRegistry } from './providers/registry'
import type { Message } from './providers/types'
import {
  MODEL_QUESTION_INSTRUCTION,
  parseModelQuestion,
  type ModelQuestion
} from './model-questions'

export interface LoopStepInput {
  id: string
  skill: string
  capabilities?: string[]
  prompt: string
  requires?: string[]
  produces?: string[]
}
export interface LoopRunInput {
  steps: LoopStepInput[]
  passes: number
  stopOnFailure: boolean
  carryOutput: boolean
}
export interface LoopEvent {
  runId: string
  kind: 'run-start' | 'step-start' | 'step-done' | 'step-error' | 'run-done'
  stepId?: string
  pass?: number
  output?: string
  error?: string
}

function validate(input: LoopRunInput, skills: Set<string>): LoopRunInput {
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 20) {
    throw new Error('La boucle doit contenir entre 1 et 20 tours')
  }
  const passes = Number(input.passes)
  if (!Number.isInteger(passes) || passes < 1 || passes > 10) {
    throw new Error('Le nombre de passes doit être compris entre 1 et 10')
  }
  const ids = new Set<string>()
  let previousRank = -1
  for (const step of input.steps) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(step.id) || ids.has(step.id)) {
      throw new Error('Identifiant de tour invalide ou dupliqué')
    }
    ids.add(step.id)
    if (!skills.has(step.skill)) throw new Error(`Skill de loop inconnue : ${step.skill}`)
    const name = step.skill.split(':').pop()?.toLowerCase()
    const rank = name === 'scout' ? 0 : name === 'frame' ? 1 : name === 'terrain' ? 2 : name === 'build' ? 3 : name === 'clean' ? 4 : name === 'judge' ? 5 : 3
    if (rank < previousRank) throw new Error(`Ordre semantique invalide avant ${step.id}`)
    previousRank = rank
    for (const capability of step.capabilities ?? []) {
      if (!skills.has(capability)) throw new Error(`Capacite de loop inconnue : ${capability}`)
      if (capability === step.skill) throw new Error(`Capacite dupliquee sur ${step.id} : ${capability}`)
    }
    if (typeof step.prompt !== 'string' || !step.prompt.trim() || step.prompt.length > 20_000) {
      throw new Error(`Prompt invalide pour ${step.skill}`)
    }
    for (const name of [...(step.requires ?? []), ...(step.produces ?? [])]) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) throw new Error(`Nom d'artefact invalide : ${name}`)
    }
  }
  return { ...input, passes: 1, stopOnFailure: true, carryOutput: true }
}

function extractArtifacts(output: string, names: string[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const name of names) {
    const match = new RegExp(`<<<ARTIFACT:${name}\\s*>>>\\n([\\s\\S]*?)\\n<<<END_ARTIFACT>>>`, 'i').exec(output)
    if (!match) throw new Error(`Artefact requis non produit : ${name}`)
    found.set(name, match[1].trim())
  }
  return found
}

export async function runSkillLoop(
  rawInput: LoopRunInput,
  registry: ProviderRegistry,
  provider: string,
  emit: (event: LoopEvent) => void,
  ask?: (question: ModelQuestion, context: string) => Promise<string>
): Promise<{ runId: string; completed: number; failed: number }> {
  const enabledSkills = new Set((await listLoopSkills()).map((skill) => skill.id))
  const input = validate(rawInput, enabledSkills)
  const skillContents = await readLoopSkills(
    input.steps.flatMap((step) => [step.skill, ...(step.capabilities ?? [])])
  )
  const runId = `loop-${Date.now().toString(36)}`
  let completed = 0
  let failed = 0
  let previousOutput = ''
  const artifacts = new Map<string, string>()
  emit({ runId, kind: 'run-start' })

  outer: for (let pass = 1; pass <= input.passes; pass++) {
    previousOutput = ''
    for (const step of input.steps) {
      emit({ runId, kind: 'step-start', stepId: step.id, pass })
      try {
        const skillContent = skillContents.get(step.skill)
        if (!skillContent) throw new Error(`Contenu de skill introuvable : ${step.skill}`)
        const required = (step.requires ?? []).map((name) => {
          const value = artifacts.get(name)
          if (value === undefined) throw new Error(`Artefact requis absent : ${name}`)
          return `Artefact ${name}:\n${value}`
        })
        if (required.length) previousOutput = required.join('\n\n')
        const query =
          (input.carryOutput || required.length > 0) && previousOutput
            ? `${step.prompt.trim()}\n\nRésultat du tour précédent :\n${previousOutput}`
            : step.prompt.trim()
        const messages: Message[] = [{ role: 'user', content: query }]
        const capabilityContents = (step.capabilities ?? [])
          .map((id) => skillContents.get(id))
          .filter((content): content is string => Boolean(content))
        const system =
          `Tu exécutes le tour ${step.id} d’une boucle préparée. ` +
          `Applique strictement la skill sélectionnée ci-dessous.\n${MODEL_QUESTION_INSTRUCTION}` +
          ((step.produces?.length ?? 0) > 0
            ? `\nProduis les artefacts demandés avec le format <<<ARTIFACT:nom>>> puis <<<END_ARTIFACT>>>. Noms : ${step.produces?.join(', ')}.`
            : '') +
          `\n\nSkill principale :\n${skillContent}` +
          (capabilityContents.length
            ? `\n\nCapacites contextuelles a appliquer dans cette meme tache :\n${capabilityContents.join('\n\n---\n\n')}`
            : '')
        let output = ''
        let questionsAsked = 0
        for (;;) {
          const response = await registry.send(provider, messages, { system })
          output = response.text.trim()
          const question = parseModelQuestion(output)
          if (!question || !ask) break
          if (questionsAsked >= 4) throw new Error(`Trop de questions pour ${step.id}`)
          questionsAsked++
          const answer = await ask(question, `${step.id} · passe ${pass}`)
          messages.push({ role: 'assistant', content: output }, { role: 'user', content: answer })
        }
        previousOutput = output
        for (const [name, value] of extractArtifacts(output, step.produces ?? [])) artifacts.set(name, value)
        completed++
        emit({ runId, kind: 'step-done', stepId: step.id, pass, output: previousOutput })
      } catch (reason) {
        failed++
        previousOutput = ''
        const error = reason instanceof Error ? reason.message : String(reason)
        emit({ runId, kind: 'step-error', stepId: step.id, pass, error })
        if (input.stopOnFailure) break outer
      }
    }
  }
  emit({ runId, kind: 'run-done' })
  return { runId, completed, failed }
}
