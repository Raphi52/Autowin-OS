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

/**
 * « Watchdog Agents » — les règles qui peuvent lancer un agent SANS que personne ne le demande.
 *
 * La section montre trois choses, et c'est délibéré : ce qui déclenche, ce qui BORNE, et ce que
 * l'agent a CONCLU. Les bornes sont visibles en permanence plutôt que repliées dans un formulaire :
 * ce sont elles qui rendent tenable une règle capable d'écrire toute seule.
 */

type Props = {
  tasks: WatchdogTaskLike[]
  occurrences: WatchdogOccurrenceLike[]
  formatDateTime: (value: number | null) => string
  onCreate: () => void
  onSelect: (taskId: string) => void
}

export function WatchdogAgentsSection({
  tasks,
  occurrences,
  formatDateTime,
  onCreate,
  onSelect
}: Props): React.JSX.Element {
  const { watchdog } = splitByTrigger(tasks)
  const summary = watchdogSummary(tasks, occurrences)

  return (
    <section className="watchdog-section" data-testid="watchdog-agents-section">
      <header className="watchdog-section-head">
        <div>
          <h2>Watchdog Agents</h2>
          <p>
            Des agents réveillés par ce qui <strong>arrive</strong>, pas par l’horloge : une ligne
            dans un log, une orchestration rouge, une tâche qui échoue.
          </p>
        </div>
        <button type="button" className="task-manager-primary" onClick={onCreate}>
          + Règle de réveil
        </button>
      </header>

      <div className="watchdog-stats">
        <span>
          <strong>{summary.rules}</strong> règles
        </span>
        <span>
          <strong>{summary.active}</strong> armées
        </span>
        <span>
          <strong>{summary.triggers}</strong> réveils
        </span>
        <span
          className={summary.pendingTriage ? 'watchdog-pending' : ''}
          title="Réveils dont on ignore la conclusion de l’agent."
        >
          <strong>{summary.pendingTriage}</strong> sans issue
        </span>
        <span className={summary.failures ? 'watchdog-failed' : ''}>
          <strong>{summary.failures}</strong> échec{summary.failures === 1 ? '' : 's'}
        </span>
        <span className={summary.cancellations ? 'watchdog-cancelled' : ''}>
          <strong>{summary.cancellations}</strong> annulation
          {summary.cancellations === 1 ? '' : 's'}
        </span>
      </div>

      {watchdog.length === 0 ? (
        <p className="watchdog-empty">
          Aucune règle. Un exemple : surveiller <code>app.log</code> et réveiller un agent dès
          qu’une ligne contient <code>ERROR</code>, pour qu’il tranche entre bénin, rapport,
          investigation et réparation.
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
                      {task.enabled ? 'armée' : 'désarmée'}
                    </span>
                  </span>
                  <span className="watchdog-rule-source">
                    {describeWatchdogSource(task.watchdog!.source)}
                  </span>
                  <span className="watchdog-rule-guards">
                    {describeWatchdogGuards(task.watchdog!.guards)}
                  </span>
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
