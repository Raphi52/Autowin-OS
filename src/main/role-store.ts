import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_ROLES, isReasoningEffort, type Role, type RoleBinding } from './roles'
import { ensureAutowinAppData } from './app-data'
import { PIPELINE_PHASES, type PipelinePhase } from './skill-pipeline'
import { readDurableJson, writeDurableJson } from './durable-json'

/**
 * Persistance disque de la config modèle-par-rôle (sinon elle se réinitialise à
 * chaque lancement). Garde RoleModelConfig PUR : le load/save vit ici, dans la
 * couche façade. Fichier : %APPDATA%\autowin-os\roles.json.
 */
function rolesPath(): string {
  return join(ensureAutowinAppData(), 'roles.json')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function decodePhaseModels(value: unknown): RoleBinding['phaseModel'] | undefined {
  if (!isPlainObject(value)) return undefined
  const decoded: NonNullable<RoleBinding['phaseModel']> = {}
  for (const [rawPhase, rawOverride] of Object.entries(value)) {
    if (!PIPELINE_PHASES.includes(rawPhase as PipelinePhase) || !isPlainObject(rawOverride)) {
      return undefined
    }
    if (rawOverride.model !== undefined && !nonEmptyString(rawOverride.model)) return undefined
    if (
      rawOverride.reasoningEffort !== undefined &&
      !isReasoningEffort(rawOverride.reasoningEffort)
    ) {
      return undefined
    }
    decoded[rawPhase as PipelinePhase] = {
      ...(rawOverride.model === undefined ? {} : { model: rawOverride.model.trim() }),
      ...(rawOverride.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: rawOverride.reasoningEffort })
    }
  }
  return decoded
}

export function decodeRoleBinding(value: unknown): RoleBinding | undefined {
  if (!isPlainObject(value) || !nonEmptyString(value.provider)) return undefined
  if (value.model !== undefined && !nonEmptyString(value.model)) return undefined
  if (value.reasoningEffort !== undefined && !isReasoningEffort(value.reasoningEffort))
    return undefined
  if (value.persona !== undefined && typeof value.persona !== 'string') return undefined
  const phaseModel =
    value.phaseModel === undefined ? undefined : decodePhaseModels(value.phaseModel)
  if (value.phaseModel !== undefined && phaseModel === undefined) return undefined
  return {
    provider: value.provider.trim(),
    ...(value.model === undefined ? {} : { model: value.model.trim() }),
    ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
    ...(value.persona === undefined ? {} : { persona: value.persona }),
    ...(phaseModel === undefined ? {} : { phaseModel })
  }
}

function decodeRoleBindings(value: unknown): Partial<Record<Role, RoleBinding>> | undefined {
  if (!isPlainObject(value)) return undefined
  if (Object.keys(value).some((role) => !ALL_ROLES.includes(role as Role))) return undefined
  const decoded: Partial<Record<Role, RoleBinding>> = {}
  for (const role of ALL_ROLES) {
    if (value[role] === undefined) continue
    const binding = decodeRoleBinding(value[role])
    if (!binding) return undefined
    decoded[role] = binding
  }
  return Object.keys(decoded).length > 0 ? decoded : undefined
}

function writeBindings(path: string, bindings: Partial<Record<Role, RoleBinding>>): void {
  writeDurableJson(path, bindings, decodeRoleBindings)
}

export function loadRoleBindings(): Partial<Record<Role, RoleBinding>> | undefined {
  const p = rolesPath()
  if (!existsSync(p) && !existsSync(`${p}.bak`)) return undefined
  try {
    return readDurableJson(p, decodeRoleBindings)
  } catch {
    return undefined
  }
}

export function saveRoleBindings(bindings: Record<Role, RoleBinding>): void {
  writeBindings(rolesPath(), bindings)
}
