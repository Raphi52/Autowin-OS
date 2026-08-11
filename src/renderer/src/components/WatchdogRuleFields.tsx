import {
  DEFAULT_DRAFT_GUARDS,
  DEFAULT_FILE_SOURCE,
  type WatchdogAppEvent,
  type WatchdogRule
} from './watchdog-section-model'

/**
 * Saisie d'une règle de réveil.
 *
 * Les BORNES sont dans le formulaire principal, pas repliées derrière un « options avancées » :
 * ce sont elles qui décident si un agent capable d'écrire tout seul peut partir en boucle ou en
 * rafale. Les cacher reviendrait à faire signer un pouvoir sans montrer ses limites.
 */

const APP_EVENTS: { value: WatchdogAppEvent; label: string }[] = [
  { value: 'orchestration-red', label: 'Une orchestration se termine en ROUGE' },
  { value: 'workflow-gate-failed', label: 'Le gate REFUSE la preuve d’un workflow' },
  {
    value: 'workflow-unverified',
    label: 'Un workflow se dit RÉUSSI sans preuve de validation (le plus silencieux)'
  },
  { value: 'workflow-proof-lost', label: 'Une reprise PERD des preuves de son journal' },
  { value: 'task-failed', label: 'Une tâche planifiée échoue' },
  { value: 'task-missed', label: 'Une tâche planifiée est manquée' }
]

type Props = {
  rule: WatchdogRule
  onChange: (rule: WatchdogRule) => void
}

export function WatchdogRuleFields({ rule, onChange }: Props): React.JSX.Element {
  const setGuards = (patch: Partial<WatchdogRule['guards']>): void =>
    onChange({ ...rule, guards: { ...rule.guards, ...patch } })

  // Capture NARROWÉE : `rule.source` est un accès de propriété, dont TypeScript perd le
  // rétrécissement dans les callbacks. Un const local le conserve.
  const source = rule.source

  return (
    <div className="watchdog-fields" data-testid="watchdog-rule-fields">
      <label className="task-manager-field task-manager-field-wide">
        <span>Ce qui réveille l’agent</span>
        <select
          value={rule.source.kind}
          data-testid="watchdog-source-kind"
          onChange={(event) =>
            onChange({
              ...rule,
              source:
                event.target.value === 'app-event'
                  ? { kind: 'app-event', events: ['task-failed'] }
                  : { ...DEFAULT_FILE_SOURCE }
            })
          }
        >
          <option value="file-match">Une ligne dans un fichier surveillé</option>
          <option value="app-event">Un événement interne d’Autowin</option>
        </select>
      </label>

      {source.kind === 'file-match' ? (
        <>
          <label className="task-manager-field task-manager-field-wide">
            <span>Fichier à surveiller</span>
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
            <span>Déclenche si la ligne contient</span>
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
            <span>Respecter la casse</span>
          </label>
        </>
      ) : (
        <fieldset className="task-manager-field task-manager-field-wide watchdog-events">
          <legend>Événements surveillés</legend>
          {APP_EVENTS.map((entry) => (
            <label key={entry.value} className="task-manager-switch">
              <input
                type="checkbox"
                checked={source.events.includes(entry.value)}
                data-testid={`watchdog-event-${entry.value}`}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    source: {
                      kind: 'app-event',
                      events: event.target.checked
                        ? [...source.events, entry.value]
                        : source.events.filter((value) => value !== entry.value)
                    }
                  })
                }
              />
              <span>{entry.label}</span>
            </label>
          ))}
          {source.events.length === 0 && (
            <p className="watchdog-fields-warning" role="status">
              Aucun événement coché : cette règle ne se déclenchera jamais.
            </p>
          )}
        </fieldset>
      )}

      <label className="task-manager-field task-manager-field-wide">
        <span>Ce que fait l’agent réveillé</span>
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
          <option value="chat">Il analyse et rapporte (un tour de conversation)</option>
          <option value="orchestration">
            Il lance le pipeline complet — cadrage, correctif, gate à preuve et juge
          </option>
        </select>
      </label>

      <p className="watchdog-fields-note">
        Ces bornes empêchent un réveil de partir en rafale, de dépasser son budget ou d’élargir une
        cascade sans limite. Un agent réveillé peut travailler sans que personne regarde. Les appels
        non chiffrés ont leur propre coupe-circuit : une absence de tarif ne vaut jamais coût nul.
      </p>

      <label className="task-manager-field">
        <span>Réveils maximum par heure</span>
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
        <span>Réveils maximum par 24 heures</span>
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
        <span>Coupe-circuit du coût connu sur 24 heures ($)</span>
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
        <span>Appels non chiffrés maximum par 24 heures</span>
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
        <span>Ignorer un signal identique pendant (secondes)</span>
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
        <span>Réveils max issus d’une même cause</span>
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
        <span>Un réveil peut-il en déclencher un autre&nbsp;?</span>
        <select
          value={String(rule.guards.maxChainDepth)}
          data-testid="watchdog-chain-depth"
          onChange={(event) => setGuards({ maxChainDepth: Number(event.target.value) })}
        >
          {/* Le défaut refuse la chaîne : c'est le réglage sûr, et il doit être le premier. */}
          <option value="0">Non — un réveil ne peut pas en provoquer un autre (conseillé)</option>
          <option value="1">Oui, une fois</option>
          <option value="2">Oui, jusqu’à deux niveaux</option>
          <option value="3">Oui, jusqu’à trois niveaux</option>
        </select>
      </label>

      {rule.guards.maxChainDepth > 0 && (
        <p className="watchdog-fields-warning" role="status">
          Une réparation qui modifie la source surveillée pourra se re-déclencher. À n’autoriser que
          si tu sais pourquoi.
        </p>
      )}

      <button
        type="button"
        className="watchdog-fields-reset"
        onClick={() => onChange({ ...rule, guards: { ...DEFAULT_DRAFT_GUARDS } })}
      >
        Rétablir les bornes conseillées
      </button>
    </div>
  )
}
