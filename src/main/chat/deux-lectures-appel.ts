import { randomUUID } from 'node:crypto'
import type { CostSink } from '../dashboards/cost'
import type { TraceDesLectures } from './deux-lectures'
import { noterAppelCourt, signalerPanneAppelCourt } from '../orchestration/petites-taches-trace'
import type { ProviderRegistry } from '../providers/registry'
import type { RoleModelConfig } from '../profil/roles'

/**
 * LE LECTEUR « DEUX LECTURES » BRANCHÉ DANS LE PILOTE, sorti de `index.ts`.
 *
 * Il part sur le modèle des petites tâches (réglage du Routeur) ; une panne est nommée puis rejetée,
 * et le pilote fait alors partir le travail comme avant. Chaque réponse écrit UNE ligne dans
 * `cost.jsonl`, désormais sous le FIL du tour et avec la décision du contrôle.
 * Mesuré le 2026-11-02 : 716 lignes `deuxLectures` sans fil, donc absentes du coût par fil, et 527
 * issues coupées avant la deuxième lecture. Sorti de `index.ts` pour être exécuté par un test : une
 * fermeture locale du processus principal n'est atteignable par aucun import.
 */
export function lecteurDeDeuxLectures(deps: {
  registry: Pick<ProviderRegistry, 'send'>
  roles: Pick<RoleModelConfig, 'bindingDesPetitesTaches'>
  cost: CostSink
}): (systeme: string, charge: string, trace: TraceDesLectures) => Promise<string> {
  return async (systeme, charge, trace) => {
    const binding = deps.roles.bindingDesPetitesTaches()
    const reponse = await deps.registry
      .send(binding.provider, [{ role: 'user', content: charge }], {
        system: systeme,
        systemBlocks: [{ name: 'deuxLectures', chars: systeme.length }],
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        requestId: randomUUID()
      })
      .catch((error: unknown) => {
        signalerPanneAppelCourt('deuxLectures', error)
        throw error
      })
    const texte = reponse.text ?? ''
    noterAppelCourt(deps.cost, {
      appel: 'deuxLectures',
      binding,
      res: reponse,
      issue: trace.issue(texte),
      conversationId: trace.conversationId
    })
    return texte
  }
}
