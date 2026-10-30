/**
 * NAVIGATEUR INTÉGRÉ DU CHAT — la frise des gestes de l'agent (conv-1286, maquette approuvée
 * « 1 · Jalons · Aperçu du geste suivant », 2026-10-30).
 *
 * Un jalon par geste sur l'onglet actif, pour suivre d'un coup d'œil ce que l'agent fait de la page :
 * la couleur dit s'il lit ou s'il agit, le dessin du point dit où en est le geste. Les six derniers
 * seulement : le panneau peut être étroit, et les plus anciens n'aident plus à décider d'une pause.
 *
 * Contrat : `src/shared/navigateur.ts` ; dessin des points et du bandeau voisin :
 * `FriseGestesNavigateur.css`.
 */
import type { GesteNavigateur, VerbeGesteNavigateur } from '../../../shared/navigateur'
import {
  gestesDeLOnglet,
  tempsDepuis,
  texteNavigateur,
  type CleNavigateur
} from './navigateur-integre-outils'
import './FriseGestesNavigateur.css'

const JALONS_AFFICHES = 6

const LIBELLE_VERBE: Record<VerbeGesteNavigateur, CleNavigateur> = {
  ouvrir: 'verbeOuvrir',
  lire: 'verbeLire',
  capture: 'verbeCapture',
  clic: 'verbeClic',
  saisir: 'verbeSaisir',
  touche: 'verbeTouche',
  defiler: 'verbeDefiler'
}

export interface PropsFriseGestesNavigateur {
  /** Les gestes du fil, tous onglets : le tri par onglet se fait ici. */
  gestes: readonly GesteNavigateur[]
  ongletActif: string | null
}

export function FriseGestesNavigateur({
  gestes,
  ongletActif
}: PropsFriseGestesNavigateur): React.JSX.Element | null {
  const t = texteNavigateur
  const jalons = gestesDeLOnglet(gestes, ongletActif).slice(-JALONS_AFFICHES)
  if (jalons.length === 0) return null
  const origine = jalons[0].debut
  return (
    <div className="navigateur-frise" data-testid="navigateur-frise">
      <ol className="navigateur-frise-jalons" aria-label={t('friseGestes')}>
        {jalons.map((geste) => (
          <li
            key={geste.id}
            className={`navigateur-jalon ${geste.nature}${geste.etat === 'fait' ? '' : ` ${geste.etat}`}`}
            title={geste.description}
          >
            <span className="navigateur-jalon-point" aria-hidden="true" />
            <span className="navigateur-jalon-verbe">{t(LIBELLE_VERBE[geste.verbe])}</span>
            <span className="navigateur-jalon-temps">{tempsDepuis(geste.debut, origine)}</span>
          </li>
        ))}
      </ol>
      <p className="navigateur-frise-legende">
        <span className="navigateur-legende-lit">{t('legendeLit')}</span>
        {' · '}
        <span className="navigateur-legende-agit">{t('legendeAgit')}</span>
        {` · ${t('legendeEtats')}`}
      </p>
    </div>
  )
}
