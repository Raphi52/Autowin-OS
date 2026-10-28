import { useState } from 'react'
import { copierBilanEnImage } from './run-bilan-copie'
import { libelleDuVerdict, type RunBilan } from './run-bilan'
import { useTextesChatExecution } from '../textes-ecrans/chat-execution'

/**
 * Carte « bilan de run » PARTAGEABLE : le même bilan est affiché en HTML (lisible, sélectionnable)
 * et peint en SVG pour la copie en image. Un seul modèle des deux côtés — deux rendus jumeaux
 * finiraient par diverger.
 *
 * La copie passe par un canvas local : aucune requête réseau, aucune dépendance ajoutée.
 */
export function RunBilanCard({ bilan }: { bilan: RunBilan }): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const [etat, setEtat] = useState<'pret' | 'copie' | 'refus'>('pret')

  return (
    <figure className="run-bilan" data-testid="run-bilan" data-verdict={bilan.verdict}>
      <figcaption className="run-bilan__entete">
        <span className="run-bilan__kicker">{t('carte.kicker')}</span>
        <span className="run-bilan__verdict" data-testid="run-bilan-verdict">
          {libelleDuVerdict(bilan.verdict)}
        </span>
      </figcaption>
      <p className="run-bilan__titre">{bilan.titre}</p>
      <dl className="run-bilan__lignes">
        {bilan.lignes.map((l) => (
          <div key={l.label} className="run-bilan__ligne" data-testid="run-bilan-ligne">
            <dt>{l.label}</dt>
            <dd>{l.valeur}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="run-bilan__copier"
        data-testid="run-bilan-copier"
        onClick={() => {
          void copierBilanEnImage(bilan).then((ok) => setEtat(ok ? 'copie' : 'refus'))
        }}
      >
        {etat === 'copie'
          ? t('carte.copiee')
          : etat === 'refus'
            ? t('carte.refusee')
            : t('carte.copier')}
      </button>
    </figure>
  )
}
