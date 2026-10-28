import {
  DEFAULT_DRAFT_GUARDS,
  DEFAULT_FILE_SOURCE,
  type WatchdogAppEvent,
  type WatchdogRule
} from './watchdog-section-model'
import { useTextesTaskManager, type CleTaskManager } from '../textes-ecrans/task-manager'

/**
 * Saisie d'une règle de réveil.
 *
 * Les BORNES sont dans le formulaire principal, pas repliées derrière un « options avancées » :
 * ce sont elles qui décident si un agent capable d'écrire tout seul peut partir en boucle ou en
 * rafale. Les cacher reviendrait à faire signer un pouvoir sans montrer ses limites.
 *
 * Les libellés suivent la langue de l'interface (conv-1170). Les exemples de saisie (chemin de
 * log, motif ERROR|FATAL) restent tels quels : des valeurs techniques, les mêmes dans les deux langues.
 */

// Des CLÉS de texte, traduites au rendu : le libellé suit la langue de l'interface (conv-1170).
const APP_EVENTS: { value: WatchdogAppEvent; label: CleTaskManager }[] = [
  { value: 'orchestration-red', label: 'regle.evenement.orchestrationRouge' },
  { value: 'workflow-gate-failed', label: 'regle.evenement.gateRefuse' },
  { value: 'workflow-unverified', label: 'regle.evenement.sansPreuve' },
  { value: 'workflow-proof-lost', label: 'regle.evenement.preuvesPerdues' },
  { value: 'task-failed', label: 'regle.evenement.tacheEchoue' },
  { value: 'task-missed', label: 'regle.evenement.tacheManquee' }
]

type Props = {
  rule: WatchdogRule
  onChange: (rule: WatchdogRule) => void
}

export function WatchdogRuleFields({ rule, onChange }: Props): React.JSX.Element {
  const { t } = useTextesTaskManager()
  const setGuards = (patch: Partial<WatchdogRule['guards']>): void =>
    onChange({ ...rule, guards: { ...rule.guards, ...patch } })

  // Capture NARROWÉE : `rule.source` est un accès de propriété, dont TypeScript perd le
  // rétrécissement dans les callbacks. Un const local le conserve.
  const source = rule.source

  return (
    <div className="watchdog-fields" data-testid="watchdog-rule-fields">
      <label className="task-manager-field task-manager-field-wide">
        <span>{t('regle.source')}</span>
        <select
          value={rule.source.kind}
          data-testid="watchdog-source-kind"
          onChange={(event) =>
            onChange({
              ...rule,
              source:
                event.target.value === 'app-event'
                  ? { kind: 'app-event', events: ['task-failed'] }
                  : event.target.value === 'outlook-mail'
                    ? { kind: 'outlook-mail' }
                    : { ...DEFAULT_FILE_SOURCE }
            })
          }
        >
          <option value="file-match">{t('regle.source.fichier')}</option>
          <option value="app-event">{t('regle.source.evenement')}</option>
          <option value="outlook-mail">{t('regle.source.mail')}</option>
        </select>
      </label>

      {source.kind === 'file-match' ? (
        <>
          <label className="task-manager-field task-manager-field-wide">
            <span>{t('regle.fichier')}</span>
            <input
              type="text"
              value={source.path}
              placeholder="C:\\logs\\app.log"
              data-testid="watchdog-path"
              onChange={(event) =>
                onChange({ ...rule, source: { ...source, path: event.target.value } })
              }
            />
          </label>
          <label className="task-manager-field">
            <span>{t('regle.motif')}</span>
            <input
              type="text"
              value={source.pattern}
              placeholder="ERROR|FATAL"
              data-testid="watchdog-pattern"
              onChange={(event) =>
                onChange({ ...rule, source: { ...source, pattern: event.target.value } })
              }
            />
          </label>
          <label className="task-manager-switch">
            <input
              type="checkbox"
              checked={source.caseSensitive ?? false}
              onChange={(event) =>
                onChange({
                  ...rule,
                  source: { ...source, caseSensitive: event.target.checked || undefined }
                })
              }
            />
            <span>{t('regle.casse')}</span>
          </label>
        </>
      ) : source.kind === 'app-event' ? (
        <fieldset className="task-manager-field task-manager-field-wide watchdog-events">
          <legend>{t('regle.evenements')}</legend>
          {APP_EVENTS.map((entry) => (
            <label key={entry.value} className="task-manager-switch">
              <input
                type="checkbox"
                checked={source.events.includes(entry.value)}
                data-testid={`watchdog-event-${entry.value}`}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    // `...source` garde le fil surveillé posé par `task_create` (conv-1069).
                    source: {
                      ...source,
                      events: event.target.checked
                        ? [...source.events, entry.value]
                        : source.events.filter((value) => value !== entry.value)
                    }
                  })
                }
              />
              <span>{t(entry.label)}</span>
            </label>
          ))}
          {source.events.length === 0 && (
            <p className="watchdog-fields-warning" role="status">
              {t('regle.aucunEvenement')}
            </p>
          )}
        </fieldset>
      ) : (
        <>
          <label className="task-manager-field task-manager-field-wide">
            <span>{t('regle.canal')}</span>
            <select
              value={source.channel ?? 'both'}
              data-testid="watchdog-mail-channel"
              onChange={(event) => {
                const value = event.target.value
                const { channel: _old, ...rest } = source
                void _old
                onChange({
                  ...rule,
                  source:
                    value === 'outlook' || value === 'teams' ? { ...rest, channel: value } : rest
                })
              }}
            >
              <option value="outlook">{t('regle.canal.outlook')}</option>
              <option value="teams">{t('regle.canal.teams')}</option>
              <option value="both">{t('regle.canal.lesDeux')}</option>
            </select>
          </label>
          <label className="task-manager-field task-manager-field-wide">
            <span>{t('regle.nouveaux')}</span>
            <select
              value={source.newSenders ?? 'reply'}
              data-testid="watchdog-mail-new-senders"
              onChange={(event) => {
                const { newSenders: _old, ...rest } = source
                void _old
                onChange({
                  ...rule,
                  source: event.target.value === 'ignore' ? { ...rest, newSenders: 'ignore' } : rest
                })
              }}
            >
              <option value="reply">{t('regle.nouveaux.repondre')}</option>
              <option value="ignore">{t('regle.nouveaux.ignorer')}</option>
            </select>
          </label>
          <fieldset className="task-manager-field task-manager-field-wide watchdog-events watchdog-senders" data-testid="watchdog-senders">
            <legend>{t('regle.interlocuteurs')}</legend>
            {Object.keys(source.senders ?? {}).length === 0 ? (
              <p className="watchdog-fields-note">
                {t(
                  source.newSenders === 'ignore'
                    ? 'regle.aucunInterlocuteur.decoches'
                    : 'regle.aucunInterlocuteur.coches'
                )}
              </p>
            ) : (
              Object.entries(source.senders ?? {})
                .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                .map(([key, sender]) => (
                  <label key={key} className="task-manager-switch">
                    <input
                      type="checkbox"
                      checked={sender.enabled}
                      onChange={(event) =>
                        onChange({
                          ...rule,
                          source: {
                            ...source,
                            senders: {
                              ...source.senders,
                              [key]: { ...sender, enabled: event.target.checked }
                            }
                          }
                        })
                      }
                    />
                    <span>
                      {sender.name}
                      {sender.name.toLowerCase() !== key && !key.startsWith('teams:') && (
                        <small> — {key}</small>
                      )}
                    </span>
                  </label>
                ))
            )}
          </fieldset>
        </>
      )}

      <label className="task-manager-field task-manager-field-wide">
        <span>{t('regle.action')}</span>
        <select
          value={rule.action ?? 'chat'}
          data-testid="watchdog-action"
          onChange={(event) =>
            onChange({
              ...rule,
              action: event.target.value === 'orchestration' ? 'orchestration' : 'chat'
            })
          }
        >
          <option value="chat">{t('regle.action.chat')}</option>
          <option value="orchestration">{t('regle.action.orchestration')}</option>
        </select>
      </label>

      <p className="watchdog-fields-note">{t('regle.bornes.note')}</p>

      <label className="task-manager-field">
        <span>{t('regle.parHeure')}</span>
        <input
          type="number"
          min={1}
          max={240}
          value={rule.guards.maxTriggersPerHour}
          data-testid="watchdog-max-per-hour"
          onChange={(event) =>
            setGuards({ maxTriggersPerHour: Math.max(1, Number(event.target.value)) })
          }
        />
      </label>

      <label className="task-manager-field">
        <span>{t('regle.parJour')}</span>
        <input
          type="number"
          min={1}
          max={5_760}
          value={rule.guards.maxTriggersPerDay ?? ''}
          data-testid="watchdog-max-per-day"
          onChange={(event) =>
            setGuards({
              maxTriggersPerDay:
                event.target.value === '' ? undefined : Math.max(1, Number(event.target.value))
            })
          }
        />
      </label>

      <label className="task-manager-field">
        <span>{t('regle.budget')}</span>
        <input
          type="number"
          min={0.01}
          max={10_000}
          step={0.01}
          value={rule.guards.maxKnownCostUsdPerDay ?? ''}
          data-testid="watchdog-cost-per-day"
          onChange={(event) =>
            setGuards({
              maxKnownCostUsdPerDay:
                event.target.value === '' ? undefined : Math.max(0.01, Number(event.target.value))
            })
          }
        />
      </label>

      <label className="task-manager-field">
        <span>{t('regle.nonChiffres')}</span>
        <input
          type="number"
          min={1}
          max={5_760}
          value={rule.guards.maxUnpricedCallsPerDay ?? ''}
          data-testid="watchdog-unpriced-per-day"
          onChange={(event) =>
            setGuards({
              maxUnpricedCallsPerDay:
                event.target.value === '' ? undefined : Math.max(1, Number(event.target.value))
            })
          }
        />
      </label>

      <label className="task-manager-field">
        <span>{t('regle.apaisement')}</span>
        <input
          type="number"
          min={0}
          max={86_400}
          value={Math.round(rule.guards.dedupWindowMs / 1000)}
          data-testid="watchdog-dedup-seconds"
          onChange={(event) =>
            setGuards({ dedupWindowMs: Math.max(0, Number(event.target.value)) * 1000 })
          }
        />
      </label>

      <label className="task-manager-field">
        <span>{t('regle.parCause')}</span>
        <input
          type="number"
          min={1}
          max={500}
          value={rule.guards.maxPerRoot}
          data-testid="watchdog-max-per-root"
          onChange={(event) => setGuards({ maxPerRoot: Math.max(1, Number(event.target.value)) })}
        />
      </label>

      <label className="task-manager-field task-manager-field-wide">
        <span>{t('regle.chaine')}</span>
        <select
          value={String(rule.guards.maxChainDepth)}
          data-testid="watchdog-chain-depth"
          onChange={(event) => setGuards({ maxChainDepth: Number(event.target.value) })}
        >
          {/* Le défaut refuse la chaîne : c'est le réglage sûr, et il doit être le premier. */}
          <option value="0">{t('regle.chaine.non')}</option>
          <option value="1">{t('regle.chaine.une')}</option>
          <option value="2">{t('regle.chaine.deux')}</option>
          <option value="3">{t('regle.chaine.trois')}</option>
        </select>
      </label>

      {rule.guards.maxChainDepth > 0 && (
        <p className="watchdog-fields-warning" role="status">
          {t('regle.chaine.avertissement')}
        </p>
      )}

      <button
        type="button"
        className="watchdog-fields-reset"
        onClick={() => onChange({ ...rule, guards: { ...DEFAULT_DRAFT_GUARDS } })}
      >
        {t('regle.retablir')}
      </button>
    </div>
  )
}
