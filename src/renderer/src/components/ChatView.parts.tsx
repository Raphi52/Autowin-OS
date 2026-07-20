import { HumanJson } from './HumanJson'
import { STEP_META, type ChatActionPart, type OrchStep } from './chat-view-model'
import './ChatView.css'

const CMD_LABEL: Record<string, string> = {
  navigate: 'Navigation',
  chat_send: 'Message',
  orchestrate: 'Orchestration',
  create_conversation: 'Conversation créée',
  rename_conversation: 'Conversation renommée',
  remove_conversation: 'Conversation supprimée',
  set_role: 'Rôle réglé',
  resolve_decision: 'Décision résolue',
  load_graph: 'Graphe chargé',
  get_state: 'Lecture d’état'
}

/** Fil des sous-agents (exec/juge/gate) — réutilisé en direct et dans le détail d'un run. */
export function StepThread({ steps }: { steps: OrchStep[] }): React.JSX.Element {
  return (
    <div className="col" style={{ gap: 'var(--s2)' }}>
      {steps.map((s, i) => {
        const meta = STEP_META[s.step] ?? { icon: '•', label: s.step }
        return (
          <div key={i} className="subagent-step">
            <div className="row gap2" style={{ fontSize: 11 }}>
              <span>{meta.icon}</span>
              <span className="c-dim" style={{ fontWeight: 600 }}>
                {meta.label}
              </span>
              {s.provider && <span className="mono c-accent">{s.provider}</span>}
              {s.detail && <span className="c-faint">{s.detail}</span>}
              {typeof s.costUsd === 'number' && (
                <span className="c-faint tnum" style={{ marginLeft: 'auto' }}>
                  {s.costUsd.toFixed(4)} $
                </span>
              )}
            </div>
            {s.text && <div className="subagent-text c-dim">{s.text}</div>}
            {s.prompt && (
              <details className="prompt-envelope">
                <summary>Voir le prompt envoyé</summary>
                <div className="prompt-envelope-meta">
                  <span>{s.prompt.provider}</span>
                  {s.prompt.model && <span>{s.prompt.model}</span>}
                  <span>{s.prompt.transport}</span>
                </div>
                <p className="prompt-envelope-limit">{s.prompt.limitation}</p>
                <strong>Système · instructions + skills/contexte injectés</strong>
                <pre>{s.prompt.system || 'Aucun bloc système.'}</pre>
                <strong>Messages transmis</strong>
                {s.prompt.messages.map((message, messageIndex) => (
                  <section key={`${message.role}-${messageIndex}`}>
                    <small>{message.role}</small>
                    <pre>{message.content}</pre>
                  </section>
                ))}
                <strong>Options de transport</strong>
                <HumanJson value={s.prompt.options} />
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function AssistantActionEvent({ part }: { part: ChatActionPart }): React.JSX.Element {
  return (
    <details className={`action-event${part.ok === false ? ' failed' : ''}`}>
      <summary>
        <span
          className={`status-dot ${
            part.ok === undefined ? 'st-info' : part.ok ? 'st-ok' : 'st-err'
          }`}
        />
        <span className="action-name">{CMD_LABEL[part.name] ?? part.name}</span>
        {part.args != null && (
          <span className="action-args mono">{JSON.stringify(part.args).slice(0, 96)}</span>
        )}
        <span className="action-status">
          {part.ok === undefined ? 'en cours' : part.ok ? 'réussi' : 'échec'}
        </span>
        {part.ok === undefined && <span className="spinner" />}
      </summary>
      <div className="action-detail">
        {part.args != null && (
          <section>
            <small>Entrée</small>
            <HumanJson value={part.args} />
          </section>
        )}
        {part.data != null && (
          <section>
            <small>Résultat</small>
            <HumanJson value={part.data} />
          </section>
        )}
        {part.args == null && part.data == null && (
          <span className="c-faint">
            {part.ok === undefined ? 'Action en cours…' : 'Aucun détail supplémentaire.'}
          </span>
        )}
      </div>
    </details>
  )
}

export function AssistantActivityGroup({
  actions
}: {
  actions: ChatActionPart[]
}): React.JSX.Element {
  const failed = actions.some((action) => action.ok === false)
  const running = actions.some((action) => action.ok === undefined)
  const status = running
    ? 'en cours'
    : failed
      ? 'avec erreur'
      : actions.length > 1
        ? 'terminées'
        : 'terminée'
  return (
    <details className={`activity-group${failed ? ' failed' : ''}`}>
      <summary>
        <span className={`status-dot ${running ? 'st-info' : failed ? 'st-err' : 'st-ok'}`} />
        <span className="activity-group-title">
          {actions.length} action{actions.length > 1 ? 's' : ''} {status}
        </span>
        <span className="activity-group-tools">
          {actions.map((action) => CMD_LABEL[action.name] ?? action.name).join(' · ')}
        </span>
        {running && <span className="spinner" />}
      </summary>
      <div className="activity-group-list">
        {actions.map((action, index) => (
          <AssistantActionEvent key={action.actionId ?? `${action.name}-${index}`} part={action} />
        ))}
      </div>
    </details>
  )
}
