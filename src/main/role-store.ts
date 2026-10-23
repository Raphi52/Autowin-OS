import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_ROLES,
  isReasoningEffort,
  type Role,
  type RoleBinding,
  type RolesPersistes
} from './roles'
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
    if (rawOverride.advisorModel !== undefined && !nonEmptyString(rawOverride.advisorModel))
      return undefined
    if (
      rawOverride.reasoningEffort !== undefined &&
      !isReasoningEffort(rawOverride.reasoningEffort)
    ) {
      return undefined
    }
    decoded[rawPhase as PipelinePhase] = {
      ...(rawOverride.model === undefined ? {} : { model: rawOverride.model.trim() }),
      ...(rawOverride.advisorModel === undefined
        ? {}
        : { advisorModel: rawOverride.advisorModel.trim() }),
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

/** Clé du réglage « modèle des petites tâches », posée à côté des quatre rôles. */
const CLE_PETITES_TACHES = 'petitesTaches'
/** Interrupteur du build trivial sur Haiku (conv-1097, `roles.ts` modeleDuBuildTrivial). */
const CLE_BUILD_TRIVIAL = 'buildTrivialSurHaiku'

function decodeRoleBindings(value: unknown): RolesPersistes | undefined {
  if (!isPlainObject(value)) return undefined
  if (
    Object.keys(value).some(
      (cle) =>
        cle !== CLE_PETITES_TACHES && cle !== CLE_BUILD_TRIVIAL && !ALL_ROLES.includes(cle as Role)
    )
  ) {
    return undefined
  }
  if (value[CLE_BUILD_TRIVIAL] !== undefined && typeof value[CLE_BUILD_TRIVIAL] !== 'boolean')
    return undefined
  const decoded: RolesPersistes = {}
  for (const role of ALL_ROLES) {
    if (value[role] === undefined) continue
    const binding = decodeRoleBinding(value[role])
    if (!binding) return undefined
    decoded[role] = binding
  }
  if (value[CLE_PETITES_TACHES] !== undefined) {
    const petitesTaches = decodeRoleBinding(value[CLE_PETITES_TACHES])
    if (!petitesTaches) return undefined
    decoded.petitesTaches = petitesTaches
  }
  if (typeof value[CLE_BUILD_TRIVIAL] === 'boolean')
    decoded.buildTrivialSurHaiku = value[CLE_BUILD_TRIVIAL]
  return Object.keys(decoded).length > 0 ? decoded : undefined
}

function writeBindings(path: string, bindings: RolesPersistes): void {
  writeDurableJson(path, bindings, decodeRoleBindings)
}

export function loadRoleBindings(): RolesPersistes | undefined {
  const p = rolesPath()
  if (!existsSync(p) && !existsSync(`${p}.bak`)) return undefined
  try {
    return readDurableJson(p, decodeRoleBindings)
  } catch {
    return undefined
  }
}

/**
 * Écrit les quatre rôles, le réglage des petites tâches ET l'interrupteur du build trivial :
 * `roles.json` est réécrit en entier à chaque resynchronisation de la topologie, donc un appelant
 * qui oublierait l'un d'eux le ferait disparaître du disque.
 */
export function saveRoleBindings(
  bindings: Record<Role, RoleBinding>,
  petitesTaches: RoleBinding | undefined,
  buildTrivialSurHaiku?: boolean
): void {
  writeBindings(rolesPath(), {
    ...bindings,
    ...(petitesTaches ? { petitesTaches } : {}),
    ...(typeof buildTrivialSurHaiku === 'boolean' ? { buildTrivialSurHaiku } : {})
  })
}
