import { useRef } from 'react'
import { BrainMarkdown } from './BrainMarkdown'
import { apercuDuRun } from './run-inspector-apercu'
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
  const sections = SECTIONS.map((name) => ({ name, present: hasSection(content, name) }))
  const apercu = apercuDuRun(content)

  /**
   * On vise le titre qui PORTE le nom de la section, jamais le n-ieme titre : un RUN.md contient
   * des titres de niveau 2 hors de cette liste, et compter les titres envoyait alors ailleurs.
   */
  function jumpToSection(name: string): void {
    const titres = [...(contentRef.current?.querySelectorAll('h2') ?? [])]
    const cible = titres.find((h) => (h.textContent ?? '').trim() === name)
    cible?.scrollIntoView({ block: 'start' })
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
      {(apercu.besoin || apercu.dodRestants.length > 0 || apercu.defauts.length > 0) && (
        <div className="run-inspector__apercu" data-testid="run-apercu">
          {apercu.besoin && <p className="run-inspector__besoin">{apercu.besoin}</p>}
          {apercu.dodRestants.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">Reste à cocher</span>
              <ul>
                {apercu.dodRestants.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {apercu.defauts.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">Défauts</span>
              <ul>
                {apercu.defauts.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {apercu.fichiers.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">Fichiers</span>
              <span className="run-inspector__fichiers">
                {apercu.fichiers.slice(0, 6).map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      <nav
        className="run-inspector__nav"
        data-testid="run-section-nav"
        aria-label="Sections du RUN"
      >
        {sections.map(({ name, present }) => (
          <button
            key={name}
            type="button"
            disabled={!present}
            title={present ? `Aller à ${name}` : `${name} absent`}
            onClick={() => jumpToSection(name)}
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
