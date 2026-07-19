export type AgentStageId = 'scout' | 'frame' | 'terrain' | 'build' | 'judge'
export type AgentResourceKind = 'agent' | 'persona' | 'skill'

export interface AgentStage {
  id: AgentStageId
  order: number
  label: string
  description: string
}

export interface AgentPersona {
  id: string
  label: string
  initials: string
  objective: string
  prompt: string
  skills: string[]
  constraints: string[]
}

export interface AgentResource {
  id: string
  label: string
  kind: AgentResourceKind
  description: string
  role?: 'orchestrator' | 'subagent' | 'judge' | 'scout'
  steps?: string[]
}

export interface AgentAssignment {
  id: string
  stageId: AgentStageId
  personaId: string
  resourceId: string
  kind: AgentResourceKind
  /** Emplacement stable dans la skill ; distinct de l'identité d'exécution. */
  slotId: string
  provider: string | null
  modelId: string | null
  reasoningEffort: string | null
  objective: string
  prompt: string
  context: string
  constraints: string[]
  /** Moment d'injection dans le pipeline. */
  trigger: string
  order: number
  mode: 'sequential' | 'parallel'
  dependsOn: string[]
  exitCondition: string
  failurePolicy: string
}

export type InvocationConfiguration = Pick<
  AgentAssignment,
  | 'provider'
  | 'modelId'
  | 'reasoningEffort'
  | 'objective'
  | 'prompt'
  | 'context'
  | 'constraints'
  | 'trigger'
  | 'order'
  | 'mode'
  | 'dependsOn'
  | 'exitCondition'
  | 'failurePolicy'
>

export interface AgentWorkflow {
  id: string
  label: string
  stages: AgentStage[]
  personas: AgentPersona[]
  resources: AgentResource[]
  assignments: AgentAssignment[]
}

function invocationDefaults(
  slotId: string,
  persona: AgentPersona,
  trigger: string,
  order = 0
): Pick<AgentAssignment, 'slotId'> & InvocationConfiguration {
  return {
    slotId,
    provider: null,
    modelId: null,
    reasoningEffort: null,
    objective: persona.objective,
    prompt: persona.prompt,
    context: '',
    constraints: [...persona.constraints],
    trigger,
    order,
    mode: 'sequential',
    dependsOn: [],
    exitCondition: 'Objectif atteint avec preuves citées',
    failurePolicy: 'stop-and-report'
  }
}

function assertInvocation(configuration: InvocationConfiguration): void {
  const required = [
    configuration.objective,
    configuration.prompt,
    configuration.trigger,
    configuration.exitCondition,
    configuration.failurePolicy
  ]
  if (required.some((value) => !value.trim())) throw new Error('Paramètre d’invocation vide')
  if (!Number.isInteger(configuration.order) || configuration.order < 0) {
    throw new Error('Ordre d’injection invalide')
  }
  if (!['sequential', 'parallel'].includes(configuration.mode)) {
    throw new Error('Mode d’injection invalide')
  }
  if (
    configuration.constraints.length === 0 ||
    configuration.constraints.some((value) => !value.trim()) ||
    configuration.dependsOn.some((value) => !value.trim())
  ) {
    throw new Error('Liste d’invocation invalide')
  }
  const modelFields = [
    configuration.provider,
    configuration.modelId,
    configuration.reasoningEffort
  ]
  if (modelFields.some(Boolean) && modelFields.some((value) => !value)) {
    throw new Error('Modèle, provider et effort doivent être configurés ensemble')
  }
}

export function configureInvocation(
  workflow: AgentWorkflow,
  assignmentId: string,
  patch: Partial<InvocationConfiguration>
): AgentWorkflow {
  const current = workflow.assignments.find((assignment) => assignment.id === assignmentId)
  if (!current) throw new Error(`Invocation inconnue: ${assignmentId}`)
  const next = { ...current, ...patch }
  assertInvocation(next)
  return {
    ...workflow,
    assignments: workflow.assignments.map((assignment) =>
      assignment.id === assignmentId ? next : assignment
    )
  }
}

export function assignResource(
  workflow: AgentWorkflow,
  resourceId: string,
  stageId: AgentStageId,
  personaId: string
): AgentWorkflow {
  const resource = workflow.resources.find((candidate) => candidate.id === resourceId)
  if (!resource) throw new Error(`Ressource inconnue: ${resourceId}`)
  if (!workflow.stages.some((stage) => stage.id === stageId)) {
    throw new Error(`Étape inconnue: ${stageId}`)
  }
  if (!workflow.personas.some((persona) => persona.id === personaId)) {
    throw new Error(`Persona inconnue: ${personaId}`)
  }
  const persona = workflow.personas.find((candidate) => candidate.id === personaId)!
  if (resource.kind === 'skill' && resource.id !== stageId) {
    throw new Error(`La skill ${resource.id} ne correspond pas à l’étape ${stageId}`)
  }
  if (resource.kind === 'skill' && !persona.skills.includes(resource.id)) {
    throw new Error(`La persona ${personaId} ne charge pas la skill ${resource.id}`)
  }

  const sequence =
    workflow.assignments.filter(
      (assignment) =>
        assignment.resourceId === resourceId &&
        assignment.stageId === stageId &&
        assignment.personaId === personaId
    ).length + 1

  return {
    ...workflow,
    assignments: [
      ...workflow.assignments,
      {
        id: `${resourceId}-${stageId}-${personaId}-${sequence}`,
        stageId,
        personaId,
        resourceId,
        kind: resource.kind,
        ...invocationDefaults(`${resourceId}-${sequence}`, persona, `${stageId}:ready`, sequence - 1)
      }
    ]
  }
}

export function moveAssignment(
  workflow: AgentWorkflow,
  assignmentId: string,
  stageId: AgentStageId,
  personaId: string
): AgentWorkflow {
  const assignment = workflow.assignments.find((candidate) => candidate.id === assignmentId)
  if (!assignment) {
    throw new Error(`Affectation inconnue: ${assignmentId}`)
  }
  if (!workflow.stages.some((stage) => stage.id === stageId)) {
    throw new Error(`Étape inconnue: ${stageId}`)
  }
  const persona = workflow.personas.find((candidate) => candidate.id === personaId)
  if (!persona) {
    throw new Error(`Persona inconnue: ${personaId}`)
  }
  const resource = workflow.resources.find((candidate) => candidate.id === assignment.resourceId)
  if (!resource) throw new Error(`Ressource inconnue: ${assignment.resourceId}`)
  if (assignment.kind !== resource.kind) {
    throw new Error(`Type d’affectation incohérent: ${assignment.id}`)
  }
  if (resource.kind === 'skill' && resource.id !== stageId) {
    throw new Error(`La skill ${resource.id} ne correspond pas à l’étape ${stageId}`)
  }
  if (resource?.kind === 'skill' && !persona.skills.includes(resource.id)) {
    throw new Error(`La persona ${personaId} ne charge pas la skill ${resource.id}`)
  }

  return {
    ...workflow,
    assignments: workflow.assignments.map((assignment) =>
      assignment.id === assignmentId ? { ...assignment, stageId, personaId } : assignment
    )
  }
}

export function removeAssignment(workflow: AgentWorkflow, assignmentId: string): AgentWorkflow {
  return {
    ...workflow,
    assignments: workflow.assignments.filter((assignment) => assignment.id !== assignmentId)
  }
}

export function restoreAgentWorkflow(raw: string | null): AgentWorkflow {
  if (!raw) return createDefaultAgentWorkflow()
  try {
    const candidate = JSON.parse(raw) as Partial<AgentWorkflow>
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.label !== 'string' ||
      !Array.isArray(candidate.stages) ||
      !Array.isArray(candidate.personas) ||
      !Array.isArray(candidate.resources) ||
      !Array.isArray(candidate.assignments)
    ) {
      return createDefaultAgentWorkflow()
    }

    const workflow = candidate as AgentWorkflow
    const canonicalStageIds = new Set<AgentStageId>(['scout', 'frame', 'terrain', 'build', 'judge'])
    const canonicalResourceIds = new Set([
      'scout',
      'orchestrator',
      'subagent',
      'frame',
      'terrain',
      'build',
      'judge'
    ])
    const hasUniqueIds = (items: Array<{ id: string }>): boolean =>
      new Set(items.map((item) => item.id)).size === items.length
    const validStages = workflow.stages.every(
      (stage) =>
        canonicalStageIds.has(stage.id) &&
        typeof stage.order === 'number' &&
        typeof stage.label === 'string' &&
        stage.label.trim().length > 0 &&
        typeof stage.description === 'string' &&
        stage.description.trim().length > 0
    )
    const validResources = workflow.resources.every(
      (resource) =>
        canonicalResourceIds.has(resource.id) &&
        typeof resource.label === 'string' &&
        resource.label.trim().length > 0 &&
        typeof resource.description === 'string' &&
        resource.description.trim().length > 0 &&
        ['agent', 'persona', 'skill'].includes(resource.kind)
    )
    const validPersonas = workflow.personas.every(
      (persona) =>
        typeof persona.id === 'string' &&
        persona.id.trim().length > 0 &&
        typeof persona.label === 'string' &&
        persona.label.trim().length > 0 &&
        typeof persona.initials === 'string' &&
        persona.initials.trim().length > 0 &&
        typeof persona.objective === 'string' &&
        persona.objective.trim().length > 0 &&
        typeof persona.prompt === 'string' &&
        persona.prompt.trim().length > 0 &&
        Array.isArray(persona.skills) &&
        persona.skills.length > 0 &&
        persona.skills.every(
          (skillId) =>
            typeof skillId === 'string' &&
            workflow.resources.some(
              (resource) => resource.id === skillId && resource.kind === 'skill'
            )
        ) &&
        Array.isArray(persona.constraints) &&
        persona.constraints.length > 0 &&
        persona.constraints.every(
          (constraint) => typeof constraint === 'string' && constraint.trim().length > 0
        )
    )
    const validAssignments = workflow.assignments.every((assignment) => {
      const persona = workflow.personas.find((item) => item.id === assignment.personaId)
      const resource = workflow.resources.find((item) => item.id === assignment.resourceId)
      try {
        assertInvocation(assignment)
      } catch {
        return false
      }
      return (
        typeof assignment.id === 'string' &&
        typeof assignment.slotId === 'string' &&
        assignment.slotId.trim().length > 0 &&
        workflow.stages.some((stage) => stage.id === assignment.stageId) &&
        Boolean(persona) &&
        Boolean(resource) &&
        assignment.kind === resource?.kind &&
        (resource?.kind !== 'skill' ||
          (resource.id === assignment.stageId && persona?.skills.includes(resource.id)))
      )
    })
    const consistent =
      validStages &&
      validResources &&
      validPersonas &&
      validAssignments &&
      hasUniqueIds(workflow.stages) &&
      workflow.stages.length === canonicalStageIds.size &&
      hasUniqueIds(workflow.personas) &&
      hasUniqueIds(workflow.resources) &&
      workflow.resources.length === canonicalResourceIds.size &&
      hasUniqueIds(workflow.assignments)

    return consistent ? workflow : createDefaultAgentWorkflow()
  } catch {
    return createDefaultAgentWorkflow()
  }
}

export function createDefaultAgentWorkflow(): AgentWorkflow {
  const workflow = {
    id: 'rig-standard',
    label: 'Pipeline RIG',
    stages: [
      { id: 'scout', order: 0, label: 'Scout', description: 'Choisir le bon front' },
      { id: 'frame', order: 1, label: 'Frame', description: 'Problème et approche' },
      { id: 'terrain', order: 2, label: 'Terrain', description: 'Harness et observabilité' },
      { id: 'build', order: 3, label: 'Build', description: 'Exécuter et prouver' },
      { id: 'judge', order: 4, label: 'Judge', description: 'Challenger avant sortie' }
    ],
    personas: [
      {
        id: 'target-scout',
        label: 'Éclaireur de cible',
        initials: 'SC',
        objective:
          'Explorer le dépôt, comparer plusieurs fronts et recommander le meilleur point d’entrée.',
        prompt:
          'Reste en lecture seule. Cite les artefacts et sépare faits, hypothèses et recommandation.',
        skills: ['scout'],
        constraints: ['Lecture seule', 'Plusieurs visions', 'Conclusion sourcée']
      },
      {
        id: 'solution-framer',
        label: 'Cadreur de solution',
        initials: 'FR',
        objective:
          'Transformer le besoin retenu en forme, frontières et critères de réussite explicites.',
        prompt:
          'Trace le problème réel, vérifie l’existant puis cadre une solution minimale sans l’implémenter.',
        skills: ['frame'],
        constraints: ['Zéro doublon', 'Périmètre explicite', 'Critères falsifiables']
      },
      {
        id: 'terrain-engineer',
        label: 'Ingénieur terrain',
        initials: 'TR',
        objective:
          'Préparer le harness, l’observabilité et les oracles nécessaires avant l’exécution.',
        prompt: 'Construis uniquement les moyens de voir, tester et arrêter proprement le travail.',
        skills: ['terrain'],
        constraints: ['Harness réel', 'Oracle externe', 'Arrêt observable']
      },
      {
        id: 'bounded-builder',
        label: 'Exécutant borné',
        initials: 'BU',
        objective: 'Réaliser un sous-objectif précis et rendre un artefact vérifiable.',
        prompt:
          'Exécute la tâche confiée sans élargir le périmètre. Retourne chemins, commandes et preuves.',
        skills: ['build'],
        constraints: ['Sous-objectif unique', 'Pas de refactor annexe', 'Preuve d’exécution']
      },
      {
        id: 'contract-challenger',
        label: 'Challenger de contrats',
        initials: 'CC',
        objective: 'Chercher les divergences de comportement et les contrats externes non tracés.',
        prompt:
          'Attaque les frontières, discriminants et champs de sortie. N’accepte pas le build comme preuve sémantique.',
        skills: ['build', 'judge'],
        constraints: ['Contre-exemple nommé', 'Contrats tracés', 'Aucun faux vert']
      },
      {
        id: 'adversarial-reviewer',
        label: 'Juge adverse',
        initials: 'JU',
        objective: 'Réfuter la prétention de complétude avant toute sortie.',
        prompt:
          'Considère la conclusion comme une assertion à challenger. Cherche omissions, risques et preuves manquantes.',
        skills: ['judge'],
        constraints: ['Indépendance', 'Verdict motivé', 'Résidu visible']
      }
    ],
    resources: [
      {
        id: 'scout',
        label: 'Scout',
        kind: 'skill',
        role: 'scout',
        description: 'Diverge, classe et recommande.'
      },
      {
        id: 'orchestrator',
        label: 'Orchestrateur',
        kind: 'agent',
        role: 'orchestrator',
        description: 'Pilote le workflow sans exécuter à la place des agents.'
      },
      {
        id: 'subagent',
        label: 'Sous-agent',
        kind: 'agent',
        role: 'subagent',
        description: 'Exécute une tâche bornée.'
      },
      {
        id: 'frame',
        label: 'Frame',
        kind: 'skill',
        role: 'subagent',
        description: 'Cadre le problème, les frontières et la réussite.'
      },
      {
        id: 'terrain',
        label: 'Terrain',
        kind: 'skill',
        role: 'subagent',
        description: 'Prépare harness, observabilité et oracles.'
      },
      {
        id: 'build',
        label: 'Build',
        kind: 'skill',
        role: 'subagent',
        description: 'Exécute un sous-objectif borné et vérifiable.'
      },
      {
        id: 'judge',
        label: 'Judge · skill complète',
        kind: 'skill',
        role: 'judge',
        description: 'Panel adverse, synthèse et verdict.',
        steps: ['Conformité', 'Sécurité & frontières', 'Utilité humaine', 'Synthèse adverse']
      }
    ],
    assignments: [
      {
        id: 'scout-agent',
        stageId: 'scout',
        personaId: 'target-scout',
        resourceId: 'scout',
        kind: 'skill'
      },
      {
        id: 'frame-agent',
        stageId: 'frame',
        personaId: 'solution-framer',
        resourceId: 'frame',
        kind: 'skill'
      },
      {
        id: 'terrain-agent',
        stageId: 'terrain',
        personaId: 'terrain-engineer',
        resourceId: 'terrain',
        kind: 'skill'
      },
      {
        id: 'build-agent',
        stageId: 'build',
        personaId: 'bounded-builder',
        resourceId: 'build',
        kind: 'skill'
      },
      {
        id: 'contract-agent',
        stageId: 'build',
        personaId: 'contract-challenger',
        resourceId: 'build',
        kind: 'skill'
      },
      {
        id: 'judge-skill',
        stageId: 'judge',
        personaId: 'adversarial-reviewer',
        resourceId: 'judge',
        kind: 'skill'
      }
    ]
  } as AgentWorkflow

  const slotPresets: Record<string, [slotId: string, trigger: string, order: number]> = {
    'scout-agent': ['exploration', 'pipeline:start', 0],
    'frame-agent': ['framing', 'scout:complete', 0],
    'terrain-agent': ['harness', 'frame:approved', 0],
    'build-agent': ['implementation', 'terrain:ready', 0],
    'contract-agent': ['contract-check', 'build:artifact-ready', 1],
    'judge-skill': ['adversarial-review', 'build:verified', 0]
  }
  workflow.assignments = workflow.assignments.map((assignment) => {
    const persona = workflow.personas.find((candidate) => candidate.id === assignment.personaId)!
    const [slotId, trigger, order] = slotPresets[assignment.id]
    return { ...assignment, ...invocationDefaults(slotId, persona, trigger, order) }
  })
  return workflow
}
