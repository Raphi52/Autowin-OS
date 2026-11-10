import { demandeUltrathink, effortAvecUltrathink } from '../../shared/ultrathink'
import { effortsDeclaresDuModele, type ImportedModel } from '../modeles/models'
import type { ReasoningEffort, RoleBinding } from '../profil/roles'

/**
 * Sans entrée au catalogue (réglage sans modèle, catalogue pas encore chargé), seul Claude a une
 * réponse sûre : son CLI accepte `--effort xhigh` pour tous ses modèles. Un autre moteur rejette
 * un niveau qu'il ne connaît pas : on ne lui en invente pas.
 */
const EFFORTS_CLAUDE_HORS_CATALOGUE: readonly ReasoningEffort[] = ['xhigh']

/**
 * Le réglage d'UN tour de chat quand son message porte « ultrathink » : même moteur, même modèle,
 * réflexion montée pour ce tour seul. Le réglage reçu n'est jamais modifié : le tour suivant
 * repart de celui du fil. Sans le mot-clé, ou si rien ne monte, l'objet reçu est rendu tel quel.
 * Le catalogue n'est lu que si le mot-clé est là : un tour ordinaire ne paie rien.
 */
export function bindingAvecUltrathink(
  binding: RoleBinding,
  demande: string | undefined,
  catalogue: () => ImportedModel[] | undefined
): RoleBinding {
  if (!demandeUltrathink(demande)) return binding
  const proposes =
    effortsDeclaresDuModele(catalogue(), binding.provider, binding.model) ??
    (binding.provider === 'claude' ? EFFORTS_CLAUDE_HORS_CATALOGUE : undefined)
  const effort = effortAvecUltrathink(binding.reasoningEffort, proposes)
  if (effort === undefined || effort === binding.reasoningEffort) return binding
  return { ...binding, reasoningEffort: effort }
}
