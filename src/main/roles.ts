// Configuration du modele par role du pipeline autowin.
// Chaque role (orchestrator, subagent, judge, scout) est lie a un provider
// (claude, codex, ...) et optionnellement a un modele precis ; si le modele
// est absent, le provider utilise son modele par defaut.

import type { PipelinePhase } from './skill-pipeline'

export type Role = 'orchestrator' | 'subagent' | 'judge' | 'scout'

export const ALL_ROLES: Role[] = ['orchestrator', 'subagent', 'judge', 'scout']

export interface RoleBinding {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
  /**
   * Override de modèle PAR PHASE (proportionnalité coût/latence) : les phases d'analyse
   * (scout/frame/terrain) peuvent tourner sur un petit modèle rapide, build/juge sur le gros.
   * Générique : référence des modèles du provider ACTIF, jamais un id figé. Absent pour une phase
   * → on retombe sur `model`/`reasoningEffort` du binding (rétrocompat → 0 régression).
   */
  phaseModel?: Partial<Record<PipelinePhase, { model?: string; reasoningEffort?: ReasoningEffort }>>
}

/** Résout le (modèle, effort) EFFECTIF d'une phase pour un binding (override phase → défaut binding). */
export function resolvePhaseBinding(
  binding: RoleBinding,
  phase: PipelinePhase
): { model?: string; reasoningEffort?: ReasoningEffort } {
  const override = binding.phaseModel?.[phase]
  return {
    model: override?.model ?? binding.model,
    reasoningEffort: override?.reasoningEffort ?? binding.reasoningEffort
  }
}

const PROVIDER_DEFAULT_SELECTIONS: Record<
  string,
  { model: string; reasoningEffort: ReasoningEffort }
> = {
  claude: { model: 'claude-fable-5', reasoningEffort: 'high' },
  codex: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  kimi: { model: 'kimi-code/kimi-for-coding', reasoningEffort: 'none' }
}

/** Rend explicite ce que l'adaptateur utiliserait sinon implicitement. */
export function normalizeRoleBinding(binding: RoleBinding): RoleBinding {
  const defaults = PROVIDER_DEFAULT_SELECTIONS[binding.provider]
  if (!defaults) return { ...binding }
  return {
    ...binding,
    model: binding.model ?? defaults.model,
    reasoningEffort: binding.reasoningEffort ?? defaults.reasoningEffort
  }
}

/** Config par defaut raisonnable : claude pour l'essentiel, codex pour le scout. */
const DEFAULT_BINDINGS: Record<Role, RoleBinding> = {
  orchestrator: normalizeRoleBinding({ provider: 'claude' }),
  subagent: normalizeRoleBinding({ provider: 'claude' }),
  judge: normalizeRoleBinding({ provider: 'claude' }),
  scout: normalizeRoleBinding({ provider: 'codex' })
}

export class RoleModelConfig {
  private bindings: Record<Role, RoleBinding>

  constructor(defaults?: Partial<Record<Role, RoleBinding>>) {
    // Fusion superficielle : chaque role explicitement fourni remplace entierement
    // le binding par defaut correspondant (pas de merge partiel provider/model).
    this.bindings = { ...DEFAULT_BINDINGS }
    if (defaults) {
      for (const role of ALL_ROLES) {
        const override = defaults[role]
        if (override) {
          this.bindings[role] = normalizeRoleBinding(override)
        }
      }
    }
  }

  getBinding(role: Role): RoleBinding {
    // Garde runtime defensive : le type Role empeche deja les valeurs invalides
    // a la compilation, mais on se protege d'un appel JS non type ou d'une
    // valeur corrompue a l'execution.
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    return this.bindings[role]
  }

  setBinding(role: Role, b: RoleBinding): this {
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Role inconnu: ${String(role)}`)
    }
    this.bindings[role] = normalizeRoleBinding(b)
    return this
  }

  all(): Record<Role, RoleBinding> {
    return { ...this.bindings }
  }
}

/**
 * Effort de raisonnement d'un binding atomique. La liste est le SUR-ENSEMBLE
 * possible ; chaque modèle importé déclare le sous-ensemble qu'il supporte
 * réellement (cf. ImportedModel.reasoningEfforts) et chaque adaptateur rejette
 * explicitement une valeur qu'il ne sait pas transmettre (cf. providers/*).
 */
export type ReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
