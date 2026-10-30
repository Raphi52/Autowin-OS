import type { ReactElement } from 'react'
import { estUnEcran, nomDeZone, useTextesBarriere } from '../textes-ecrans/barriere-erreur'
import './BarriereErreur.css'

/**
 * Ce que `BarriereErreur` affiche à la place du composant tombé. Dans son propre fichier : la règle de
 * lint du rechargement à chaud refuse un composant local à côté d'une classe exportée.
 *
 * `racine` : plus rien n'est monté, son bouton recharge l'interface ; ailleurs, il relance le bloc.
 */
export function BlocEnPanne({
  zone,
  racine,
  detail,
  relancer
}: {
  zone: string
  racine: boolean
  detail: string
  relancer: () => void
}): ReactElement {
  const { langue, t } = useTextesBarriere()
  const niveau = racine ? 'racine' : estUnEcran(zone) ? 'vue' : 'bloc'
  const nom = nomDeZone(zone, langue)
  return (
    <div
      className={`barriere-erreur barriere-erreur--${niveau}`}
      role="alert"
      data-testid="barriere-erreur"
      data-zone={zone}
      data-niveau={niveau}
    >
      <strong className="barriere-erreur__titre">
        {racine
          ? t('barriere.titreRacine')
          : t(niveau === 'vue' ? 'barriere.titreVue' : 'barriere.titreBloc', { nom })}
      </strong>
      <code className="barriere-erreur__detail">{detail || t('barriere.sansDetail')}</code>
      <span className="barriere-erreur__suite">
        {t(racine ? 'barriere.suiteRacine' : 'barriere.suite')}
      </span>
      <button
        type="button"
        className="barriere-erreur__bouton"
        data-testid="barriere-reessayer"
        onClick={relancer}
      >
        {t(racine ? 'barriere.recharger' : 'barriere.reessayer')}
      </button>
    </div>
  )
}
