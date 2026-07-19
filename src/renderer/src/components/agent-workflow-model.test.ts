import { describe, expect, it } from 'vitest'
import {
  assignResource,
  configureInvocation,
  createDefaultAgentWorkflow,
  moveAssignment,
  removeAssignment,
  restoreAgentWorkflow
} from './agent-workflow-model'

describe('agent workflow model', () => {
  it('starts with the full pipeline and Judge as a composed skill', () => {
    const workflow = createDefaultAgentWorkflow()

    expect(workflow.stages.map((stage) => stage.id)).toEqual([
      'scout',
      'frame',
      'terrain',
      'build',
      'judge'
    ])
    expect(workflow.assignments).toContainEqual(
      expect.objectContaining({
        id: 'judge-skill',
        stageId: 'judge',
        personaId: 'adversarial-reviewer',
        resourceId: 'judge',
        kind: 'skill'
      })
    )
  })

  it('defines personas as skill-backed sub-agent invocations', () => {
    const workflow = createDefaultAgentWorkflow()

    expect(
      workflow.personas.every((persona) => persona.objective && persona.skills.length > 0)
    ).toBe(true)
    expect(workflow.personas.map((persona) => persona.id)).not.toContain('architect-rig')
    expect(workflow.personas).toContainEqual(
      expect.objectContaining({
        id: 'adversarial-reviewer',
        skills: ['judge'],
        objective: expect.stringContaining('Réfuter')
      })
    )
  })

  it('adds a dropped resource to a precise stage and persona', () => {
    const workflow = createDefaultAgentWorkflow()
    const next = assignResource(workflow, 'judge', 'judge', 'adversarial-reviewer')

    expect(next.assignments).toHaveLength(workflow.assignments.length + 1)
    expect(next.assignments.at(-1)).toEqual(expect.objectContaining({
      id: 'judge-judge-adversarial-reviewer-2',
      stageId: 'judge',
      personaId: 'adversarial-reviewer',
      resourceId: 'judge',
      kind: 'skill'
    }))
    expect(workflow.assignments).toHaveLength(6)
  })

  it('rejects a skill that is not loaded by the selected persona', () => {
    const workflow = createDefaultAgentWorkflow()

    expect(() => assignResource(workflow, 'scout', 'terrain', 'terrain-engineer')).toThrow(
      'ne correspond pas à l’étape'
    )
    expect(() => moveAssignment(workflow, 'scout-agent', 'terrain', 'terrain-engineer')).toThrow(
      'ne correspond pas à l’étape'
    )
  })

  it('moves an existing assignment without duplicating it', () => {
    const workflow = createDefaultAgentWorkflow()
    const next = moveAssignment(workflow, 'contract-agent', 'build', 'bounded-builder')

    expect(next.assignments).toHaveLength(workflow.assignments.length)
    expect(next.assignments.find((assignment) => assignment.id === 'contract-agent')).toEqual(
      expect.objectContaining({ stageId: 'build', personaId: 'bounded-builder' })
    )
  })

  it('falls back to the default workflow when persisted data is invalid or obsolete', () => {
    const incompatible = createDefaultAgentWorkflow()
    incompatible.assignments = [
      {
        ...incompatible.assignments[0],
        id: 'invalid',
        stageId: 'terrain',
        personaId: 'terrain-engineer',
        resourceId: 'scout',
        kind: 'skill'
      }
    ]
    const incomplete = JSON.parse(JSON.stringify(createDefaultAgentWorkflow()))
    delete incomplete.personas[0].constraints
    const emptyFields = ['objective', 'prompt', 'initials', 'constraints'].map((field) => {
      const draft = JSON.parse(JSON.stringify(createDefaultAgentWorkflow()))
      draft.personas[0][field] = field === 'constraints' ? [] : ''
      return draft
    })
    const inventedCatalog = JSON.parse(JSON.stringify(createDefaultAgentWorkflow()))
    inventedCatalog.stages[0].id = 'invented'
    inventedCatalog.resources.find((resource) => resource.id === 'scout').id = 'invented'
    inventedCatalog.personas[0].skills = ['invented']
    inventedCatalog.assignments[0].stageId = 'invented'
    inventedCatalog.assignments[0].resourceId = 'invented'
    const duplicate = createDefaultAgentWorkflow()
    duplicate.assignments[1].id = duplicate.assignments[0].id

    expect(restoreAgentWorkflow(JSON.stringify(incompatible))).toEqual(createDefaultAgentWorkflow())
    expect(restoreAgentWorkflow(JSON.stringify(incomplete))).toEqual(createDefaultAgentWorkflow())
    emptyFields.forEach((draft) =>
      expect(restoreAgentWorkflow(JSON.stringify(draft))).toEqual(createDefaultAgentWorkflow())
    )
    expect(restoreAgentWorkflow(JSON.stringify(inventedCatalog))).toEqual(
      createDefaultAgentWorkflow()
    )
    expect(restoreAgentWorkflow(JSON.stringify(duplicate))).toEqual(createDefaultAgentWorkflow())
    expect(restoreAgentWorkflow('{"stages":"corrupted"}')).toEqual(createDefaultAgentWorkflow())
    expect(
      restoreAgentWorkflow(
        '{"id":"old","label":"old","stages":[],"personas":[{"description":"old"}],"resources":[],"assignments":[]}'
      )
    ).toEqual(createDefaultAgentWorkflow())
    expect(restoreAgentWorkflow(null)).toEqual(createDefaultAgentWorkflow())
  })

  it('removes one assignment without mutating the workflow', () => {
    const workflow = createDefaultAgentWorkflow()
    const next = removeAssignment(workflow, 'frame-agent')

    expect(next.assignments).toHaveLength(5)
    expect(next.assignments.some((assignment) => assignment.id === 'frame-agent')).toBe(false)
    expect(workflow.assignments).toHaveLength(6)
  })

  it('persists where and when a sub-agent is injected', () => {
    const workflow = createDefaultAgentWorkflow()
    const scout = workflow.assignments.find((assignment) => assignment.id === 'scout-agent')!

    expect(scout).toEqual(
      expect.objectContaining({
        stageId: 'scout',
        resourceId: 'scout',
        slotId: 'exploration',
        order: 0,
        mode: 'sequential',
        trigger: 'pipeline:start'
      })
    )
  })

  it('configures the complete invocation without losing its slot identity', () => {
    const workflow = createDefaultAgentWorkflow()
    const next = configureInvocation(workflow, 'judge-skill', {
      provider: 'provider',
      modelId: 'provider/model-a',
      reasoningEffort: 'high',
      objective: 'Réfuter les contrats externes.',
      prompt: 'Cherche un contre-exemple falsifiable.',
      context: 'Diff, tests et captures du build.',
      constraints: ['Lecture seule', 'Citer les preuves'],
      trigger: 'build:verified',
      order: 2,
      mode: 'parallel',
      dependsOn: ['judge-security'],
      exitCondition: 'Verdict motivé rendu',
      failurePolicy: 'retry-once-then-escalate'
    })
    const judge = next.assignments.find((assignment) => assignment.id === 'judge-skill')!

    expect(judge).toEqual(
      expect.objectContaining({
        slotId: 'adversarial-review',
        stageId: 'judge',
        resourceId: 'judge',
        modelId: 'provider/model-a',
        reasoningEffort: 'high',
        trigger: 'build:verified',
        order: 2,
        mode: 'parallel',
        dependsOn: ['judge-security']
      })
    )
    expect(workflow.assignments.find((assignment) => assignment.id === 'judge-skill')?.modelId).toBe(
      null
    )
  })

  it('rejects invalid timing and empty invocation parameters', () => {
    const workflow = createDefaultAgentWorkflow()

    expect(() => configureInvocation(workflow, 'scout-agent', { order: -1 })).toThrow()
    expect(() => configureInvocation(workflow, 'scout-agent', { objective: ' ' })).toThrow()
    expect(() => configureInvocation(workflow, 'scout-agent', { constraints: [] })).toThrow()
  })
})
