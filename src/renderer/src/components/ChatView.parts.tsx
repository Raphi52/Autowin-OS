import { HumanJson } from './HumanJson'
import {
  STEP_META,
  groupSubagentSteps,
  type ChatActionPart,
  type EvidencePart,
  type OrchStep
} from './chat-view-model'
import './ChatView.css'
import './Evidence.css'

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

/** Rendu d'UN step de sous-agent (prompt, raisonnement, echec, texte, preuves). */
export function SubAgentStep({ step: s }: { step: OrchStep }): React.JSX.Element {
  const meta = STEP_META[s.step] ?? { icon: '•', label: s.step }
  return (
    <div className={`subagent-step${s.status === 'failed' ? ' failed' : ''}`}>
      <div className="row gap2" style={{ fontSize: 11 }}>
        <span>{meta.icon}</span>
        <span className="c-dim" style={{ fontWeight: 600 }}>
          {meta.label}
        </span>
        {s.model ? (
          <span className="mono c-accent">{s.model}</span>
        ) : (
          s.provider && <span className="mono c-accent">{s.provider}</span>
        )}
        {s.status === 'failed' && <span className="subagent-failed-pill">échec</span>}
        {s.detail && <span className="c-faint">{s.detail}</span>}
        {typeof s.costUsd === 'number' && (
          <span className="c-faint tnum" style={{ marginLeft: 'auto' }}>
            {s.costUsd.toFixed(4)} $
          </span>
        )}
      </div>
      {s.status === 'failed' && s.error && <div className="subagent-error">{s.error}</div>}
      {s.thinking && (
        <details className="subagent-thinking">
          <summary>Raisonnement</summary>
          <pre>{s.thinking}</pre>
        </details>
      )}
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
      {s.evidence && s.evidence.length > 0 && <EvidenceList items={s.evidence} />}
    </div>
  )
}

/** Fil des sous-agents (exec/juge/gate) — réutilisé en direct et dans le détail d'un run.
 *  Les membres d'un même fan-out (≥2 modèles d'une phase) sont rendus CÔTE À CÔTE pour comparaison. */
export function StepThread({ steps }: { steps: OrchStep[] }): React.JSX.Element {
  const groups = groupSubagentSteps(steps)
  return (
    <div className="col" style={{ gap: 'var(--s2)' }}>
      {groups.map((g, i) =>
        g.kind === 'fanout' ? (
          <div key={i} className="fanout-grid" data-count={g.steps.length}>
            {g.steps.map((s, j) => (
              <SubAgentStep key={j} step={s} />
            ))}
          </div>
        ) : (
          <SubAgentStep key={i} step={g.step} />
        )
      )}
    </div>
  )
}

/** Preuves d'exécution rendues LISIBLEMENT inline : diff pour un file_change, stdout+exit pour une
 *  commande. Remplace le dump JSON générique — c'est ce qui rend le travail « visible » dans le Chat. */
export function EvidenceList({ items }: { items: EvidencePart[] }): React.JSX.Element {
  return (
    <div className="evidence-list">
      {items.map((e, i) => (
        <details key={i} className={`evidence-item${e.ok ? '' : ' failed'}`} open={!e.ok}>
          <summary>
            <span className={`status-dot ${e.ok ? 'st-ok' : 'st-err'}`} />
            {e.type === 'file_change' ? (
              <span className="mono">📝 {e.path || 'fichier modifié'}</span>
            ) : (
              <>
                <span className="mono">
                  {e.command ? `$ ${e.command}` : e.type}
                </span>
                {typeof e.exitCode === 'number' && (
                  <span className={`evidence-exit ${e.exitCode === 0 ? 'st-ok' : 'st-err'}`}>
                    exit {e.exitCode}
                  </span>
                )}
              </>
            )}
          </summary>
          {e.diff && (
            <pre className="evidence-diff">
              {e.diff.split('\n').map((line, li) => (
                <span
                  key={li}
                  className={
                    line.startsWith('+')
                      ? 'diff-add'
                      : line.startsWith('-')
                        ? 'diff-del'
                        : undefined
                  }
                >
                  {line + '\n'}
                </span>
              ))}
            </pre>
          )}
          {e.stdout && <pre className="evidence-stdout">{e.stdout}</pre>}
          {!e.diff && !e.stdout && <pre className="evidence-stdout c-faint">{e.summary}</pre>}
        </details>
      ))}
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
