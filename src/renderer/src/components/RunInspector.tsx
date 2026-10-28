import { useRef } from 'react'
import { BrainMarkdown } from './BrainMarkdown'
import { apercuDuRun } from './run-inspector-apercu'
import { RunBilanCard } from './RunBilanCard'
import { bilanDepuisResume } from './run-bilan'
import { useTextesChatExecution } from '../textes-ecrans/chat-execution'
import './RunBilanCard.css'
import './RunInspector.css'

type RunInspectorSummary = {
  status: string
  regime?: string
  dodChecked: number
  dodTotal: number
  journalEvents: number
  defauts: number
}

// Les titres de section d'un RUN.md, en français dans les deux langues : ce sont ceux du document
// affiché dessous, et `jumpToSection` les compare au texte de ses titres (conv-1170).
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
  const { t } = useTextesChatExecution()
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
    <section className="run-inspector" aria-label={t('inspecteur.titre')}>
      <div className="run-inspector__summary" data-testid="run-summary">
        <span className="badge">{summary.status}</span>
        {summary.regime && <span className="badge">{summary.regime}</span>}
        <span>
          DoD {summary.dodChecked}/{summary.dodTotal}
        </span>
        <span>{t('inspecteur.journal', { n: summary.journalEvents })}</span>
        <span>{t('inspecteur.defauts', { n: summary.defauts })}</span>
      </div>
      <RunBilanCard bilan={bilanDepuisResume(summary, apercu.besoin)} />
      {(apercu.besoin || apercu.dodRestants.length > 0 || apercu.defauts.length > 0) && (
        <div className="run-inspector__apercu" data-testid="run-apercu">
          {apercu.besoin && <p className="run-inspector__besoin">{apercu.besoin}</p>}
          {apercu.dodRestants.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">{t('inspecteur.reste-a-cocher')}</span>
              <ul>
                {apercu.dodRestants.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {apercu.defauts.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">{t('inspecteur.kicker.defauts')}</span>
              <ul>
                {apercu.defauts.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {apercu.fichiers.length > 0 && (
            <div className="run-inspector__ligne">
              <span className="run-inspector__kicker">{t('inspecteur.fichiers')}</span>
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
        aria-label={t('inspecteur.sections')}
      >
        {sections.map(({ name, present }) => (
          <button
            key={name}
            type="button"
            disabled={!present}
            title={
              present
                ? t('inspecteur.aller-a', { section: name })
                : t('inspecteur.absent', { section: name })
            }
            onClick={() => jumpToSection(name)}
          >
            {present ? name : t('inspecteur.absent', { section: name })}
          </button>
        ))}
      </nav>
      <div ref={contentRef} className="run-inspector__content">
        <BrainMarkdown source={content} />
      </div>
    </section>
  )
}
