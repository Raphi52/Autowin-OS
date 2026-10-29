/**
 * LE ROUAGE DU BOARD — le petit bouton ⚙ posé à côté du bouton 📁 (demande du 2026-10-28, conv-1230 :
 * « un ptit bouton rouage qui contiendra projet, le bouton refresh et le nom d'usage », au-dessus de
 * la liste des projets).
 *
 * Il ouvre un menu posé par-dessus la rivière : « Actualiser » (sorti de l'en-tête), « Ton nom sur
 * le Board » (le même réglage que Settings · Interface), puis la liste des projets recopiés
 * (`ProjetsPartagesDuBoard`, passée en `children` : elle n'existe qu'une fois un dossier choisi).
 */
import React, { useEffect, useRef, useState } from 'react'
import type { EtatDuDossierDuBoard } from '../../../shared/board-dossier'
import { useTextesBoardEtMaintenance } from '../textes-ecrans/board-et-maintenance'
import { useTextesBoardProjets } from '../textes-ecrans/board-projets'
import { NomSurLeBoardCompact } from './NomSurLeBoardReglage'
import './RouageDuBoard.css'

export function RouageDuBoard({
  chargement,
  onActualiser,
  onNomEnregistre,
  children
}: {
  /** Un calcul du Board tourne : « Actualiser » devient « Calcul… » et ne se reclique pas. */
  chargement: boolean
  onActualiser: () => void
  /** Le nom vient d'être enregistré : le Board se recalcule pour que ses post-it le portent. */
  onNomEnregistre?: (etat: EtatDuDossierDuBoard) => void
  /** La liste des projets, sous le nom ; absente sans dossier choisi. */
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useTextesBoardProjets()
  const { t: tBoard } = useTextesBoardEtMaintenance()
  const [ouvert, setOuvert] = useState(false)
  const racine = useRef<HTMLDetailsElement>(null)

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
      className="besoins-rouage"
      data-testid="besoins-rouage"
      open={ouvert}
      onToggle={(e) => setOuvert(e.currentTarget.open)}
    >
      <summary
        className="btn btn-sm besoins-rouage-bouton"
        title={t('rouage.aide')}
        aria-label={t('rouage.titre')}
        data-testid="besoins-rouage-bouton"
      >
        <span aria-hidden="true">⚙</span>
      </summary>
      <div className="besoins-rouage-menu" role="group" aria-label={t('rouage.titre')}>
        <button
          type="button"
          className="btn btn-sm besoins-rouage-actualiser"
          data-testid="besoins-actualiser"
          disabled={chargement}
          onClick={onActualiser}
        >
          {chargement ? tBoard('vue.calcul') : tBoard('vue.actualiser')}
        </button>
        <NomSurLeBoardCompact onEnregistre={onNomEnregistre} />
        {children}
      </div>
    </details>
  )
}
