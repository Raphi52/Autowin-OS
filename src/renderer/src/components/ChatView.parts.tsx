import { useState } from 'react'
import { libelleSortieCommande } from './evidence-label'
import { groupOutcomeSummary } from './action-outcome-summary'
import { failedActionRunId } from './run-trace-target'
import { hasConsultableRun, localActionDetail, localActionDetails } from './action-detail-target'
import { HumanJson } from './HumanJson'
import { BrainMarkdown } from './BrainMarkdown'
import {
  STEP_META,
  groupSubagentSteps,
  costByModel,
  formatTokens,
  type ChatActionPart,
  type EvidencePart,
  type OrchStep
} from './chat-view-model'
import './ChatView.css'
import './Evidence.css'
import { Spinner } from './Spinner'

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

/**
 * PASTILLE D'ICONE PAR FAMILLE D'OUTIL (design converge). Le lisere porte le STATUT, l'icone porte
 * la NATURE : sans elle, « edit_file · verify » se lit comme deux libelles interchangeables. Un
 * outil inconnu recoit le point neutre — jamais l'icone d'une famille voisine, qui mentirait.
 */
const ICONE_FAMILLE: Record<string, string> = {
  navigate: '🧭',
  chat_send: '💬',
  orchestrate: '🎯',
  create_conversation: '💬',
  rename_conversation: '💬',
  remove_conversation: '💬',
  set_role: '🎯',
  resolve_decision: '⚖️',
  load_graph: '🗺️',
  get_state: '👁️',
  edit_file: '🔧',
  write_file: '🔧',
  read_file: '👁️',
  verify: '🧪',
  remember: '🧠',
  brain_query: '🔍',
  search: '🔍'
}

/** Icone de la famille d'un outil ; '•' (neutre) si la famille est inconnue. */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur teste avec ce renderer
export function iconeFamille(name: string): string {
  return ICONE_FAMILLE[name] ?? '•'
}

/**
 * L4 : la RAISON du lien entre deux actions consecutives. `PersistedChatActionPart` ne porte pas de
 * `parentActionId` — on ne l'invente pas : la raison se DEDUIT de (verdict precedent -> outil
 * suivant), et sans regle applicable AUCUNE etiquette n'est posee (une etiquette constante
 * fabriquerait une causalite inexistante).
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur teste avec ce renderer
export function raisonDuLien(
  prev: ChatActionPart | undefined,
  current: ChatActionPart
): string | undefined {
  if (!prev) return undefined
  if (prev.ok === false) {
    return prev.name === current.name ? '2ᵉ TENTATIVE' : 'REPRISE APRÈS ÉCHEC'
  }
  if (prev.ok === true && (current.name === 'verify' || current.name === 'judge')) {
    return 'VÉRIFICATION'
  }
  return undefined
}

/**
 * CIBLE d'une action, lue dans ses arguments. Sans elle, deux `edit_file` consecutifs rendent deux
 * lignes IDENTIQUES : l'utilisateur voit qu'il se passe quelque chose sans savoir SUR QUOI — grief
 * exact de conv-1536 (« on sait pas ce que le model est en train de faire au premier coup d'oeil »).
 * Aucun champ connu -> `undefined` : on prefere le seul libelle d'outil a une cible inventee.
 */
const CLES_CIBLE = [
  'path',
  'file',
  'filePath',
  'target',
  'query',
  'command',
  'task',
  'view',
  'title',
  'name',
  'text'
] as const

/** Une cible plus longue ne se lit plus dans une sous-ligne : on la coupe par la TETE du chemin. */
const MAX_CIBLE = 72

// eslint-disable-next-line react-refresh/only-export-components -- helper pur teste avec ce renderer
export function resumeCible(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const cle of CLES_CIBLE) {
    const valeur = record[cle]
    if (typeof valeur !== 'string') continue
    const propre = valeur.trim().split(/\r?\n/u)[0]
    if (!propre) continue
    return propre.length > MAX_CIBLE ? `…${propre.slice(-MAX_CIBLE)}` : propre
  }
  return undefined
}

/**
 * UN ETAGE = une action, avec sa pastille de famille, sa cible, et son PROPRE bouton d'extension.
 *
 * Le depliage vivait au niveau du GROUPE : ouvrir montrait tous les details en vrac, sans dire
 * lequel appartient a quelle etape. L'utilisateur a demande l'inverse — « un bouton pour extend et
 * voir le detail de chaque step ». Le bouton n'existe QUE si l'etape a quelque chose a montrer :
 * promettre un depliage vide se lit comme casse.
 */
function EtageActivite({
  etape,
  lien
}: {
  etape: ChatActionPart
  lien?: string
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false)
  const detail = localActionDetail(etape)
  const cible = resumeCible(etape.args)
  const libelle = CMD_LABEL[etape.name] ?? etape.name
  return (
    <li
      className="activity-step"
      data-testid="activity-step"
      data-state={
        etape.ok === false
          ? 'ko'
          : etape.interrupted
            ? 'interrupted'
            : etape.ok === true
              ? 'ok'
              : 'running'
      }
    >
      <div className="activity-step-head">
        {lien && (
          <span className="activity-step-link" data-testid="activity-step-link">
            {lien}
          </span>
        )}
        <span className="activity-step-icon" data-testid="activity-step-icon" aria-hidden="true">
          {iconeFamille(etape.name)}
        </span>
        <span className="activity-step-label">{libelle}</span>
        {cible && (
          <span className="activity-step-target" data-testid="activity-step-target" title={cible}>
            {cible}
          </span>
        )}
        {etape.ok === undefined && !etape.interrupted && <Spinner />}
        {detail && (
          <button
            type="button"
            className="activity-step-toggle"
            data-testid="activity-step-toggle"
            aria-expanded={ouvert}
            aria-label={ouvert ? `Replier ${libelle}` : `Déplier le détail de ${libelle}`}
            onClick={() => setOuvert((etat) => !etat)}
          >
            {ouvert ? '▾' : '▸'}
          </button>
        )}
      </div>
      {/* DEMANDE (2026-08-31) : la CIBLE se lit SOUS le nom de l'action, et c'est ELLE qu'on clique
          pour deplier le detail — viser un chevron de 10px pour savoir « sur quoi ca a agi » etait
          la friction rapportee. Sans detail a montrer, la cible reste un simple texte : un bouton
          qui ne deplie rien se lit comme casse. */}
      {cible &&
        (detail ? (
          <button
            type="button"
            className="activity-step-target is-clickable"
            data-testid="activity-step-target"
            aria-expanded={ouvert}
            title={ouvert ? `Replier ${cible}` : `Déplier le détail de ${cible}`}
            onClick={() => setOuvert((etat) => !etat)}
          >
            {cible}
          </button>
        ) : (
          <span className="activity-step-target" data-testid="activity-step-target" title={cible}>
            {cible}
          </span>
        ))}
      {ouvert && detail && (
        <pre
          className={`activity-step-detail${detail.ok ? '' : ' failed'}`}
          data-testid="activity-step-detail"
        >
          {detail.text}
        </pre>
      )}
    </li>
  )
}

/** Sortie texte d'un sous-agent : repliée par défaut (160px), dépliable sur demande. */
/**
 * `.subagent-text` plafonne a 160px pour une ligne de 16.5px (11px x 1.5), soit ~9 lignes visibles.
 * On ESTIME le nombre de lignes rendues plutot que de le MESURER (scrollHeight via une ref + effet) :
 * la mesure ne rend rien sous jsdom/happy-dom (pas de layout, scrollHeight = 0), donc intestable, la
 * ou le seuil est une fonction pure verifiable. Largeur du panneau approchee a 100 caracteres par
 * ligne : surestimer masquerait le bouton sur un texte qui deborde (le bloc reste scrollable, degat
 * mineur), sous-estimer ramenerait le bouton sans effet qu'on corrige ici.
 */
const LIGNES_VISIBLES = 9
const CHARS_PAR_LIGNE = 100

function sortieDebordante(text: string): boolean {
  let lignes = 0
  for (const brute of text.split('\n')) {
    lignes += Math.max(1, Math.ceil(brute.length / CHARS_PAR_LIGNE))
    if (lignes > LIGNES_VISIBLES) return true
  }
  return false
}

export function SubAgentText({ text }: { text: string }): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false)
  // Pas de bouton quand tout tient deja : promettre un depliage sans effet visible se lit comme casse.
  const depliable = sortieDebordante(text)
  return (
    <div className={`subagent-text-wrap${ouvert ? ' open' : ''}`}>
      <div className={`subagent-text c-dim${ouvert ? ' open' : ''}`}>{text}</div>
      {depliable && (
        <button
          type="button"
          className="subagent-text-toggle"
          onClick={() => setOuvert(!ouvert)}
          aria-expanded={ouvert}
          aria-label={ouvert ? 'Replier la sortie' : 'Déplier la sortie'}
          title={ouvert ? 'Replier la sortie' : 'Déplier la sortie'}
        >
          {ouvert ? '▾' : '▸'}
        </button>
      )}
    </div>
  )
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
        {typeof s.costUsd === 'number' ? (
          <span className="c-faint tnum" style={{ marginLeft: 'auto' }}>
            {s.costUsd.toFixed(4)} $
          </span>
        ) : (
          // Provider muet sur le coût : on montre le VOLUME plutôt que rien. Un tour à 795k tokens
          // sans aucune indication de poids se lit comme un tour anodin.
          typeof s.tokens === 'number' &&
          s.tokens > 0 && (
            <span
              className="c-faint tnum"
              style={{ marginLeft: 'auto' }}
              title="Coût non chiffré par le provider"
            >
              {formatTokens(s.tokens)}
            </span>
          )
        )}
      </div>
      {s.status === 'failed' && s.error && <div className="subagent-error">{s.error}</div>}
      {s.thinking && (
        <details className="subagent-thinking">
          <summary>Raisonnement</summary>
          <pre>{s.thinking}</pre>
        </details>
      )}
      {s.text && <SubAgentText text={s.text} />}
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
          <div className="prompt-envelope-system" data-testid="prompt-system-md">
            <BrainMarkdown source={s.prompt.system || 'Aucun bloc système.'} />
          </div>
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
              {/* Montant affiché SEULEMENT s'il couvre quelque chose : sinon « 0.0000 $ » se lit
                  « gratuit » alors que le provider n'a rien chiffré (mesuré : 532M de tokens codex
                  comptés à zéro). Le volume non chiffré prend alors la place du montant. */}
              {m.costUsd > 0 && <b className="tnum">{m.costUsd.toFixed(4)} $</b>}
              {m.unpricedCalls > 0 && (
                <b className="tnum run-cost-uncosted" data-testid="cost-uncosted">
                  {formatTokens(m.unpricedTokens)} non chiffré{m.unpricedCalls > 1 ? 's' : ''}
                </b>
              )}
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
                {(() => {
                  // « exit 1 » ne dit rien a un humain : on met devant ce que le code SIGNIFIE, et
                  // le decompte des tests quand la sortie le porte. Le code reste affiche en cas
                  // d'echec — c'est la preuve verifiable, elle ne se cache pas derriere une phrase.
                  const libelle = libelleSortieCommande({ exitCode: e.exitCode, stdout: e.stdout })
                  if (!libelle) return null
                  return (
                    <span
                      className={`evidence-exit ${libelle.ok ? 'st-ok' : 'st-err'}`}
                      title={`code de sortie ${e.exitCode}`}
                    >
                      {libelle.texte}
                    </span>
                  )
                })()}
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

/**
 * Tâche d'une action interrompue, si on peut la retrouver. C'est elle qui permet de REPRENDRE d'un
 * clic : relancée à l'identique, elle retombe sur l'acquis persisté du run mort et repart à la phase
 * suivante — au lieu d'obliger l'utilisateur à retaper sa demande.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec ce renderer
export function interruptedTask(actions: ChatActionPart[]): string | undefined {
  for (const action of actions) {
    if (!action.interrupted) continue
    const task = (action.args as { task?: unknown } | undefined)?.task
    if (typeof task === 'string' && task.trim()) return task.trim()
  }
  return undefined
}

/**
 * Tâche d'une action ÉCHOUÉE, si on peut la retrouver — pour la RELANCER d'un clic. Distincte de
 * `interruptedTask` : un échec se re-lance (re-run), un tour interrompu se reprend (acquis persisté).
 * Sans elle, un échec n'offrait AUCUN levier : l'utilisateur voyait « erreur » sans quoi faire.
 */
// eslint-disable-next-line react-refresh/only-export-components -- helper pur testé avec ce renderer
export function failedTask(actions: ChatActionPart[]): string | undefined {
  for (const action of actions) {
    if (action.ok !== false) continue
    const task = (action.args as { task?: unknown } | undefined)?.task
    if (typeof task === 'string' && task.trim()) return task.trim()
  }
  return undefined
}

export function AssistantActivityGroup({
  actions,
  onOpenLiveAction,
  onResume
}: {
  actions: ChatActionPart[]
  /** Ouvre Workflows : `live` = carte du run en cours, `history` = activité passée. */
  onOpenLiveAction?: (mode: 'live' | 'history', runId?: string) => void
  /**
   * Relance la tâche interrompue (reprise sur l'acquis persisté), sans la retaper.
   * Peut renvoyer une promesse : le bouton l'ATTEND (état de chargement) et affiche
   * l'échec au lieu de le laisser disparaître dans le vide.
   */
  onResume?: (task: string) => void | Promise<{ ok?: boolean; error?: string } | void>
}): React.JSX.Element {
  // État LOCAL au bouton : le clic n'a sinon aucun retour visible tant que le tour persisté
  // n'est pas revenu du main, et un second clic relançait la même tâche en double.
  const [resumePending, setResumePending] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  /*
   * POURQUOI DEPLIE SUR PLACE. La pastille est bornee a une ligne : elle tronque et ne montre que le
   * premier motif. Sur conv-1334 le second motif — la DoD non tenue, la seule chose qui dit ce qu'il
   * aurait fallu produire — n'etait visible NULLE PART, et le clic renvoyait vers Workflows, hors du
   * fil, pour une information qui tient en deux lignes. Le clic la deplie donc ICI ; l'acces au run
   * garde son propre bouton, rien n'est perdu.
   */
  const [whyOpen, setWhyOpen] = useState(false)
  /**
   * DEMANDE du 20/08 : « quand je clique sur 1 action terminee remember ca doit deplier ce que ca a
   * remember ». Le detail local etait rendu HORS du clic : un succes arrivait deja plie, et il
   * fallait viser son propre `<summary>`. Le clic du bloc pilote donc aussi ce pli, faute de `why`.
   */
  const [detailsOpen, setDetailsOpen] = useState(false)
  /*
   * UNE ACTION QUI PORTE UN REFUS N'EST PAS « TERMINEE ».
   *
   * Vu par l'utilisateur le 2026-08-26 : « 1 action terminee · remember » ecrit AU-DESSUS de
   * l'erreur rouge. `action.ok === false` ne suffit pas — un depot Brain refuse est une commande qui
   * a parfaitement REUSSI a rendre un refus. Le resume, lui, le sait deja (`state: 'refused'`) ; il
   * etait simplement calcule plus bas et l'en-tete ne le lisait pas.
   *
   * Le mot « terminee » pose au-dessus d'un refus est ce qui rend un faux vert credible.
   */
  const resumeDesActions = groupOutcomeSummary(actions)
  const failed =
    actions.some((action) => action.ok === false) || resumeDesActions?.state === 'refused'
  // « En cours » = sans résultat ET non interrompue. Une action interrompue (tour clos sans son
  // résultat) n'est PAS en cours : c'est ce qui laissait l'indicateur tourner indéfiniment.
  const runningCount = actions.filter(
    (action) => action.ok === undefined && !action.interrupted
  ).length
  const interruptedCount = actions.filter((action) => action.interrupted).length
  const completedCount = actions.filter((action) => action.ok === true).length
  const running = runningCount > 0
  /*
   * SIGNE DE VIE de l'action encore en vol. Sans lui, le groupe se resume a « 1 action en cours »
   * et rien d'autre — c'est litteralement ce que l'utilisateur a rapporte le 2026-08-25 : « ca me
   * met une action en cours mais je le vois rien faire », devant un `verify` qui rejouait la suite
   * unitaire depuis dix minutes. On prend la DERNIERE action vivante qui en porte un : c'est celle
   * qui travaille encore, les precedentes ont deja rendu leur verdict.
   */
  const battement = [...actions]
    .reverse()
    .find((action) => action.ok === undefined && !action.interrupted && action.progress)?.progress
  const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`
  const status = running
    ? completedCount > 0
      ? `${plural(completedCount, 'action')} terminée${completedCount > 1 ? 's' : ''} · ${plural(runningCount, 'action')} en cours`
      : `${plural(actions.length, 'action')} en cours`
    : failed
      ? resumeDesActions?.state === 'refused' && !actions.some((action) => action.ok === false)
        ? `${plural(actions.length, 'action')} sans effet`
        : `${plural(actions.length, 'action')} avec erreur`
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
  /**
   * Verdict d'une VERIFICATION, lisible sans quitter le fil. Sur conv-76, `verify` a tourne trois
   * fois et seul « 1 action terminee verify » s'affichait : l'exit code — la seule chose qui prouve —
   * restait invisible. On n'ouvre rien de plus (le detail vit toujours dans Workflows), on montre la
   * ligne qui porte le verdict. Un echec passe devant une reussite.
   */
  const outcome = resumeDesActions
  const why = outcome?.why ?? []
  /**
   * Ne PROMETTRE Workflows que s'il y a un run a y voir. Constate en usage reel : sur
   * « edit_file · verify », le clic ne faisait RIEN — ces commandes locales ne creent aucun run, donc
   * le scroll visait une carte inexistante. Un bouton qui promet ce qu'il ne peut pas tenir laisse
   * l'utilisateur sans savoir si c'est casse ou si c'est lui ; on montre donc le detail SUR PLACE.
   */
  const runConsultable = hasConsultableRun(actions)
  const details = runConsultable ? [] : localActionDetails(actions)
  // Action INTERROMPUE -> on REPREND (acquis persisté) ; ÉCHOUÉE -> on RELANCE (re-run). Les deux
  // passent par le même canal `onResume`, seul le mot change. Sans la branche échec, une action en
  // erreur n'offrait AUCUN levier -> « erreur » sans quoi faire (frustration, conv veille 2026-08-14).
  const retryable = onResume
    ? interruptedCount > 0
      ? { task: interruptedTask(actions), verb: 'Reprendre' as const, gerund: 'Reprise' }
      : failed
        ? { task: failedTask(actions), verb: 'Relancer' as const, gerund: 'Relance' }
        : undefined
    : undefined
  const resumable = retryable?.task
  const retryVerb = retryable?.verb ?? 'Reprendre'
  const retryGerund = retryable?.gerund ?? 'Reprise'
  return (
    <>
      {/* La barre est un CONTENEUR : « voir » et « reprendre » y cohabitent sans s'imbriquer
        (un bouton dans un bouton est invalide, et rendrait un clic « voir » ambigu). */}
      {/* B3-γ : la TEINTE de statut est portee par la CARTE (bord + fond), pas par le seul point.
        Le point seul se lit mal dans un fil dense : l'utilisateur repere l'etat d'un coup d'oeil
        sur le bloc, comme dans RunProgress. Un echec prime sur toute action reussie du groupe. */}
      <div
        className={`activity-group${failed ? ' failed' : ''}`}
        data-state={
          failed ? 'failed' : running ? 'running' : interruptedCount > 0 ? 'interrupted' : 'done'
        }
      >
        <button
          type="button"
          className="activity-group-main"
          data-testid="activity-group"
          title={
            !runConsultable
              ? 'Action locale : son détail est affiché ici même (aucun run à ouvrir)'
              : running
                ? 'Ouvrir cette action en cours dans Workflows'
                : 'Voir le détail de cette action dans Workflows'
          }
          aria-disabled={!runConsultable && !why.length && !details.length}
          {...(why.length
            ? { 'aria-expanded': whyOpen }
            : details.length
              ? { 'aria-expanded': detailsOpen }
              : {})}
          // On transmet le run FAUTIF : sans lui, un clic sur « avec erreur » n'ouvrait que la liste
          // des runs de la conversation, laissant l'utilisateur chercher lequel regarder.
          onClick={() => {
            if (why.length) {
              setWhyOpen((ouvert) => !ouvert)
              return
            }
            if (details.length) {
              setDetailsOpen((ouvert) => !ouvert)
              return
            }
            if (!runConsultable) return
            onOpenLiveAction?.(running ? 'live' : 'history', failedActionRunId(actions))
          }}
        >
          <span
            className={`status-dot ${
              running ? 'st-info' : failed ? 'st-err' : interruptedCount > 0 ? 'st-warn' : 'st-ok'
            }`}
          />
          <span className="activity-group-title">{status}</span>
          <span className="activity-group-tools">{tools}</span>
          {outcome && (
            <span
              className={`activity-outcome st-${outcome.state}`}
              data-testid="activity-outcome"
              title={outcome.label}
            >
              {outcome.label}
            </span>
          )}
          {running && <Spinner />}
          {why.length ? (
            <span className="activity-group-go" aria-hidden="true">
              {whyOpen ? '▾' : '▸'}
            </span>
          ) : details.length ? (
            <span className="activity-group-go" aria-hidden="true">
              {detailsOpen ? '▾' : '▸'}
            </span>
          ) : (
            runConsultable && (
              <span className="activity-group-go" aria-hidden="true">
                ↗
              </span>
            )
          )}
        </button>
        {/* Hors du bouton : c'est une INFORMATION qui change toute seule, pas une cible de clic. */}
        {battement && (
          <div className="activity-progress" data-testid="activity-progress" title={battement}>
            {battement}
          </div>
        )}
        {/* Le clic principal deplie le pourquoi : l'ouverture du run garde donc son propre bouton,
            sinon deplier couterait l'acces a la trace complete. */}
        {why.length > 0 && runConsultable && (
          <button
            type="button"
            className="activity-open-run"
            data-testid="activity-open-run"
            title="Voir la trace complète dans Workflows"
            onClick={() =>
              onOpenLiveAction?.(running ? 'live' : 'history', failedActionRunId(actions))
            }
          >
            ↗
          </button>
        )}
        {resumable && (
          <button
            type="button"
            className={`activity-resume${resumeError ? ' failed' : ''}`}
            data-testid="activity-resume"
            disabled={resumePending}
            aria-busy={resumePending}
            {...(resumeError ? { 'data-resume-error': resumeError } : {})}
            title={
              resumePending
                ? `${retryGerund} en cours : ${resumable}`
                : resumeError
                  ? `${retryGerund} échouée : ${resumeError} — cliquer pour réessayer`
                  : `${retryVerb} : ${resumable}`
            }
            onClick={async () => {
              if (resumePending) return
              setResumePending(true)
              setResumeError(null)
              try {
                const outcome = await onResume?.(resumable)
                if (outcome && outcome.ok === false) {
                  setResumeError(outcome.error || 'reprise refusée')
                }
              } catch (error) {
                setResumeError(error instanceof Error ? error.message : String(error))
              } finally {
                setResumePending(false)
              }
            }}
          >
            {resumePending ? `↻ ${retryGerund}…` : resumeError ? '↻ Réessayer' : `↻ ${retryVerb}`}
          </button>
        )}
        {/* ETAGES (design converge) : une sous-ligne par action, reliees par un trait POINTILLE,
            chacune avec sa pastille de famille et, quand une regle s'applique, l'etiquette L4 qui
            NOMME la raison de l'enchainement. La ligne d'en-tete ne dit que « A · B » : elle perd
            l'ordre, le verdict de chaque etage et le lien entre eux. */}
        {actions.length > 0 && (
          <ol className="activity-steps" data-testid="activity-steps">
            {actions.map((etape, index) => (
              <EtageActivite
                key={`${etape.name}-${index}`}
                etape={etape}
                lien={raisonDuLien(actions[index - 1], etape)}
              />
            ))}
          </ol>
        )}
      </div>
      {whyOpen && why.length > 0 && (
        <div className="activity-why" data-testid="activity-why">
          {why.map((ligne, index) => (
            <p key={index}>{ligne}</p>
          ))}
        </div>
      )}
      {details.length > 0 && (
        <div className="activity-local-details" data-testid="activity-local-details">
          {details.map((detail, index) => (
            <details
              key={`${detail.name}-${index}`}
              className={detail.ok ? '' : 'failed'}
              // Un echec s'ouvre d'office ; un succes attend le clic sur le bloc (ou son summary).
              open={!detail.ok || detailsOpen}
            >
              <summary>
                <span className={`status-dot ${detail.ok ? 'st-ok' : 'st-err'}`} />
                {CMD_LABEL[detail.name] ?? detail.name}
              </summary>
              <pre>{detail.text}</pre>
            </details>
          ))}
        </div>
      )}
    </>
  )
}
