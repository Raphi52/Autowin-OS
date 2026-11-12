/**
 * LE PROFIL « DÉFAUT », PRÉSENT SUR CHAQUE POSTE SANS RIEN ENREGISTRER.
 *
 * Les profils d'Agent Studio vivent dans un fichier propre au poste : un collègue qui installe
 * l'app n'en a aucun, et rien ne lui dit quel réglage est le bon. Ce profil est donc porté par le
 * code, pas par le fichier : il apparaît en tête de liste chez tout le monde et ne peut pas être
 * écrasé.
 *
 * Réglage voulu : orchestrateur Fable 5.2 en effort moyen, un sous-agent Haiku 5.5 en effort max,
 * petites tâches Haiku 5.5 en effort max. Le catalogue de modèles est découvert sur chaque poste :
 * si la version exacte n'y est pas, on prend la dernière de la même famille, et un effort que le
 * modèle ne propose pas retombe sur son effort par défaut — jamais un modèle inventé.
 */
import { findModel, type ImportedModel } from '../modeles/models'
import type { AgentTopology, SlotBinding } from '../topologie/topology'
import type { AutowinProfile } from './profile-store'
import type { ReasoningEffort, Role, RoleBinding } from './roles'
import { ID_DU_PROFIL_DEFAUT } from '../../shared/profil-defaut-id'

export { ID_DU_PROFIL_DEFAUT }
const NOM_DU_PROFIL_DEFAUT = 'Défaut'

interface Souhait {
  /** Version voulue, puis alias de famille qui suit la dernière version. */
  ids: readonly string[]
  effort: ReasoningEffort
}

const ORCHESTRATEUR: Souhait = {
  ids: ['claude/claude-fable-5-2', 'claude/fable'],
  effort: 'medium'
}
const LEGER: Souhait = { ids: ['claude/claude-haiku-5-5', 'claude/haiku'], effort: 'max' }

function resoudre(
  souhait: Souhait,
  models: ImportedModel[]
): { model: ImportedModel; effort: ReasoningEffort } | null {
  for (const id of souhait.ids) {
    const model = findModel(models, id)
    if (model?.provider !== 'claude') continue
    return {
      model,
      effort: model.reasoningEfforts.includes(souhait.effort)
        ? souhait.effort
        : model.defaultReasoningEffort
    }
  }
  return null
}

function slot(
  slotId: string,
  choix: { model: ImportedModel; effort: ReasoningEffort }
): SlotBinding {
  return {
    slotId,
    provider: choix.model.provider,
    modelId: choix.model.id,
    reasoningEffort: choix.effort
  }
}

export interface ProfilDefaut {
  profile: AutowinProfile
  /** Le modèle des petites tâches n'est pas dans la topologie : il s'applique à part. */
  petitesTaches: RoleBinding
}

/**
 * Le profil « Défaut » pour ce catalogue, ou `null` si une des deux familles y manque (poste sans
 * Claude) : mieux vaut ne pas le proposer qu'en proposer un qui ne s'appliquerait pas.
 */
export function profilParDefaut(
  models: ImportedModel[],
  roles: Record<Role, RoleBinding>
): ProfilDefaut | null {
  const orchestrateur = resoudre(ORCHESTRATEUR, models)
  const leger = resoudre(LEGER, models)
  if (!orchestrateur || !leger) return null
  const topology: AgentTopology = {
    version: 1,
    orchestrator: slot('orchestrator', orchestrateur),
    subagents: [slot('subagent-1', leger)],
    panels: { scout: [], frame: [], terrain: [], judge: [] }
  }
  return {
    profile: {
      schema: 'autowin.profile/v1',
      id: ID_DU_PROFIL_DEFAUT,
      name: NOM_DU_PROFIL_DEFAUT,
      // Date fixe : ce profil ne change qu'avec le code.
      updatedAt: '2026-11-10T00:00:00.000Z',
      topology,
      roles
    },
    petitesTaches: {
      provider: leger.model.provider,
      model: leger.model.model,
      reasoningEffort: leger.effort
    }
  }
}

/** La liste montrée à l'écran : « Défaut » en tête, puis les profils enregistrés sur le poste. */
export function avecProfilDefaut(
  enregistres: AutowinProfile[],
  defaut: ProfilDefaut | null
): AutowinProfile[] {
  const autres = enregistres.filter((profil) => profil.id !== ID_DU_PROFIL_DEFAUT)
  return defaut ? [defaut.profile, ...autres] : autres
}
