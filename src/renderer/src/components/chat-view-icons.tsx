/** Icône « brancher » (fork) — deux nœuds reliés, monochrome via currentColor. */
export function ForkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="13" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 4.8v6.4M4 8h4a2 2 0 0 0 2-2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/*
 * Icone « volet de details » — un cadre dont la colonne DROITE est detachee, exactement ce que le
 * bouton fait : ouvrir le panneau de droite (runs, etapes, RUN.md).
 *
 * Pourquoi elle existe : ce bouton portait `ForkIcon`, la MEME icone que le nom de branche affiche
 * deux centimetres a sa gauche dans la meme barre. Deux actions sans rapport partageaient donc le
 * meme symbole, et aucune des deux ne se lisait.
 */
export function PanelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <rect
        x="1.7"
        y="2.7"
        width="12.6"
        height="10.6"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M10 2.7v10.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** Icône « inspecter » (loupe), monochrome via currentColor. */
export function InspectIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function WorkflowRefreshIcon(): React.JSX.Element {
  return (
    <svg className="workflow-action-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.2 5.2A5.6 5.6 0 1 0 13 11M13.2 2.5v2.8h-2.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WorkflowCloseIcon(): React.JSX.Element {
  return (
    <svg className="workflow-action-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4.2 4.2 7.6 7.6m0-7.6-7.6 7.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function RunTrashIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6 4.5V3.2h4v1.3m-5.5 0 .6 8.3h5.8l.6-8.3M6.7 6.5v4.2m2.6-4.2v4.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
