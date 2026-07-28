import { HumanJson } from './HumanJson'
import {
  STEP_META,
  groupSubagentSteps,
  costByModel,
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
  const perModel = costByModel(steps)
  return (
    <div className="col" style={{ gap: 'var(--s2)' }}>
      {perModel.length >= 2 && (
        <div className="run-cost-recap" data-testid="run-cost-recap">
          <span className="c-faint">Coût par modèle</span>
          {perModel.map((m) => (
            <span key={m.model} className="run-cost-chip">
              <span className="mono">{m.model}</span>
              <b className="tnum">{m.costUsd.toFixed(4)} $</b>
              <i className="c-faint">×{m.count}</i>
            </span>
          ))}
        </div>
      )}
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
                <span className="mono">{e.command ? `$ ${e.command}` : e.type}</span>
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

export function AssistantActivityGroup({
  actions,
  onOpenLiveAction
}: {
  actions: ChatActionPart[]
  /** Ouvre Workflows : `live` = carte du run en cours, `history` = activité passée. */
  onOpenLiveAction?: (mode: 'live' | 'history') => void
}): React.JSX.Element {
  const failed = actions.some((action) => action.ok === false)
  // « En cours » = sans résultat ET non interrompue. Une action interrompue (tour clos sans son
  // résultat) n'est PAS en cours : c'est ce qui laissait l'indicateur tourner indéfiniment.
  const runningCount = actions.filter(
    (action) => action.ok === undefined && !action.interrupted
  ).length
  const interruptedCount = actions.filter((action) => action.interrupted).length
  const completedCount = actions.filter((action) => action.ok === true).length
  const running = runningCount > 0
  const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`
  const status = running
    ? completedCount > 0
      ? `${plural(completedCount, 'action')} terminée${completedCount > 1 ? 's' : ''} · ${plural(runningCount, 'action')} en cours`
      : `${plural(actions.length, 'action')} en cours`
    : failed
      ? `${plural(actions.length, 'action')} avec erreur`
      : interruptedCount > 0
        ? completedCount > 0
          ? `${plural(completedCount, 'action')} terminée${completedCount > 1 ? 's' : ''} · ${plural(interruptedCount, 'action')} interrompue${interruptedCount > 1 ? 's' : ''}`
          : `${plural(interruptedCount, 'action')} interrompue${interruptedCount > 1 ? 's' : ''}`
        : actions.length > 1
          ? `${actions.length} actions terminées`
          : '1 action terminée'
  // Bloc NON dépliable : le détail (prompt envoyé au sous-agent, résultats, trace) vit dans
  // Workflows, pas au milieu du fil. Le bloc est donc un simple bouton qui y renvoie — vers la
  // carte du run si ça tourne, vers l'historique d'activité si c'est déjà terminé/interrompu.
  const tools = actions.map((action) => CMD_LABEL[action.name] ?? action.name).join(' · ')
  return (
    <button
      type="button"
      className={`activity-group${failed ? ' failed' : ''}`}
      data-testid="activity-group"
      title={
        running
          ? 'Ouvrir cette action en cours dans Workflows'
          : 'Voir le détail de cette action dans Workflows'
      }
      onClick={() => onOpenLiveAction?.(running ? 'live' : 'history')}
    >
      <span
        className={`status-dot ${
          running ? 'st-info' : failed ? 'st-err' : interruptedCount > 0 ? 'st-warn' : 'st-ok'
        }`}
      />
      <span className="activity-group-title">{status}</span>
      <span className="activity-group-tools">{tools}</span>
      {running && <span className="spinner" />}
      <span className="activity-group-go" aria-hidden="true">
        ↗
      </span>
    </button>
  )
}
