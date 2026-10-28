/**
 * LES PROJETS PARTAGÉS DU BOARD — le menu à cocher posé à côté du bouton 📁 (demande du 2026-10-28,
 * conv-1211 : « dans le board je veux qu'on puisse choisir quel CWD on partage »).
 *
 * Le dossier du Board (conv-1206) recopiait TOUS les projets sur le partage de l'équipe. Ce menu
 * coche ceux qui partent : un projet = un dossier de travail (ou une catégorie) de la barre latérale.
 * « Tous, y compris les prochains » rend le choix ouvert (`null`) ; dès qu'on décoche un projet, la
 * liste devient explicite et un projet nouveau ne part plus sans être coché
 * (`board-projets-partages.ts`). Le processus principal garde le choix et l'applique à l'écriture.
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  basculerProjetPartage,
  projetPartage,
  resumeDesProjetsPartages
} from '../../../shared/board-projets-partages'
import { useTextesBoardProjets } from '../textes-ecrans/board-projets'
import './ProjetsPartagesDuBoard.css'

export interface ProjetAffiche {
  cle: string
  libelle: string
  demandes: number
  /** Le dossier du Chat que la croix de la ligne retire ; absent = pas de croix (conv-1212). */
  retirable?: string
}

export function ProjetsPartagesDuBoard({
  projets,
  choisis,
  onChoisir,
  onRetirer
}: {
  /** Les projets de la carte affichée, dans son ordre (le plus récemment actif d'abord). */
  projets: readonly ProjetAffiche[]
  /** Le choix retenu sur le poste : `null` = tous. */
  choisis: readonly string[] | null
  onChoisir: (projets: string[] | null) => void
  /**
   * La croix au bout d'une ligne (conv-1212) : retire le dossier de la liste des dossiers de travail
   * du Chat, la même que la croix du menu « Ranger dans… » — il quitte le Chat ET le Board.
   */
  onRetirer?: (chemin: string) => void
}): React.JSX.Element {
  const { t, langue } = useTextesBoardProjets()
  // Singulier jusqu'à 1 en français (« 0 demande »), seulement à 1 en anglais (« 0 requests »).
  const singulier = (n: number): boolean => (langue === 'en' ? n === 1 : n <= 1)
  const [ouvert, setOuvert] = useState(false)
  const racine = useRef<HTMLDetailsElement>(null)
  const cles = projets.map((p) => p.cle)
  const resume = resumeDesProjetsPartages(choisis, cles)

  // Un clic hors du menu le referme : `<details>` seul resterait ouvert par-dessus la rivière.
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent): void => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  return (
    <details
      ref={racine}
      className="besoins-projets"
      data-testid="besoins-projets"
      open={ouvert}
      onToggle={(e) => setOuvert(e.currentTarget.open)}
    >
      <summary
        className="btn btn-sm"
        title={t('projets.aide')}
        data-testid="besoins-projets-bouton"
      >
        {resume.tous
          ? t('projets.tous')
          : t('projets.partie', { n: resume.partages, total: resume.total })}
      </summary>
      <div className="besoins-projets-menu" role="group" aria-label={t('projets.titre')}>
        <p className="besoins-projets-titre">{t('projets.titre')}</p>
        <label className="besoins-projets-ligne is-tous">
          <input
            type="checkbox"
            checked={choisis === null}
            data-testid="besoins-projets-tous"
            onChange={(e) => onChoisir(e.currentTarget.checked ? null : [...cles])}
          />
          <span>{t('projets.tousEtFuturs')}</span>
        </label>
        <div className="besoins-projets-liste">
          {projets.map((p) => (
            // La croix est SŒUR de la case, pas dedans : un clic sur elle ne doit pas cocher.
            <div key={p.cle} className="besoins-projets-ligne is-projet">
              <label className="besoins-projets-case" title={p.cle}>
                <input
                  type="checkbox"
                  checked={projetPartage(choisis, p.cle)}
                  data-testid={`besoins-projet-${p.cle}`}
                  onChange={() => onChoisir(basculerProjetPartage(choisis, p.cle, cles))}
                />
                <span className="besoins-projets-nom">{p.libelle}</span>
                <span className="besoins-projets-compte">
                  {t(singulier(p.demandes) ? 'projets.demande' : 'projets.demandes', {
                    n: p.demandes
                  })}
                </span>
              </label>
              {p.retirable && onRetirer && (
                <button
                  type="button"
                  className="besoins-projets-retirer"
                  data-testid={`besoins-projet-retirer-${p.cle}`}
                  title={t('projets.retirer', { chemin: p.retirable })}
                  aria-label={t('projets.retirer', { chemin: p.retirable })}
                  onClick={() => onRetirer(p.retirable as string)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {choisis !== null && <p className="besoins-projets-note">{t('projets.note')}</p>}
      </div>
    </details>
  )
}
