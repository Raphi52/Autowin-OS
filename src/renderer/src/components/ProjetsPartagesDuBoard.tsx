/**
 * LES PROJETS PARTAGÉS DU BOARD — la liste à cocher du rouage ⚙ posé à côté du bouton 📁 (demande du
 * 2026-10-28, : « dans le board je veux qu'on puisse choisir quel CWD on partage »). Elle
 * avait son propre bouton « Projets : … » ; (« un ptit bouton rouage qui contiendra
 * projet, le bouton refresh et le nom d'usage »), c'est `RouageDuBoard` qui l'ouvre.
 *
 * Le dossier du Board recopiait TOUS les projets sur le partage de l'équipe. Ce menu
 * coche ceux qui partent : un projet = un dossier de travail (ou une catégorie) de la barre latérale.
 * « Tous, y compris les prochains » rend le choix ouvert (`null`) ; dès qu'on décoche un projet, la
 * liste devient explicite et un projet nouveau ne part plus sans être coché
 * (`board-projets-partages.ts`). Le processus principal garde le choix et l'applique à l'écriture.
 */
import React from 'react'
import {
  basculerProjetPartage,
  projetPartage,
  resumeDesProjetsPartages
} from '../../../shared/board-projets-partages'
import { basculerProjetMasque, projetMasque } from '../../../shared/board-projets-masques'
import { useTextesBoardProjets } from '../textes-ecrans/board-projets'
import './ProjetsPartagesDuBoard.css'

export interface ProjetAffiche {
  cle: string
  libelle: string
  demandes: number
  /** Le dossier du Chat que la croix de la ligne retire ; absent = pas de croix. */
  retirable?: string
}

export function ProjetsPartagesDuBoard({
  projets,
  choisis,
  onChoisir,
  onRetirer,
  masques = [],
  onMasquer
}: {
  /** Les projets de la carte affichée, dans son ordre (le plus récemment actif d'abord). */
  projets: readonly ProjetAffiche[]
  /** Le choix retenu sur le poste : `null` = tous. */
  choisis: readonly string[] | null
  onChoisir: (projets: string[] | null) => void
  /**
   * La croix au bout d'une ligne : retire le dossier de la liste des dossiers de travail
   * du Chat, la même que la croix du menu « Ranger dans… » — il quitte le Chat ET le Board.
   */
  onRetirer?: (chemin: string) => void
  /** Les projets masqués sur CE poste : retirés de l'écran, jamais de la copie partagée. */
  masques?: readonly string[]
  /** Cocher ou décocher « Masquer sur ce poste » : absent = pas de case de masquage. */
  onMasquer?: (masques: string[]) => void
}): React.JSX.Element {
  const { t, langue } = useTextesBoardProjets()
  // Singulier jusqu'à 1 en français (« 0 demande »), seulement à 1 en anglais (« 0 requests »).
  const singulier = (n: number): boolean => (langue === 'en' ? n === 1 : n <= 1)
  const cles = projets.map((p) => p.cle)
  const resume = resumeDesProjetsPartages(choisis, cles)
  // Un projet masqué reste dans la liste : la note le dit, pour qu'on sache le revoir.
  const masquesAffiches = projets.filter((p) => projetMasque(masques, p.cle)).length

  return (
    <div
      className="besoins-projets"
      data-testid="besoins-projets"
      role="group"
      aria-label={t('projets.titre')}
    >
      {/* L'ancien libellé du bouton « Projets » devient le titre de la partie : le compte reste lu
          d'un coup d'œil une fois le rouage ouvert. */}
      <p
        className="besoins-projets-titre"
        title={t('projets.aide')}
        data-testid="besoins-projets-resume"
      >
        {resume.tous
          ? t('projets.tous')
          : t('projets.partie', { n: resume.partages, total: resume.total })}
      </p>
      <label className="besoins-projets-ligne is-tous">
        <input
          type="checkbox"
          checked={choisis === null}
          data-testid="besoins-projets-tous"
          onChange={(e) => onChoisir(e.currentTarget.checked ? null : [...cles])}
        />
        <span>{t('projets.tousEtFuturs')}</span>
      </label>
      {/* Les deux colonnes de cases, légendées : « recopier » part sur le partage, « masquer » ne
          touche qu'à l'écran de ce poste. */}
      {onMasquer && projets.length > 0 && (
        <div className="besoins-projets-entete">
          <span className="besoins-projets-entete-recopier">{t('projets.recopier')}</span>
          <span className="besoins-projets-entete-masquer">{t('projets.masquer')}</span>
          <span className="besoins-projets-retirer-place" aria-hidden="true" />
        </div>
      )}
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
            {onMasquer && (
              <label className="besoins-projets-masquer" title={t('projets.masquerAide')}>
                <input
                  type="checkbox"
                  checked={projetMasque(masques, p.cle)}
                  data-testid={`besoins-projet-masque-${p.cle}`}
                  aria-label={`${t('projets.masquer')} : ${p.libelle}`}
                  onChange={() => onMasquer(basculerProjetMasque(masques, p.cle))}
                />
              </label>
            )}
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
            {/* Sans croix, la place reste : les cases « masquer » s'alignent sur l'en-tête. */}
            {onMasquer && !(p.retirable && onRetirer) && (
              <span className="besoins-projets-retirer-place" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      {choisis !== null && <p className="besoins-projets-note">{t('projets.note')}</p>}
      {masquesAffiches > 0 && (
        <p className="besoins-projets-note" data-testid="besoins-projets-masques-note">
          {t('projets.masquesNote')}
        </p>
      )}
    </div>
  )
}
