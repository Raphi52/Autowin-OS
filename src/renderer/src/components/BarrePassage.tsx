/**
 * Barre flottante posée sur un passage sélectionné du fil (conv-1038, 2026-10-21) :
 * Citer · Détaille · C'est faux · Retiens ça. Le texte de chaque geste vit dans
 * `passage-selectionne.ts` ; ici, seulement l'affichage.
 */
import React from 'react'
import { ACTIONS_PASSAGE, type ActionPassage } from './passage-selectionne'
import './BarrePassage.css'

export type PassageAffiche = {
  texte: string
  /** Position dans le cadre du fil, en px : coin haut-gauche de la sélection. */
  gauche: number
  haut: number
}

export function BarrePassage({
  passage,
  onAction
}: {
  passage: PassageAffiche
  onAction: (action: ActionPassage, texte: string) => void
}): React.JSX.Element {
  return (
    <div
      className="barre-passage"
      data-testid="barre-passage"
      role="toolbar"
      aria-label="Répondre à ce passage"
      style={{ left: passage.gauche, top: passage.haut }}
      // Un appui sur la barre ne doit pas effacer la sélection qu'elle désigne.
      onMouseDown={(event) => event.preventDefault()}
    >
      {ACTIONS_PASSAGE.map(({ action, libelle, titre }) => (
        <button
          key={action}
          type="button"
          className="barre-passage-geste"
          data-action={action}
          title={titre}
          onClick={() => onAction(action, passage.texte)}
        >
          {libelle}
        </button>
      ))}
    </div>
  )
}
