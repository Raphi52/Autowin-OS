import { defaultModelForProvider, findModel, type ImportedModel } from './models'
import { isKnownAlias } from './model-aliases'
import type { Role, RoleBinding } from './roles'
import { bindingForModel, setSlot, type AgentTopology, type SlotBinding } from './topology'

/**
 * Projette la topologie visible d’Agent Studio vers les quatre rôles mono-modèle du runtime.
 * Un panel vide signifie « mono-modèle », jamais « réutiliser une ancienne valeur de roles.json ».
 */
export function runtimeRoleSlots(topology: AgentTopology): Record<Role, SlotBinding> {
  const worker = topology.subagents[0] ?? topology.orchestrator
  return {
    orchestrator: topology.orchestrator,
    subagent: worker,
    scout: topology.panels.scout[0] ?? worker,
    judge: topology.panels.judge[0] ?? worker
  }
}

/**
 * Résout un slot en binding runtime sans perdre la sélection si le catalogue dynamique est hors
 * ligne. Les ids canoniques locaux sont `${provider}/${transport}` : le suffixe persistant est donc
 * une preuve plus fidèle que l'ancien roles.json, qui peut viser un tout autre provider.
 */
export function runtimeRoleBinding(binding: SlotBinding, models: ImportedModel[]): RoleBinding {
  const discovered = findModel(models, binding.modelId)
  if (!discovered && isKnownAlias(binding.modelId)) {
    throw new UnresolvedRuntimeModelError(binding.modelId)
  }
  const prefix = `${binding.provider}/`
  const persistedTransport = binding.compute
    ? binding.compute.resourceId
    : binding.modelId.startsWith(prefix)
      ? binding.modelId.slice(prefix.length)
      : binding.modelId
  return {
    provider: binding.provider,
    model: discovered?.model ?? persistedTransport,
    reasoningEffort: binding.reasoningEffort
  }
}

export class UnresolvedRuntimeModelError extends Error {
  constructor(readonly modelId: string) {
    super(`Modèle indisponible hors catalogue : ${modelId}`)
    this.name = 'UnresolvedRuntimeModelError'
  }
}

/** Valide aussi les overrides ponctuels, qui ne font pas partie de la topologie persistée. */
export function assertRuntimeBindingAvailable(binding: RoleBinding, models: ImportedModel[]): void {
  const requestedId = binding.model?.includes('/')
    ? binding.model
    : `${binding.provider}/${binding.model ?? ''}`
  const model = binding.model
    ? (findModel(models, requestedId) ??
      models.find(
        (candidate) => candidate.provider === binding.provider && candidate.model === binding.model
      ))
    : defaultModelForProvider(models, binding.provider)
  if (!model || model.provider !== binding.provider) {
    throw new UnresolvedRuntimeModelError(requestedId)
  }
  if (binding.reasoningEffort && !model.reasoningEfforts.includes(binding.reasoningEffort)) {
    throw new Error(`Effort indisponible pour ${model.id} : ${binding.reasoningEffort}`)
  }
}

/** Refuse tout run tant qu'un alias dynamique configuré n'a pas de transport prouvé. */
export function assertRuntimeTopologyAvailable(
  topology: AgentTopology,
  models: ImportedModel[]
): void {
  const bindings = [
    topology.orchestrator,
    ...topology.subagents,
    ...topology.panels.scout,
    ...topology.panels.frame,
    ...topology.panels.terrain,
    ...topology.panels.judge
  ]
  for (const binding of bindings) {
    if (!findModel(models, binding.modelId)) throw new UnresolvedRuntimeModelError(binding.modelId)
    runtimeRoleBinding(binding, models)
  }
}

/**
 * Convertit l’ancienne API publique `setRole` en mutation de la topologie canonique.
 * Aucun écran ni outil ne peut ainsi recréer un binding durable absent d’Agent Studio.
 */
export function topologyWithRuntimeRole(
  topology: AgentTopology,
  role: Role,
  binding: RoleBinding,
  models: ImportedModel[]
): AgentTopology {
  const selected = binding.model
    ? (findModel(models, binding.model) ??
      models.find(
        (candidate) => candidate.provider === binding.provider && candidate.model === binding.model
      ))
    : defaultModelForProvider(models, binding.provider)
  if (!selected || selected.provider !== binding.provider) {
    throw new Error(
      `Modèle introuvable pour ${binding.provider}${binding.model ? ` : ${binding.model}` : ''}`
    )
  }

  const target = role === 'subagent' ? 'subagents' : role
  const current =
    role === 'orchestrator'
      ? topology.orchestrator
      : role === 'subagent'
        ? topology.subagents[0]
        : topology.panels[role][0]
  const slotId = current?.slotId ?? (role === 'subagent' ? 'subagent-1' : `${role}-1`)
  const next = {
    ...bindingForModel(slotId, selected),
    reasoningEffort: binding.reasoningEffort ?? selected.defaultReasoningEffort
  }
  return setSlot(topology, target, next, models)
}
