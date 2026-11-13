import { useMemo, useState } from 'react'
import type { CoupureParLimiteDeModele } from '../../../shared/reprise-quota'
import {
  buildOrchestratorModelGroups,
  type OrchestratorModelOption,
  type RuntimeModel
} from './chat-view-model'
import { texteFil } from './chat-view-outils'

/**
 * UNE LIGNE DU BANDEAU DE REPRISE : les fils bloqués par la limite d'UN modèle.
 *
 * Le refus dit lui-même sa réponse (« Switch to another model to continue ») : la ligne propose les
 * modèles du catalogue, sauf celui qui a refusé, et ne reprend qu'au clic. Choisir dans la liste ne
 * fait encore rien : jamais de bascule de modèle sans le geste de l'utilisateur.
 */
export function LigneLimiteDeModele({
  coupure,
  models,
  onReprendre
}: {
  coupure: CoupureParLimiteDeModele
  models: RuntimeModel[]
  onReprendre: (ids: readonly string[], option: OrchestratorModelOption) => void
}): React.JSX.Element {
  const [choix, setChoix] = useState('')
  const options = useMemo(() => {
    const bloque = coupure.modele.toLowerCase()
    return buildOrchestratorModelGroups(models)
      .groups.flatMap((groupe) => groupe.options)
      .filter(
        (option) =>
          !option.model.toLowerCase().includes(bloque) &&
          !option.label.toLowerCase().includes(bloque)
      )
  }, [models, coupure.modele])
  const cle = (option: OrchestratorModelOption): string => `${option.provider}:${option.model}`
  const choisie = options.find((option) => cle(option) === choix)
  const n = coupure.ids.length
  return (
    <div className="conv-reprise-modele" data-testid="conv-reprise-modele">
      <span className="conv-auto-notice">
        {texteFil(n > 1 ? 'quota.limiteModele.plusieurs' : 'quota.limiteModele.une', {
          n,
          modele: coupure.modele
        })}
      </span>
      <select
        className="conv-reprise-modele-choix"
        data-testid="conv-reprise-modele-choix"
        aria-label={texteFil('quota.limiteModele.choisir.libelle', { modele: coupure.modele })}
        value={choix}
        onChange={(event) => setChoix(event.target.value)}
      >
        <option value="">{texteFil('quota.limiteModele.choisir')}</option>
        {options.map((option) => (
          <option key={cle(option)} value={cle(option)}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="conv-date-sort"
        data-testid="conv-reprise-modele-bouton"
        disabled={!choisie}
        title={texteFil('quota.limiteModele.reprendre.titre')}
        onClick={() => {
          if (choisie) onReprendre(coupure.ids, choisie)
        }}
      >
        {texteFil('quota.limiteModele.reprendre', { n })}
      </button>
    </div>
  )
}
