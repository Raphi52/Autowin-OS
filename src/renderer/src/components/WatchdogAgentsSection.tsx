import {
  describeOccurrenceStatus,
  describeOutcome,
  describeWatchdogGuards,
  describeWatchdogSource,
  outcomeTone,
  splitByTrigger,
  watchdogHistory,
  watchdogSummary,
  type WatchdogOccurrenceLike,
  type WatchdogTaskLike
} from './watchdog-section-model'
import { useTextesTaskManager } from '../textes-ecrans/task-manager'
import { riche } from '../textes'

/**
 * « Watchdog Agents » — les règles qui peuvent lancer un agent SANS que personne ne le demande.
 *
 * La section montre trois choses, et c'est délibéré : ce qui déclenche, ce qui BORNE, et ce que
 * l'agent a CONCLU. Les bornes sont visibles en permanence plutôt que repliées dans un formulaire :
 * ce sont elles qui rendent tenable une règle capable d'écrire toute seule.
 *
 * Les libellés suivent la langue de l'interface (conv-1170). « Watchdog Agents » reste tel quel :
 * c'est le nom de la fonction, le même dans les deux langues.
 */

type Props = {
  tasks: WatchdogTaskLike[]
  occurrences: WatchdogOccurrenceLike[]
  formatDateTime: (value: number | null) => string
  onCreate: () => void
  onSelect: (taskId: string) => void
  onConfigure: (taskId: string) => void
}

export function WatchdogAgentsSection({
  tasks,
  occurrences,
  formatDateTime,
  onCreate,
  onSelect,
  onConfigure
}: Props): React.JSX.Element {
  const { t } = useTextesTaskManager()
  const { watchdog } = splitByTrigger(tasks)
  const summary = watchdogSummary(tasks, occurrences)

  return (
    <section className="watchdog-section" data-testid="watchdog-agents-section">
      <header className="watchdog-section-head">
        <div>
          {/* « Watchdog Agents » : nom de la fonction, le même en anglais (conv-1170). */}
          <h2>Watchdog Agents</h2>
          <p>{riche(t('section.intro'))}</p>
        </div>
        <button type="button" className="task-manager-primary" onClick={onCreate}>
          {t('section.nouvelleRegle')}
        </button>
      </header>

      <div className="watchdog-stats">
        <span>
          <strong>{summary.rules}</strong> {t('section.stats.regles')}
        </span>
        <span>
          <strong>{summary.active}</strong> {t('section.stats.armees')}
        </span>
        <span>
          <strong>{summary.triggers}</strong> {t('section.stats.reveils')}
        </span>
        <span
          className={summary.pendingTriage ? 'watchdog-pending' : ''}
          title={t('section.stats.sansIssue.titre')}
        >
          <strong>{summary.pendingTriage}</strong> {t('section.stats.sansIssue')}
        </span>
        <span className={summary.failures ? 'watchdog-failed' : ''}>
          <strong>{summary.failures}</strong>{' '}
          {t(summary.failures === 1 ? 'section.stats.echec' : 'section.stats.echecs')}
        </span>
        <span className={summary.cancellations ? 'watchdog-cancelled' : ''}>
          <strong>{summary.cancellations}</strong>{' '}
          {t(
            summary.cancellations === 1 ? 'section.stats.annulation' : 'section.stats.annulations'
          )}
        </span>
      </div>

      {watchdog.length === 0 ? (
        <p className="watchdog-empty">
          {t('section.vide.debut')} <code>app.log</code> {t('section.vide.milieu')}{' '}
          <code>ERROR</code>
          {t('section.vide.fin')}
        </p>
      ) : (
        <ul className="watchdog-rules">
          {watchdog.map((task) => {
            const history = watchdogHistory(occurrences, task.id)
            return (
              <li key={task.id} className={task.enabled ? 'is-armed' : 'is-disarmed'}>
                <button
                  type="button"
                  className="watchdog-rule-main"
                  onClick={() => onSelect(task.id)}
                >
                  <span className="watchdog-rule-title">
                    {task.title}
                    <span className="watchdog-rule-state">
                      {task.enabled ? t('section.regle.armee') : t('section.regle.desarmee')}
                    </span>
                  </span>
                  <span className="watchdog-rule-source">
                    {describeWatchdogSource(task.watchdog!.source)}
                  </span>
                  <span className="watchdog-rule-guards">
                    {describeWatchdogGuards(task.watchdog!.guards)}
                  </span>
                </button>
                <button
                  type="button"
                  className="watchdog-rule-configure"
                  onClick={() => onConfigure(task.id)}
                >
                  {t('section.regle.parametrer')}
                </button>
                {history.length > 0 && (
                  <ol className="watchdog-rule-history">
                    {history.slice(0, 4).map((entry) => (
                      <li key={entry.id}>
                        <span className={`watchdog-status status-${entry.status}`}>
                          {describeOccurrenceStatus(entry.status)}
                        </span>
                        <span className={`watchdog-outcome is-${outcomeTone(entry.outcome)}`}>
                          {describeOutcome(entry.outcome)}
                        </span>
                        <time>{formatDateTime(entry.scheduledFor)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
