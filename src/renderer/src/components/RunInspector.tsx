import { useRef } from 'react'
import { BrainMarkdown } from './BrainMarkdown'
import './RunInspector.css'

type RunInspectorSummary = {
  status: string
  regime?: string
  dodChecked: number
  dodTotal: number
  journalEvents: number
  defauts: number
}

const SECTIONS = ['Besoin', 'Contraintes', 'Options', 'SOP', 'Journal', 'Défauts', 'Reprise']

function hasSection(content: string, section: string): boolean {
  return new RegExp(`^## ${section}(?:\\s|$)`, 'm').test(content)
}

export function RunInspector({
  content,
  summary
}: {
  content: string
  summary: RunInspectorSummary
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  let headingIndex = 0
  const sections = SECTIONS.map((name) => {
    const present = hasSection(content, name)
    const index = present ? headingIndex++ : undefined
    return { name, present, index }
  })

  function jumpToSection(index: number | undefined): void {
    if (index === undefined) return
    contentRef.current?.querySelectorAll('h2')[index]?.scrollIntoView({ block: 'start' })
  }

  return (
    <section className="run-inspector" aria-label="Inspecteur du RUN">
      <div className="run-inspector__summary" data-testid="run-summary">
        <span className="badge">{summary.status}</span>
        {summary.regime && <span className="badge">{summary.regime}</span>}
        <span>
          DoD {summary.dodChecked}/{summary.dodTotal}
        </span>
        <span>Journal {summary.journalEvents}</span>
        <span>Défauts {summary.defauts}</span>
      </div>
      <nav
        className="run-inspector__nav"
        data-testid="run-section-nav"
        aria-label="Sections du RUN"
      >
        {sections.map(({ name, present, index }) => (
          <button
            key={name}
            type="button"
            disabled={!present}
            title={present ? `Aller à ${name}` : `${name} absent`}
            onClick={() => jumpToSection(index)}
          >
            {present ? name : `${name} absent`}
          </button>
        ))}
      </nav>
      <div ref={contentRef} className="run-inspector__content">
        <BrainMarkdown source={content} />
      </div>
    </section>
  )
}
