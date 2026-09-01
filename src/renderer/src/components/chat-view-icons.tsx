import type { WorkflowPanelSection } from './workflows-panel-sections'

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

/** Icône « inspecter » (loupe), monochrome via currentColor. */
export function InspectIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function WorkflowSectionIcon({
  section
}: {
  section: WorkflowPanelSection
}): React.JSX.Element {
  const common = {
    className: 'workflow-section-icon',
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
    focusable: false
  } as const

  if (section === 'subagents') {
    return (
      <svg {...common}>
        <circle cx="8" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="3.5" cy="12.5" r="1.75" stroke="currentColor" strokeWidth="1.25" />
        <circle cx="12.5" cy="12.5" r="1.75" stroke="currentColor" strokeWidth="1.25" />
        <path
          d="M8 4.8v2.1M3.5 10.7V9.5A2.5 2.5 0 0 1 6 7h4a2.5 2.5 0 0 1 2.5 2.5v1.2"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (section === 'run') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" />
        <path d="m6.7 5.5 4 2.5-4 2.5z" fill="currentColor" />
      </svg>
    )
  }

  if (section === 'journal') {
    return (
      <svg {...common}>
        <path
          d="M3.2 3.6h9.6M3.2 6.6h9.6M3.2 9.6h6.6M3.2 12.6h4.6"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (section === 'graph') {
    return (
      <svg {...common}>
        <path
          d="m5 5 5.7 1.3M5.2 6.1l2 5M10.5 7.5 8.7 11"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <circle cx="3.7" cy="4.7" r="1.8" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="12.2" cy="6.6" r="1.8" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="12.2" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <circle cx="4" cy="3" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="13" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="6" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M4 4.7v6.6M4 8h4.3A2.2 2.2 0 0 0 10.5 5.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
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
