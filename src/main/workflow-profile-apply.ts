import type { Role, RoleBinding } from './roles'
import type { PipelinePhase } from './skill-pipeline'
import type { WorkflowProfile } from './workflow-profiles'
import type { NodePhase } from './skill-pipeline'

/**
 * Traduire un workflow nommé en réglages effectifs pour un run.
 *
 * Le profil est un ENSEMBLE D'ÉCARTS, pas une configuration complète : tout ce qu'il ne dit pas doit
 * rester tel quel. C'est ce qui permet de comparer deux façons de faire en ne changeant QU'UNE
 * variable — si appliquer un profil réécrivait toute la configuration, on ne saurait jamais à quoi
 * attribuer l'écart de résultat.
 *
 * Fonction PURE : elle ne lit ni disque ni état global, donc son comportement est vérifiable sans
 * lancer quoi que ce soit.
 */

export interface WorkflowBaseConfig {
  roles: Partial<Record<Role, RoleBinding>>
  phases?: PipelinePhase[]
  allocation?: {
    phaseMembers?: Partial<Record<PipelinePhase, number>>
    judgeMembers?: number
    maxGreedyNodes?: number
  }
}

export interface EffectiveWorkflow extends WorkflowBaseConfig {
  /** Profil appliqué, ou `undefined` si la configuration courante l'emporte. */
  profileId?: string
  /** Consigne effective pour une phase, avec la façon dont elle doit être combinée au skill. */
  instructionFor: (phase: NodePhase) => { mode: 'append' | 'replace'; text: string } | undefined
}

/** Fusionne un écart de rôle sur son binding : les champs absents du profil ne sont PAS écrasés. */
function mergeRole(base: RoleBinding | undefined, patch: Partial<RoleBinding>): RoleBinding {
  const provider = patch.provider ?? base?.provider
  if (!provider) {
    // Un rôle sans provider n'est pas exécutable : on garde la base plutôt que de fabriquer un
    // binding boiteux à partir d'un profil incomplet.
    throw new Error('binding de rôle sans provider')
  }
  return {
    ...base,
    ...patch,
    provider
  }
}

export function applyWorkflowProfile(
  base: WorkflowBaseConfig,
  profile?: WorkflowProfile
): EffectiveWorkflow {
  if (!profile) {
    return { ...base, instructionFor: () => undefined }
  }

  const roles: Partial<Record<Role, RoleBinding>> = { ...base.roles }
  for (const [role, patch] of Object.entries(profile.roles ?? {})) {
    const key = role as Role
    try {
      roles[key] = mergeRole(base.roles[key], patch)
    } catch {
      // Écart inapplicable → on conserve la configuration courante pour ce rôle, sans faire échouer
      // tout le profil : un réglage douteux ne doit pas empêcher de lancer.
    }
  }

  // Les phases se REMPLACENT (une liste partielle n'aurait pas de sens), l'allocation se FUSIONNE
  // clé par clé (on peut vouloir n'imposer que la taille du jury).
  const phases = profile.phases?.length ? [...profile.phases] : base.phases
  const allocation =
    profile.allocation || base.allocation
      ? {
          ...base.allocation,
          ...profile.allocation,
          ...(profile.allocation?.phaseMembers || base.allocation?.phaseMembers
            ? {
                phaseMembers: {
                  ...base.allocation?.phaseMembers,
                  ...profile.allocation?.phaseMembers
                }
              }
            : {})
        }
      : undefined

  const instructions = profile.instructions
  return {
    roles,
    ...(phases ? { phases } : {}),
    ...(allocation ? { allocation } : {}),
    profileId: profile.id,
    instructionFor: (phase) => {
      if (!instructions) return undefined
      // Une consigne de phase prime sur la consigne globale : c'est le point de la granularité.
      const text = instructions.perPhase?.[phase] ?? instructions.text
      return text ? { mode: instructions.mode, text } : undefined
    }
  }
}
