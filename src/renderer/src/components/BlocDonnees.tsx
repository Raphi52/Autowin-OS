/**
 * BLOC DE DONNEES DESSINE PAR L'APP (conv-1074, 2026-10-22) — le pendant affichage de
 * `src/shared/blocs-donnees.ts`.
 *
 * Le modele n'envoie qu'un JSON (```aw-tableau, ```aw-comparaison, ```aw-etapes) ; ce composant en
 * fait la mise en page avec les classes et les jetons du theme choisi. Aucun HTML du modele n'entre
 * ici : React echappe chaque texte, il n'y a donc rien a filtrer.
 *
 * Direction visuelle reprise des pages html-render (choix utilisateur « transparence totale ») :
 * aucun panneau ni fond opaque, des filets fins, l'or pour les accents.
 */
import { useRef } from 'react'
import type {
  BlocDonnees as Donnees,
  CelluleDonnee,
  StatutEtape
} from '../../../shared/blocs-donnees'
import { useAjusterALaLargeur } from './ajuster-a-la-largeur'
import './BlocDonnees.css'

const classeDuTon = (cellule: CelluleDonnee): string | undefined =>
  cellule.ton ? `md-donnees__ton--${cellule.ton}` : undefined

const STATUTS: Record<StatutEtape, { glyphe: string; libelle: string }> = {
  fait: { glyphe: '✓', libelle: 'fait' },
  'en-cours': { glyphe: '●', libelle: 'en cours' },
  'a-faire': { glyphe: '○', libelle: 'à faire' },
  echec: { glyphe: '✕', libelle: 'échec' }
}

function Tableau({
  donnees,
  source
}: {
  donnees: Extract<Donnees, { forme: 'aw-tableau' }>
  source: string
}): React.JSX.Element {
  // Meme regle que les tableaux Markdown du fil : trop large, il est reduit, jamais mis a defiler.
  const ref = useRef<HTMLDivElement>(null)
  useAjusterALaLargeur(ref, source)
  return (
    <>
      <div ref={ref} className="md-table-wrap">
        <table className="md-table">
          <thead>
            <tr>
              {donnees.colonnes.map((colonne, rang) => (
                <th key={rang}>{colonne}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {donnees.lignes.map((ligne, rang) => (
              <tr key={rang}>
                {ligne.map((cellule, col) => (
                  <td key={col} className={classeDuTon(cellule)}>
                    {cellule.texte}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {donnees.note ? <div className="md-donnees__note">{donnees.note}</div> : null}
    </>
  )
}

function Comparaison({
  donnees
}: {
  donnees: Extract<Donnees, { forme: 'aw-comparaison' }>
}): React.JSX.Element {
  return (
    <div className="md-donnees__options">
      {donnees.options.map((option, rang) => (
        <section
          key={rang}
          className="md-donnees__option"
          data-testid="donnees-option"
          data-recommande={option.recommande ? 'oui' : undefined}
        >
          {option.recommande ? <div className="md-donnees__recommande">Recommandé</div> : null}
          <div className="md-donnees__nom">{option.nom}</div>
          {option.points.length ? (
            <ul className="md-donnees__points">
              {option.points.map((point, n) => (
                <li key={n}>{point}</li>
              ))}
            </ul>
          ) : null}
          {option.verdict ? (
            <div
              className={['md-donnees__verdict', classeDuTon(option.verdict)]
                .filter(Boolean)
                .join(' ')}
            >
              {option.verdict.texte}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

function Etapes({
  donnees
}: {
  donnees: Extract<Donnees, { forme: 'aw-etapes' }>
}): React.JSX.Element {
  return (
    <ol className="md-donnees__etapes">
      {donnees.etapes.map((etape, rang) => {
        // Une etape sans statut est une etape A FAIRE : c'est la lecture d'un plan.
        const statut = etape.statut ?? 'a-faire'
        return (
          <li key={rang} data-statut={statut}>
            <span
              className="md-donnees__statut"
              role="img"
              aria-label={STATUTS[statut].libelle}
              title={STATUTS[statut].libelle}
            >
              {STATUTS[statut].glyphe}
            </span>
            <span className="md-donnees__rang">{rang + 1}.</span>
            <span className="md-donnees__etape">
              <span className="md-donnees__etape-titre">{etape.titre}</span>
              {etape.detail ? <span className="md-donnees__detail">{etape.detail}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function BlocDonnees({
  donnees,
  source
}: {
  donnees: Donnees
  source: string
}): React.JSX.Element {
  return (
    <div className="md-donnees" data-testid="chat-bloc-donnees" data-forme={donnees.forme}>
      {donnees.titre ? <div className="md-donnees__titre">{donnees.titre}</div> : null}
      {donnees.forme === 'aw-tableau' ? (
        <Tableau donnees={donnees} source={source} />
      ) : donnees.forme === 'aw-comparaison' ? (
        <Comparaison donnees={donnees} />
      ) : (
        <Etapes donnees={donnees} />
      )}
    </div>
  )
}
