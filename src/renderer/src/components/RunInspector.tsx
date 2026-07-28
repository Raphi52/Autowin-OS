import { BrainMarkdown } from './BrainMarkdown'
import { extractRunSections } from './run-inspector-model'
import './RunInspector.css'

type RunInspectorProps = {
  source: string
  status: string
  regime?: string
  dodChecked: number
  dodTotal: number
  journalEvents: number
  defauts: number
}

export function RunInspector({ source, status, regime, dodChecked, dodTotal, journalEvents, defauts }: RunInspectorProps): React.JSX.Element {
  const sections = extractRunSections(source)

  return (
    <div className="run-inspector">
      <div className="run-inspector__summary" aria-label="Synthèse du run">
        <span className="badge">{status}</span>
        {regime && <span className="badge">{regime}</span>}
        <span className="run-inspector__metric">DoD {dodChecked}/{dodTotal}</span>
        <span className="run-inspector__metric">Journal {journalEvents}</span>
        <span className="run-inspector__metric">Défauts {defauts}</span>
      </div>
      <nav className="run-inspector__nav" aria-label="Sections du RUN">
        {sections.map((section) => (
          <a key={section.id} href={`#run-section-${section.id}`} aria-disabled={!section.present}>
            {section.title}
          </a>
        ))}
      </nav>
      <div className="run-inspector__content">
        {sections.map((section) => (
          <section key={section.id} id={`run-section-${section.id}`} className="run-inspector__section">
            <h3>{section.title}</h3>
            {section.present ? (
              <BrainMarkdown source={section.content} />
            ) : (
              <p className="c-faint">Section absente.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
