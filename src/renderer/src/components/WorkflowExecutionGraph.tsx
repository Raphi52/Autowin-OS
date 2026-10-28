import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { buildCausalPath, flattenCausalNodes, type CausalPathNode } from './causal-path-model'
import {
  settleStrandedExecutionStatus,
  statusLabel,
  statusLabelDuNoeud
} from './execution-interrupted-status'
import {
  buildHarnessTimelineFromTrace,
  type HarnessTimelineEvent,
  type HarnessTraceEvent
} from './harness-timeline-model'
import { LatestRequestGate } from './observatory-reliability'
import {
  distinctNodePayloads,
  NODE_PAYLOAD_KINDS,
  projectLatestRequestExecution,
  type RequestTurnOption
} from './request-execution-tree-model'
import { workflowQuoteLabel } from './workflow-quote-label'
import { demandeHumaineEntiere } from '../../../shared/balise-message-utilisateur'
import type { RunClosureObservation } from '../../../shared/run-execution'
import type { AgentGantt } from './observatory-agent-gantt'
import { sensDuCodeDeBlocage } from '../../../shared/raison-de-blocage'
import { lireReponseRemember, type LectureFaitRetenu } from './fait-retenu-detail'
import { appelsDeLOutil } from './appels-outil-detail'
import { defautsDeTrace } from './defauts-de-trace'
import './WorkflowExecutionGraph.css'
import { Spinner } from './Spinner'
import { formaterNombre } from '../langue'
import { riche } from '../textes'
import {
  texteChatExecution as texte,
  useTextesChatExecution,
  type CleChatExecution
} from '../textes-ecrans/chat-execution'
import {
  constellationEdgePath,
  layoutConstellation,
  type ConstellationLayout,
  type ConstellationRow
} from './graph-constellation-layout'

/**
 * Ce que le graphe PUBLIE quand on descend sur un nœud. Il ne décide de rien : il dit sur quoi
 * l'utilisateur est descendu, à charge du panneau d'en tirer la vue adaptée. Sans cela, la
 * sélection reste enfermée dans le composant et le graphe ne peut pas remplacer les onglets.
 */
export interface ExecutionNodeSelection {
  id: string
  kind: string
  runId?: string
  skillName?: string
  turnId?: string
  /** Nœud « Clôture du run » : ce que la trace a écrit de la clôture, pour son bilan. */
  closure?: RunClosureObservation
  /** Nœud « Clôture du run » : les verdicts rendus par le juge, dans l'ordre. */
  verdictEventIds?: string[]
  /** Nœud « Clôture du run » : le déroulé par agent du run, pour le rejouer (conv-981). */
  gantt?: AgentGantt
}

interface WorkflowExecutionGraphProps {
  conversationId?: string
  active?: boolean
  live?: boolean
  requestLabel?: string
  /**
   * Demande IMPOSÉE par l'appelant : l'arbre la projette et masque son sélecteur. Le fil des
   * demandes (`RequestThread`) s'en sert pour garder cet arbre comme « détail » d'un récit.
   */
  turnId?: string
  onSelect?: (selection: ExecutionNodeSelection | null) => void
}

// Des CLÉS de texte, traduites à la lecture (traduction anglaise, conv-1170).
const EVENT_LABEL: Record<HarnessTimelineEvent['kind'], CleChatExecution> = {
  message: 'graphe.evenement.message',
  injection: 'graphe.evenement.injection',
  decision: 'graphe.evenement.decision',
  'tool-call': 'graphe.evenement.tool-call',
  'tool-result': 'graphe.evenement.tool-result',
  artifact: 'graphe.evenement.artifact',
  'model-response': 'graphe.evenement.model-response',
  'response-displayed': 'graphe.evenement.response-displayed',
  handoff: 'graphe.evenement.handoff',
  verdict: 'graphe.evenement.verdict',
  gate: 'graphe.evenement.gate',
  retry: 'graphe.evenement.retry',
  cancellation: 'graphe.evenement.cancellation',
  error: 'graphe.evenement.error',
  boundary: 'graphe.evenement.boundary'
}

/**
 * Durée lisible : « 420 ms », « 56,39 s », puis « 18 min 22 s » et « 1 h 05 min ». Au-delà d'une
 * minute, « 1 102,34 s » se lisait mal (demande du 2026-10-12, « lisser l'existant »).
 */
function elapsedLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${formaterNombre(seconds, { maximumFractionDigits: 2 })} s`
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min ${String(total % 60).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** Coût total d'une demande, au centime : « 10,14 $ ». */
function totalCostLabel(costUsd: number): string {
  const centimes = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  if (costUsd > 0 && costUsd < 0.01) return `< ${formaterNombre(0.01, centimes)} $`
  return `${formaterNombre(costUsd, centimes)} $`
}

/** Durée et coût du tour entier, portés par la demande depuis que le « Bilan du tour » n'est plus un bloc. */
function requestTotals(event: HarnessTimelineEvent): string | undefined {
  const parts = [
    event.durationMs != null && event.durationMs > 0 ? elapsedLabel(event.durationMs) : '',
    event.costUsd != null ? totalCostLabel(event.costUsd) : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * AUCUNE DUREE « INCONNUE ». Tout evenement de la trace porte un horodatage exact ; seuls certains
 * portent une duree MESUREE (un appel provider, une phase). Un marqueur ponctuel (injection, appel
 * d'outil, frontiere de run) n'a pas de duree a mesurer : on affiche alors sa POSITION dans la
 * demande — « a +12,4 s » —, un fait tire du meme journal, au lieu d'un aveu d'ignorance qui laissait
 * croire a une perte de log. Reste « non horodate » si meme le timestamp manque : ce cas est un
 * vrai defaut de trace, et il doit rester visible.
 */
function durationLabel(durationMs: number | undefined, offsetMs?: number): string {
  if (durationMs != null) return elapsedLabel(durationMs)
  if (offsetMs != null) return texte('graphe.position', { duree: elapsedLabel(offsetMs) })
  return texte('graphe.non-horodate')
}

/** Position de l'evenement depuis le debut de la demande, depuis son horodatage logue. */
function offsetFromStart(
  timestamp: string | undefined,
  baseMs: number | undefined
): number | undefined {
  if (baseMs == null || !timestamp) return undefined
  const at = Date.parse(timestamp)
  return Number.isFinite(at) ? Math.max(0, at - baseMs) : undefined
}

function costLabel(costUsd: number | undefined): string {
  if (costUsd == null) return texte('graphe.cout-inconnu')
  return `${formaterNombre(costUsd, { maximumFractionDigits: 4 })} $`
}

/**
 * La skill d'une étape, seulement quand il y en a une. « aucune skill » s'écrivait sous CHAQUE bloc
 * d'un chat direct, c'est-à-dire presque partout, sans rien apprendre (demande du 2026-10-12).
 */
function skillLabel(event: HarnessTimelineEvent): string | undefined {
  if (event.display?.skillName) return `skill · ${event.display.skillName}`
  if (event.display?.workflow === 'autowin') return texte('graphe.skill-non-tracee')
  return undefined
}

/**
 * La carte d'un bloc ne dit que ce que son titre ne dit pas. L'acteur brut (« orchestrator »,
 * « brain_read », « Interface Autowin ») répétait le titre en jargon : il reste dans la fiche.
 */
function hasCardMeta(event: HarnessTimelineEvent): boolean {
  const kind = event.display?.kind
  if (kind === 'skill') return false
  if (kind === 'request') return Boolean(event.label) || requestTotals(event) !== undefined
  if (kind && ['workspace', 'quote', 'git', 'closure', 'phase'].includes(kind)) return true
  // La skill se dit UNE fois, sur l'agent qui l'exécute. Ses actions en héritent dans le modèle,
  // mais la recopier sous chacune refaisait le « partout pour rien » (capture du 2026-10-12).
  return kind === 'agent' && skillLabel(event) !== undefined
}

function gitOutcomeLabel(outcome: string | undefined): string {
  if (outcome === 'merged') return texte('graphe.git.merged')
  if (outcome === 'nothing') return texte('graphe.git.nothing')
  if (outcome === 'conflict') return texte('graphe.git.conflict')
  if (outcome === 'blocked') return texte('graphe.git.blocked')
  if (outcome === 'kept') return texte('graphe.git.kept')
  return texte('graphe.git.inconnu')
}

function closureStatusLabel(status: string | undefined): string {
  if (status === 'green') return 'Green'
  if (status === 'degraded-closed') return texte('graphe.cloture.degrade')
  if (status === 'red') return 'Red'
  return texte('graphe.cloture.ouvert')
}

function workspaceModeLabel(mode: string | undefined): string {
  return mode === 'worktree' ? texte('graphe.mode.copie') : texte('graphe.mode.depot')
}

function ExecutionNodeMeta({
  event,
  offsetMs,
  sansDuree = false
}: {
  event: HarnessTimelineEvent
  offsetMs?: number
  /** La constellation écrit la durée sur sa propre ligne, sous le titre : pas deux fois. */
  sansDuree?: boolean
}): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const display = event.display
  if (display?.kind === 'workspace') {
    const mode = workspaceModeLabel(display.workspace?.mode)
    // « Dépôt de travail » titre déjà le nœud : la ligne ne le redit pas, elle donne le chemin.
    if (mode === display.title) return <span>{display.workspace?.path}</span>
    return (
      <>
        <span>{mode}</span>
        <span aria-hidden="true">·</span>
        <span>{display.workspace?.path}</span>
      </>
    )
  }
  if (display?.kind === 'quote') {
    return (
      <>
        {/*
          En TÊTE, avant le régime : les plafonds annoncés découlent du workflow retenu, donc c'est
          lui qu'on lit d'abord. « Aucun workflow » est écrit plutôt que la ligne masquée — une ligne
          absente se lit comme une information manquante, pas comme une absence voulue.
        */}
        <span className="workflow-execution-quote-workflow">
          {workflowQuoteLabel(display.quote?.workflow)}
        </span>
        <span aria-hidden="true">·</span>
        <span>{display.quote?.regime ?? t('graphe.regime-inconnu')}</span>
        <span aria-hidden="true">·</span>
        <span>{t('graphe.appels-max', { n: display.quote?.limits.maxProviderCalls ?? 0 })}</span>
        <span aria-hidden="true">·</span>
        <span>{t('graphe.agents-max', { n: display.quote?.limits.maxAgents ?? 0 })}</span>
      </>
    )
  }
  if (display?.kind === 'skill') {
    return (
      <>
        <span className="workflow-execution-skill">phase · {display.skillName}</span>
        <span aria-hidden="true">·</span>
        <span>{t('graphe.alias-observe')}</span>
      </>
    )
  }
  if (display?.kind === 'git') {
    return (
      <>
        <span>{gitOutcomeLabel(display.git?.outcome)}</span>
        {display.git?.commitSha && (
          <>
            <span aria-hidden="true">·</span>
            <span>{display.git.commitSha.slice(0, 8)}</span>
          </>
        )}
      </>
    )
  }
  if (display?.kind === 'closure') {
    const unknown = display.closure?.usage?.unpricedCalls ?? 0
    return (
      <>
        <span>{closureStatusLabel(display.closure?.status)}</span>
        <span aria-hidden="true">·</span>
        {!sansDuree && (
          <>
            <span>{durationLabel(display.closure?.totalDurationMs, offsetMs)}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>
          {costLabel(display.closure?.totalCostUsd)}
          {unknown > 0 ? t('graphe.non-chiffres', { n: unknown }) : ''}
        </span>
      </>
    )
  }
  if (display?.kind === 'request') {
    const totals = requestTotals(event)
    return (
      <>
        {event.label && <span className="workflow-execution-request-label">{event.label}</span>}
        {totals && (
          <span className="workflow-execution-request-totals" data-execution-totals>
            {totals}
          </span>
        )}
      </>
    )
  }
  if (display?.kind === 'phase') return <span>{t('graphe.phase-autowin')}</span>
  const skill = skillLabel(event)
  return (
    <>
      {skill && <span className="workflow-execution-skill">{skill}</span>}
      {!sansDuree && (
        <>
          {skill && <span aria-hidden="true">·</span>}
          <span>{durationLabel(event.durationMs, offsetMs)}</span>
        </>
      )}
    </>
  )
}

/** Le chiffre que la constellation écrit sous le nom : la durée, ou le temps total d'une clôture. */
function chiffreDuNoeud(node: CausalPathNode, offsetMs?: number): string {
  return durationLabel(dureeDuNoeud(node), offsetMs)
}

/**
 * La durée d'une étape telle que la constellation la montre. Une PHASE n'a pas de durée propre
 * (alias de skill, « 0 ms » sur conv-108) : elle prend la durée cumulée de ses agents, que le
 * chemin causal calcule déjà. Une clôture porte le temps total du run.
 */
function dureeDuNoeud(node: CausalPathNode): number | undefined {
  const event = node.event
  const positive = (ms: number | undefined): number | undefined =>
    ms != null && Number.isFinite(ms) && ms > 0 ? ms : undefined
  // Un marqueur instantané (copie, plan, Git : « 0 ms » sur conv-108) n'a pas de durée à montrer :
  // `durationLabel` dit alors sa POSITION dans la demande, comme pour une durée absente.
  if (event.display?.kind === 'closure') return positive(event.display.closure?.totalDurationMs)
  return positive(event.durationMs) ?? positive(node.inclusiveDurationMs)
}

/**
 * LA PENSÉE DU SOUS-AGENT — dernier échelon de la descente.
 *
 * `stepPayloads` écrit la délibération dans une charge `reasoning`, distincte de la conclusion.
 * Elle arrivait jusqu'ici sans qu'aucun chemin de rendu ne la lise. Le pli reste FERMÉ : une
 * délibération est longue, et le détail doit rester lisible d'un coup d'œil.
 *
 * Le filtre sur `reasoning` DOUBLE celui de la projection à dessein : c'est ici la garde qui
 * empêche un contenu d'outil d'atterrir dans le détail. Un nœud non projeté garderait ses charges
 * brutes, et le graphe s'interdit de les montrer (test discriminant : « contenu sensible »).
 */
function ExecutionNodeReasoning({
  event
}: {
  event: HarnessTimelineEvent
}): React.JSX.Element | null {
  const { t } = useTextesChatExecution()
  const reasoning = (event.payloads ?? [])
    .filter((payload) => payload.kind === 'reasoning')
    .map((payload) => payload.content)
    .filter((content) => Boolean(content))
  if (reasoning.length === 0) return null
  return (
    <details className="workflow-execution-reasoning" data-execution-reasoning>
      <summary>{t('graphe.raisonnement')}</summary>
      {reasoning.map((content, index) => (
        <pre key={index}>{content}</pre>
      ))}
    </details>
  )
}

/**
 * CE QUE L'ÉTAPE A REÇU ET RENDU (demande du 2026-09-23).
 *
 * Le clic sur une brique renvoyait vers Runs, vide pour une demande simple (aucun RUN.md). Le
 * prompt et la réponse sont dans la trace causale : on les montre ici. Seuls ces genres sont lus —
 * un contenu d'outil ne s'affiche jamais.
 */
function ExecutionNodeExchange({
  event
}: {
  event: HarnessTimelineEvent
}): React.JSX.Element | null {
  const { t } = useTextesChatExecution()
  const pick = (...kinds: string[]): string[] =>
    (event.payloads ?? [])
      .filter((payload) => kinds.includes(payload.kind))
      .map((payload) => payload.content)
      .filter((content) => Boolean(content?.trim()))
  if (event.display?.kind === 'request') {
    // LA DEMANDE ENTIÈRE, pas le prompt composé : l'état de l'app et les consignes injectées sont
    // déjà sous « Prompt envoyé » de l'Orchestrateur. Le texte le plus long gagne : la demande reçue
    // à l'envoi n'en gardait que le premier paragraphe jusqu'au 2026-10-12.
    const demande = pick('user-message')
      .map(demandeHumaineEntiere)
      .reduce((plusLong, texte) => (texte.length > plusLong.length ? texte : plusLong), '')
    if (!demande) return null
    return (
      <div className="workflow-execution-exchange" data-execution-exchange>
        <details open data-execution-demande>
          <summary>{t('graphe.ta-demande')}</summary>
          <pre>{demande}</pre>
        </details>
      </div>
    )
  }
  const prompt = pick('user-message')
  const system = pick('system-instruction')
  const response = pick('model-response', 'error')
  // UNE ÉTAPE QUI TOURNE N'A PAS ENCORE DE RETOUR (2026-10-13) : le retour n'est écrit qu'à sa fin.
  // Le dire, au lieu de « aucun retour enregistré » qui se lisait comme une erreur.
  const enCours = event.status === 'running' || event.status === 'pending'
  if (prompt.length === 0 && system.length === 0 && response.length === 0) {
    // Seul un AGENT doit avoir un échange : chez lui, l'absence est un vrai manque, et on le dit. Un
    // geste d'outil (son contenu ne s'affiche jamais), une étape de structure ou la réponse affichée
    // n'en ont pas par nature — la phrase couvrait 55 % des briques (682 mesurées le 2026-10-12).
    if (event.display?.kind !== 'agent') return null
    if (enCours) {
      return (
        <p className="workflow-execution-exchange-empty" data-execution-exchange="en-cours">
          {t('graphe.echange.en-cours')}
        </p>
      )
    }
    return (
      <p className="workflow-execution-exchange-empty" data-execution-exchange="vide">
        {event.status === 'interrupted'
          ? t('graphe.echange.interrompue')
          : t('graphe.echange.vide')}
      </p>
    )
  }
  return (
    <div className="workflow-execution-exchange" data-execution-exchange>
      {prompt.length > 0 && (
        <details open data-execution-prompt>
          <summary>{t('graphe.prompt-envoye')}</summary>
          {prompt.map((content, index) => (
            <pre key={index}>{content}</pre>
          ))}
        </details>
      )}
      {system.length > 0 && (
        <details data-execution-system>
          <summary>{t('graphe.instructions-systeme')}</summary>
          {system.map((content, index) => (
            <pre key={index}>{content}</pre>
          ))}
        </details>
      )}
      {response.length > 0 && (
        <details open data-execution-response>
          <summary>
            {event.kind === 'response-displayed'
              ? t('graphe.texte-affiche')
              : t('graphe.retour-etape')}
          </summary>
          {response.map((content, index) => (
            <pre key={index}>{content}</pre>
          ))}
        </details>
      )}
      {response.length === 0 && enCours && (
        <p className="workflow-execution-exchange-empty" data-execution-exchange="retour-attendu">
          {t('graphe.retour-attendu')}
        </p>
      )}
    </div>
  )
}

type ChargeEtape = HarnessTimelineEvent['payloads'][number]

/**
 * Le pont expose-t-il les lectures ALLÉGÉES du graphe ?
 *
 * En mode dev, l'écran se recharge à chaud mais le pont (`preload`) et le cœur gardent leur version
 * jusqu'au prochain redémarrage : pendant cet intervalle, les deux canaux n'existent pas encore. Le
 * graphe relit alors la trace complète, comme avant — plus lent, mais jamais cassé.
 */
function lecturesAllegeesDisponibles(): boolean {
  return (
    typeof window.api?.causalTraceGraphe === 'function' &&
    typeof window.api?.causalTraceCharges === 'function'
  )
}

const GENRES_DU_DETAIL = [...NODE_PAYLOAD_KINDS]
/**
 * Les genres relus selon la brique. « Fait retenu » ne relit que les RÉPONSES de `remember`, jamais
 * un argument — réussies (`tool-result`) ET en échec (`error`) : un dépôt refusé est écrit en
 * `error`, et sans lui le panneau ne savait dire que « texte illisible » (conv-966). Un autre outil
 * relit ses arguments, ses retours et ses erreurs.
 */
const GENRES_PAR_DETAIL: Record<'echange' | 'fait-retenu' | 'appels', string[]> = {
  echange: GENRES_DU_DETAIL,
  'fait-retenu': ['tool-result', 'error'],
  appels: ['tool-call', 'tool-result', 'error']
}

/**
 * CE QUE L'OUTIL A REÇU ET RENDU, appel par appel (demande du 2026-10-12 : « pareil pour toutes les
 * pastilles, je dois voir ce qui est fait en détail quand je déplie »). Chargé au clic seulement :
 * l'arbre ne reçoit toujours aucun contenu d'outil.
 */
function ExecutionNodeAppels({ event }: { event: HarnessTimelineEvent }): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const appels = appelsDeLOutil(event.payloads ?? [])
  if (appels.length === 0) {
    return (
      <p className="workflow-execution-exchange-empty" data-execution-exchange="geste-sans-contenu">
        {t('graphe.geste-sans-contenu')}
      </p>
    )
  }
  return (
    <div className="workflow-execution-exchange" data-execution-appels>
      {appels.map((appel, index) => (
        <details key={index} open={index === 0} data-execution-appel>
          <summary>
            {appels.length > 1 ? t('graphe.appel.n', { n: index + 1 }) : t('graphe.appel')}
          </summary>
          {appel.envoye !== undefined && (
            <>
              <p className="workflow-execution-appel-part">{t('graphe.envoye')}</p>
              <pre data-execution-appel-envoye>{appel.envoye}</pre>
            </>
          )}
          {appel.retour !== undefined && (
            <>
              <p className="workflow-execution-appel-part">
                {appel.erreur ? t('graphe.erreur') : t('graphe.retour')}
              </p>
              <pre data-execution-appel-retour>{appel.retour}</pre>
            </>
          )}
        </details>
      ))}
    </div>
  )
}

/**
 * QUEL FAIT A ÉTÉ RETENU — le titre et le texte validés, et où il est parti (candidat Brain, gardé
 * dans le fil…). Un refus ne montre que son motif. Voir `fait-retenu-detail.ts` pour la garde.
 */
function ExecutionNodeFaitsRetenus({ event }: { event: HarnessTimelineEvent }): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const lectures = (event.payloads ?? [])
    .filter((payload) => payload.kind === 'tool-result' || payload.kind === 'error')
    .map(lireReponseRemember)
    .filter((lecture): lecture is LectureFaitRetenu => lecture !== undefined)
  if (lectures.length === 0) {
    // Ce qui manque ici, c'est la RÉPONSE de remember (déposé ? refusé ? pourquoi ?), pas le fait.
    const enCours = event.status === 'running' || event.status === 'pending'
    return (
      <p className="workflow-execution-exchange-empty" data-execution-exchange="fait-illisible">
        {enCours ? t('graphe.fait.en-cours') : t('graphe.fait.illisible')}
      </p>
    )
  }
  return (
    <div className="workflow-execution-exchange" data-execution-faits>
      {lectures.map((lecture, index) =>
        lecture.retenu ? (
          <details open key={index} data-execution-fait>
            <summary>
              {lectures.length > 1 ? t('graphe.fait.n', { n: index + 1 }) : t('graphe.fait')}
              {!lecture.depose && t('graphe.fait.dans-ce-fil')}
            </summary>
            {lecture.titre && <p className="workflow-execution-fait-titre">{lecture.titre}</p>}
            <pre>{lecture.texte}</pre>
            {lecture.issue && <p className="workflow-execution-fait-issue">{lecture.issue}</p>}
          </details>
        ) : (
          <p key={index} className="workflow-execution-warning" data-execution-fait-refuse>
            {t('graphe.fait.non-retenu', { motif: lecture.motif })}
          </p>
        )
      )}
    </div>
  )
}

/**
 * LE DÉTAIL D'UNE ÉTAPE, CHARGÉ À SON OUVERTURE.
 *
 * L'arbre reçoit la trace sans contenus (`os:causalTrace:graphe`) : les prompts, retours et
 * raisonnements d'une étape sont relus ici, pour elle seule, quand on la déplie. La clé est la liste
 * des événements sources : la trace étant en ajout seul, une même liste rend toujours les mêmes
 * charges — le rechargement de chaque seconde ne relance donc rien tant qu'aucune source n'arrive.
 */
function ExecutionNodeContents({
  conversationId,
  event
}: {
  conversationId: string
  event: HarnessTimelineEvent
}): React.JSX.Element | null {
  const { t } = useTextesChatExecution()
  const sources = lecturesAllegeesDisponibles() ? (event.display?.payloadEventIds ?? []) : []
  const mode = event.display?.detailOutil ?? 'echange'
  // Le genre lu fait partie de la clé : mêmes sources, mêmes genres, mêmes charges.
  const cle = sources.length > 0 ? [conversationId, mode, ...sources].join('\n') : null
  const [lu, setLu] = useState<{ cle: string; charges?: ChargeEtape[]; erreur?: string } | null>(
    null
  )
  useEffect(() => {
    if (!cle) return
    const [conversation, modeLu, ...ids] = cle.split('\n')
    const genre = modeLu as keyof typeof GENRES_PAR_DETAIL
    const genres = GENRES_PAR_DETAIL[genre]
    let vivant = true
    window.api
      .causalTraceCharges(conversation, ids, genres)
      .then((parEvenement) => {
        // Dédoublonnées comme dans la projection : le relais d'un sous-agent recopie la réponse
        // du modèle, qui s'afficherait sinon deux fois. Ce filtre ne garde que les genres d'un
        // échange : les charges d'un outil passent à côté, dans l'ordre, une par appel.
        const lues = ids.flatMap((id) => parEvenement[id] ?? [])
        if (vivant)
          setLu({
            cle,
            charges:
              genre === 'echange'
                ? distinctNodePayloads(lues)
                : lues.filter((charge) => genres.includes(charge.kind))
          })
      })
      .catch((raison: unknown) => {
        if (vivant)
          setLu({ cle, erreur: raison instanceof Error ? raison.message : String(raison) })
      })
    return () => {
      vivant = false
    }
  }, [cle])

  if (cle && lu?.cle !== cle) {
    return (
      <p className="workflow-execution-exchange-empty" data-execution-exchange="chargement">
        <Spinner size={12} />
        {t('graphe.chargement-detail')}
      </p>
    )
  }
  if (cle && lu?.erreur) {
    return (
      <p className="workflow-execution-warning" role="alert" data-execution-exchange="erreur">
        {t('graphe.detail-indisponible', { erreur: lu.erreur })}
      </p>
    )
  }
  const affiche = cle ? { ...event, payloads: lu?.charges ?? [] } : event
  if (mode === 'fait-retenu') return <ExecutionNodeFaitsRetenus event={affiche} />
  if (mode === 'appels') return cle ? <ExecutionNodeAppels event={affiche} /> : null
  return (
    <>
      <ExecutionNodeExchange event={affiche} />
      <ExecutionNodeReasoning event={affiche} />
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ExecutionNodeDetail({
  event,
  offsetMs
}: {
  event: HarnessTimelineEvent
  offsetMs?: number
}): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const display = event.display
  if (display?.kind === 'workspace') {
    const workspace = display.workspace
    return (
      <dl>
        <DetailRow
          label={t('graphe.ligne.chemin')}
          value={workspace?.path ?? t('graphe.valeur.non-expose')}
        />
        <DetailRow label="Mode" value={workspaceModeLabel(workspace?.mode)} />
        <DetailRow
          label={t('graphe.ligne.depot-source')}
          value={workspace?.repositoryPath ?? t('graphe.valeur.non-expose')}
        />
        {workspace?.baseBranch && (
          <DetailRow label={t('graphe.ligne.branche-base')} value={workspace.baseBranch} />
        )}
        {workspace?.baseSha && (
          <DetailRow label={t('graphe.ligne.revision-base')} value={workspace.baseSha} />
        )}
      </dl>
    )
  }
  if (display?.kind === 'quote') {
    const quote = display.quote
    return (
      <dl>
        <DetailRow
          label="Regime"
          value={quote?.regime ?? t('graphe.valeur.non-expose-sans-accent')}
        />
        <DetailRow label="Phases" value={quote?.phases.join(' · ') || t('graphe.valeur.aucune')} />
        <DetailRow
          label="Decomposition"
          value={
            quote?.decomposition.mode === 'build-only'
              ? t('graphe.valeur.build-uniquement', { n: quote.decomposition.maxNodes })
              : t('graphe.valeur.desactivee')
          }
        />
        <DetailRow
          label={t('graphe.ligne.appels-max')}
          value={quote?.limits.maxProviderCalls ?? t('graphe.valeur.non-expose-sans-accent')}
        />
        <DetailRow
          label={t('graphe.ligne.budget-tokens')}
          value={quote?.limits.maxTotalTokens ?? t('graphe.valeur.non-expose-sans-accent')}
        />
        <DetailRow
          label={t('graphe.ligne.mesure-tokens')}
          value={t('graphe.valeur.mesure-tokens')}
        />
        <DetailRow
          label={t('graphe.ligne.agents-max')}
          value={quote?.limits.maxAgents ?? t('graphe.valeur.non-expose-sans-accent')}
        />
        <DetailRow
          label={t('graphe.ligne.concurrence-max')}
          value={quote?.limits.maxConcurrency ?? t('graphe.valeur.non-expose-sans-accent')}
        />
      </dl>
    )
  }
  if (display?.kind === 'skill') {
    return (
      <dl>
        <DetailRow
          label={t('graphe.ligne.phase-observee')}
          value={display.skillName ?? t('graphe.valeur.non-exposee')}
        />
        <DetailRow label={t('graphe.ligne.identite')} value={t('graphe.valeur.alias-phase')} />
        <DetailRow label="Run" value={display.runId ?? t('graphe.valeur.non-expose')} />
      </dl>
    )
  }
  if (display?.kind === 'agent') {
    return (
      <dl>
        <DetailRow label="Agent" value={event.execution?.agentId ?? event.actor} />
        <DetailRow
          label="Attempt"
          value={display.attemptId ?? event.execution?.attemptId ?? t('graphe.valeur.non-expose')}
        />
        <DetailRow label="Skill" value={display.skillName ?? t('graphe.valeur.non-exposee')} />
        <DetailRow
          label={t('graphe.ligne.duree')}
          value={durationLabel(event.durationMs, offsetMs)}
        />
        {event.provider && <DetailRow label="Provider" value={event.provider} />}
        {event.model && <DetailRow label={t('graphe.ligne.modele')} value={event.model} />}
        {(display.dependencyIds?.length ?? 0) > 0 && (
          <DetailRow
            label={t('graphe.ligne.depend-de')}
            value={display.dependencyIds?.join(', ')}
          />
        )}
      </dl>
    )
  }
  if (display?.kind === 'git') {
    const git = display.git
    return (
      <dl>
        <DetailRow label={t('graphe.ligne.sort-git')} value={gitOutcomeLabel(git?.outcome)} />
        <DetailRow
          label={t('graphe.ligne.revision')}
          value={git?.commitSha ?? t('graphe.valeur.aucun-commit')}
        />
        <DetailRow
          label={t('graphe.ligne.branche-base')}
          value={git?.baseBranch ?? t('graphe.valeur.non-exposee')}
        />
        {git?.worktreePath && <DetailRow label="Worktree" value={git.worktreePath} />}
        {(git?.files?.length ?? 0) > 0 && (
          <DetailRow label={t('graphe.ligne.fichiers')} value={git?.files?.join(', ')} />
        )}
        {git?.reason && (
          <DetailRow
            label="Cause"
            value={
              sensDuCodeDeBlocage(git.reason)
                ? `${sensDuCodeDeBlocage(git.reason)} (${git.reason})`
                : git.reason
            }
          />
        )}
      </dl>
    )
  }
  if (display?.kind === 'closure') {
    const closure = display.closure
    return (
      <dl>
        <DetailRow
          label={t('graphe.ligne.etat-cloture')}
          value={closureStatusLabel(closure?.status)}
        />
        <DetailRow
          label={t('graphe.ligne.temps-total')}
          value={durationLabel(closure?.totalDurationMs, offsetMs)}
        />
        <DetailRow label={t('graphe.ligne.cout-total')} value={costLabel(closure?.totalCostUsd)} />
        {closure?.usage && (
          <>
            <DetailRow
              label={t('graphe.ligne.agents-admis')}
              value={closure.usage.startedAgents ?? t('graphe.valeur.non-expose-sans-accent')}
            />
            <DetailRow
              label={t('graphe.ligne.appels-fournisseur')}
              value={closure.usage.startedCalls}
            />
            <DetailRow label={t('graphe.ligne.appels-actifs')} value={closure.usage.activeCalls} />
            <DetailRow label={t('graphe.ligne.tokens-totaux')} value={closure.usage.totalTokens} />
            <DetailRow label={t('graphe.ligne.tokens-frais')} value={closure.usage.freshTokens} />
            <DetailRow
              label={t('graphe.ligne.couverture')}
              value={
                closure.usage.unpricedCalls > 0
                  ? t('graphe.valeur.sans-prix', { n: closure.usage.unpricedCalls })
                  : closure.usage.tokenCoverage === 'complete'
                    ? t('graphe.valeur.complete')
                    : t('graphe.valeur.partielle')
              }
            />
          </>
        )}
        {closure?.integrationOutcome && (
          <DetailRow
            label={t('graphe.ligne.integration')}
            value={gitOutcomeLabel(closure.integrationOutcome)}
          />
        )}
        {(closure?.gateReasons?.length ?? 0) > 0 && (
          <DetailRow label={t('graphe.ligne.raisons')} value={closure?.gateReasons?.join(' · ')} />
        )}
      </dl>
    )
  }
  return (
    <dl>
      <DetailRow label={t('graphe.ligne.acteur')} value={event.actor} />
      <DetailRow
        label={t('graphe.ligne.duree')}
        value={durationLabel(event.durationMs, offsetMs)}
      />
      {skillLabel(event) && <DetailRow label="Skill" value={skillLabel(event)} />}
      {event.provider && <DetailRow label="Provider" value={event.provider} />}
      {event.model && <DetailRow label={t('graphe.ligne.modele')} value={event.model} />}
      <DetailRow label="Observation" value={event.detail} />
    </dl>
  )
}

/**
 * L'ARBRE ÉTOILÉ (conv-234, 2026-10-11) — remplace la pile de cartes égales.
 *
 * Choix de l'utilisateur, arrêté par /draft en cinq tours : « Constellation c'est incroyable »,
 * puis l'Arbre étoilé, puis le mélange Perles + Flux + Fiche accrochée, enfin « go fil holo ».
 *   - chaque étape est une PERLE de verre dont la taille suit la durée ;
 *   - des points COULENT sur les liens qui mènent à ce qui tourne ;
 *   - l'étape choisie descend un FIL bleu → rose jusqu'à sa FICHE au bord holo, glissée sous sa
 *     ligne : la fiche reste près de l'étape même au milieu d'un run de 500 agents.
 * Le placement est calculé à part (`graph-constellation-layout.ts`), sans DOM.
 */
const AIR_DU_FIL = 14

function ExecutionConstellation({
  conversationId,
  nodes,
  layout,
  actifs,
  selectedId,
  idDegrade,
  baseMs,
  dureeDemande,
  onToggle
}: {
  conversationId: string
  nodes: CausalPathNode[]
  layout: ConstellationLayout
  actifs: Set<string>
  selectedId: string | null
  idDegrade: string
  baseMs?: number
  dureeDemande?: number
  onToggle: (id: string) => void
}): React.JSX.Element | null {
  const parId = new Map(nodes.map((node) => [node.id, node]))
  const choisi = selectedId ? layout.nodes.get(selectedId) : undefined
  const noeudChoisi = selectedId ? parId.get(selectedId) : undefined
  if (layout.rows.length === 0) return null
  const coupure = choisi ? choisi.row + 1 : layout.rows.length
  const avant = layout.rows.slice(0, coupure)
  const apres = layout.rows.slice(coupure)

  const bande = (rows: ConstellationRow[], avecFil: boolean): React.JSX.Element => {
    const haut = rows[0].top
    const hauteur = rows.reduce((total, row) => total + row.height, 0) + (avecFil ? AIR_DU_FIL : 0)
    const ici = new Set(rows.flatMap((row) => row.ids))
    const liens = [...layout.nodes.values()].filter(
      (place) => place.parentId && (ici.has(place.id) || ici.has(place.parentId))
    )
    return (
      <div className="workflow-execution-band" style={{ height: hauteur }}>
        <svg
          className="workflow-execution-links"
          width={layout.width}
          height={hauteur}
          viewBox={`0 ${haut} ${layout.width} ${hauteur}`}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient
              id={`${idDegrade}-lien`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="0"
              y2={Math.max(1, layout.height)}
            >
              <stop offset="0" className="wx-stop-froid" />
              <stop offset="1" className="wx-stop-chaud" />
            </linearGradient>
            {avecFil && choisi && (
              <linearGradient
                id={`${idDegrade}-fil`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={choisi.bottom}
                x2="0"
                y2={haut + hauteur}
              >
                <stop offset="0" className="wx-stop-froid" />
                <stop offset="1" className="wx-stop-chaud" />
              </linearGradient>
            )}
          </defs>
          {liens.map((place) => {
            const parent = layout.nodes.get(place.parentId ?? '')
            const enfant = parId.get(place.id)
            if (!parent || !enfant) return null
            const chemin = constellationEdgePath(parent, place, layout.width)
            const attente = enfant.event.status === 'pending'
            const actif = !attente && actifs.has(place.id)
            return (
              <g key={place.id}>
                <path
                  d={chemin}
                  className={`workflow-execution-edge${attente ? ' is-attente' : ''}${actif ? ' is-actif' : ''}`}
                  stroke={`url(#${idDegrade}-lien)`}
                  {...(ici.has(place.id) ? { 'data-execution-edge': place.id } : {})}
                />
                {actif && <path d={chemin} className="workflow-execution-flux" />}
              </g>
            )
          })}
          {avecFil && choisi && (
            <g data-execution-fil={choisi.id}>
              <path
                d={`M${choisi.x} ${choisi.bottom + 2}V${haut + hauteur}`}
                className="workflow-execution-fil"
                stroke={`url(#${idDegrade}-fil)`}
              />
              <path
                d={`M${choisi.x} ${choisi.bottom + 4}V${haut + hauteur}`}
                className="workflow-execution-fil-flux"
              />
            </g>
          )}
        </svg>
        {rows.flatMap((row) =>
          row.ids.map((id) => {
            const place = layout.nodes.get(id)
            const node = parId.get(id)
            if (!place || !node) return null
            const event = node.event
            const status = event.status ?? 'completed'
            const kind = event.display?.kind ?? 'event'
            const titre = event.display?.title ?? texte(EVENT_LABEL[event.kind])
            const compte = event.display?.count
            const offset = offsetFromStart(event.timestamp, baseMs)
            const duree = dureeDuNoeud(node)
            const lourd =
              !place.root && duree != null && dureeDemande != null && dureeDemande > 0
                ? duree / dureeDemande >= 0.25
                : false
            return (
              <button
                key={id}
                type="button"
                role="treeitem"
                aria-selected={selectedId === id}
                title={`${titre}${compte ? ` ×${compte}` : ''} — ${statusLabelDuNoeud(status, event.display)}`}
                className={[
                  'workflow-execution-node',
                  `is-${kind}`,
                  `is-${status}`,
                  selectedId === id ? 'is-selected' : '',
                  place.root ? 'is-racine' : '',
                  actifs.has(id) ? 'is-actif' : '',
                  lourd ? 'is-lourd' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  {
                    left: place.x - place.largeur / 2,
                    top: place.top - haut,
                    width: place.largeur,
                    height: row.astre + row.legende,
                    '--wx-r': `${place.r}px`,
                    '--wx-astre': `${row.astre}px`
                  } as React.CSSProperties
                }
                data-execution-node={id}
                data-execution-kind={kind}
                data-execution-agent={event.execution?.agentId ?? event.actor}
                data-execution-provider={event.provider}
                data-execution-model={event.model}
                data-execution-skill={event.display?.skillName}
                data-execution-run={event.display?.runId}
                data-depth={node.depth}
                onClick={() => onToggle(id)}
              >
                {place.root ? (
                  <span className="wx-pastille workflow-execution-node-title">
                    <b>{titre}</b>
                    <em className="wx-statut">{statusLabel(status)}</em>
                  </span>
                ) : (
                  <span className="wx-astre" aria-hidden="true">
                    <span className="wx-halo" />
                    <span className="workflow-execution-dot wx-perle" />
                    <span className="wx-anneau" />
                  </span>
                )}
                <span className="workflow-execution-node-copy wx-legende">
                  {!place.root && (
                    <>
                      {/* Le « ×N » est HORS du texte coupé : un titre trop long perd sa fin, jamais
                          son nombre (panneau de 388 px, 2026-10-12). */}
                      <span className="workflow-execution-node-title">
                        <b>{titre}</b>
                        {compte && (
                          <span className="wx-compte" data-execution-count={compte}>
                            ×{compte}
                          </span>
                        )}
                      </span>
                      <span className="wx-chiffre">
                        {status === 'completed' && <span>{chiffreDuNoeud(node, offset)}</span>}
                        <em className="wx-statut">{statusLabelDuNoeud(status, event.display)}</em>
                      </span>
                    </>
                  )}
                  {/* Pas de ligne qui redit le titre (`hasCardMeta`) : une étape porte déjà son nom
                      en titre (« Judge », `nomDEtape`, conv-1094), un outil ou un orchestrateur
                      sans skill n'a rien à ajouter. */}
                  {hasCardMeta(event) && (
                    <span className="workflow-execution-node-meta">
                      <ExecutionNodeMeta event={event} offsetMs={offset} sansDuree />
                    </span>
                  )}
                  {/* POURQUOI L'ÉTAPE A ÉCHOUÉ, LISIBLE SANS CLIC (2026-10-10, conv-163). */}
                  {event.display?.failure && (
                    <span
                      className="workflow-execution-node-failure"
                      data-execution-failure
                      title={event.display.failure}
                    >
                      {event.display.failure}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    )
  }

  return (
    <>
      {bande(avant, Boolean(choisi))}
      {noeudChoisi && choisi && (
        <ExecutionFiche
          conversationId={conversationId}
          node={noeudChoisi}
          racine={choisi.root}
          baseMs={baseMs}
          dureeDemande={dureeDemande}
        />
      )}
      {apres.length > 0 && bande(apres, false)}
    </>
  )
}

/**
 * LA FICHE ACCROCHÉE — le détail de l'étape choisie, au bout du fil. Elle reprend tout ce que le
 * détail montrait (lignes par type, prompt envoyé, instructions système, retour, raisonnement) et
 * y ajoute la PART de la demande que l'étape a prise, en jauge.
 */
function ExecutionFiche({
  conversationId,
  node,
  racine,
  baseMs,
  dureeDemande
}: {
  conversationId: string
  node: CausalPathNode
  racine: boolean
  baseMs?: number
  dureeDemande?: number
}): React.JSX.Element {
  const { t } = useTextesChatExecution()
  const event = node.event
  const status = event.status ?? 'completed'
  const offset = offsetFromStart(event.timestamp, baseMs)
  const duree = dureeDuNoeud(node)
  const defauts = defautsDeTrace(node)
  const part =
    !racine && duree != null && dureeDemande != null && dureeDemande > 0
      ? Math.min(1, duree / dureeDemande)
      : undefined
  return (
    <div
      className="workflow-execution-detail wx-fiche"
      role="region"
      aria-label={t('graphe.fiche')}
      data-execution-detail-of={node.id}
    >
      <div className="wx-fiche-tete">
        <b>{event.display?.title ?? t(EVENT_LABEL[event.kind])}</b>
        <em className={`wx-fiche-statut is-${status}`}>
          {statusLabelDuNoeud(status, event.display)}
        </em>
      </div>
      {part != null && (
        <div className="wx-jauge" data-execution-part={Math.round(part * 100)}>
          <span className="wx-jauge-piste">
            <span className="wx-jauge-plein" style={{ width: `${Math.max(2, part * 100)}%` }} />
          </span>
          <span className="wx-jauge-texte">
            {chiffreDuNoeud(node, offset)} ·{' '}
            {riche(t('graphe.fiche.part', { part: Math.round(part * 100) }), 'b')}
          </span>
        </div>
      )}
      {/* POURQUOI L'ÉTAPE ROUGE A ÉCHOUÉ, EN TÊTE DE SA FICHE (conv-966). La carte la coupe sur une
          ligne ; ici elle est entière. Une clôture qui liste déjà ses « Raisons » ne la double pas. */}
      {status === 'failed' &&
        event.display?.failure &&
        !(event.display.kind === 'closure' && event.display.closure?.gateReasons?.length) && (
          <p className="workflow-execution-pourquoi" data-execution-pourquoi>
            <b>{t('graphe.fiche.pourquoi')}</b> · {event.display.failure}
          </p>
        )}
      <ExecutionNodeDetail event={event} offsetMs={offset} />
      <ExecutionNodeContents conversationId={conversationId} event={event} />
      {/* L'ORANGE EST RÉSERVÉ AUX DÉFAUTS (2026-10-13) : une étape en cours ou instantanée n'a pas
          de durée sans que la trace soit abîmée (`defauts-de-trace.ts`). Une limite connue de la
          trace (« Chat direct… », phase sans nom de skill) est une information : ton neutre. */}
      {defauts.length > 0 && (
        <p className="workflow-execution-warning" data-execution-defaut>
          {t('graphe.fiche.trace-partielle', { defauts: defauts.join(', ') })}
        </p>
      )}
      {event.display?.limitation && (
        <p className="workflow-execution-note" data-execution-note>
          {event.display.limitation}
        </p>
      )}
    </div>
  )
}

export function WorkflowExecutionGraph({
  conversationId,
  active = true,
  live = false,
  requestLabel,
  turnId: imposedTurnId,
  onSelect
}: WorkflowExecutionGraphProps): React.JSX.Element {
  const { langue, t } = useTextesChatExecution()
  const [events, setEvents] = useState<HarnessTimelineEvent[]>([])
  const [turnId, setTurnId] = useState<string | undefined>()
  const [turns, setTurns] = useState<RequestTurnOption[]>([])
  // Tour DEMANDÉ par l'utilisateur. Distinct de `turnId` (le tour effectivement projeté) : sans
  // cette distinction, un rechargement en direct écraserait le choix à chaque seconde. Le choix est
  // RATTACHÉ à sa conversation plutôt que remis à zéro par un effet : changer de conversation le
  // périme alors de lui-même, sans rendu supplémentaire ni cascade.
  const [picked, setPicked] = useState<{ convId?: string; turnId: string } | null>(null)
  const pickedTurnId =
    imposedTurnId ?? (picked && picked.convId === conversationId ? picked.turnId : undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const requestGate = useRef(new LatestRequestGate())
  const previousLive = useRef(live)

  const load = useCallback(
    async (showLoading: boolean): Promise<void> => {
      if (!active || !conversationId) return
      const requestId = requestGate.current.begin()
      if (showLoading) {
        setEvents([])
        setTurnId(undefined)
        setSelectedId(null)
        setLoading(true)
        setError(null)
      }
      try {
        // La STRUCTURE seule : relue chaque seconde en direct, elle ne doit pas copier les contenus.
        const trace = (await (lecturesAllegeesDisponibles()
          ? window.api.causalTraceGraphe(conversationId)
          : window.api.causalTrace(conversationId))) as HarnessTraceEvent[]
        if (!requestGate.current.isCurrent(requestId)) return
        const timeline = buildHarnessTimelineFromTrace(Array.isArray(trace) ? trace : [])
        const projection = projectLatestRequestExecution(timeline, {
          requestLabel,
          ...(pickedTurnId ? { turnId: pickedTurnId } : {})
        })
        const nextEvents = projection.events
        setEvents(nextEvents)
        setTurnId(projection.turnId)
        setTurns(projection.turns ?? [])
        setSelectedId((current) =>
          current && nextEvents.some((event) => event.id === current) ? current : null
        )
        setError(null)
      } catch (reason) {
        if (!requestGate.current.isCurrent(requestId)) return
        setEvents([])
        setTurnId(undefined)
        setSelectedId(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (requestGate.current.isCurrent(requestId)) setLoading(false)
      }
    },
    [active, conversationId, requestLabel, pickedTurnId]
  )

  useEffect(() => {
    const gate = requestGate.current
    if (!active || !conversationId) {
      gate.invalidate()
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(true)
    })
    return () => {
      cancelled = true
      gate.invalidate()
    }
  }, [active, conversationId, load])

  useEffect(() => {
    if (!active || !live || !conversationId) return
    const timer = window.setInterval(() => void load(false), 1000)
    return () => window.clearInterval(timer)
  }, [active, conversationId, live, load])

  useEffect(() => {
    const wasLive = previousLive.current
    previousLive.current = live
    if (active && conversationId && wasLive && !live) void load(false)
  }, [active, conversationId, live, load])

  // LA LANGUE CHANGE : l'arbre est relu et reprojeté, sans écran de chargement (conv-1170). Le
  // modèle écrit dans la langue courante ses titres d'action, ses raisons d'échec et ses repères ;
  // sans cette relecture, ils resteraient dans l'ancienne langue jusqu'à la prochaine écriture.
  const languePrecedente = useRef(langue)
  useEffect(() => {
    if (languePrecedente.current === langue) return
    languePrecedente.current = langue
    if (!active || !conversationId) return
    // Hors du corps de l'effet, comme le chargement principal ci-dessus : pas de rendu en cascade.
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(false)
    })
    return () => {
      cancelled = true
    }
  }, [active, conversationId, langue, load])

  useEffect(() => {
    if (!active || !conversationId || !window.api.onAppEvent) return
    return window.api.onAppEvent((event) => {
      if (
        (event.type === 'orchestrate-usage' || event.type === 'causal-trace-updated') &&
        event.convId === conversationId
      )
        void load(false)
    })
  }, [active, conversationId, load])

  // RECONCILIATION AVANT construction : `persistOrchestrationPhaseStart` ecrit `running` au
  // DEMARRAGE d'une phase et compte sur l'evenement terminal pour dire la suite. L'app tuee en
  // pleine phase, ce terminal n'arrive jamais — le `running` reste sur disque et le graphe le
  // relisait indefiniment comme une etape active (« je vois encore des choses en cours », conv-1056).
  // Le composant CONNAISSAIT deja la reponse via `live` ; elle n'etait simplement pas consultee.
  // Rien n'est reecrit sur disque : la trace reste un fait historique, on corrige ce qu'on AFFICHE.
  const settledEvents = useMemo(() => {
    const settled = settleStrandedExecutionStatus(events, { live })
    // LA DEMANDE QUI TOURNE EST « EN COURS ». Le superviseur écrit un bilan après CHAQUE appel au
    // modèle : entre deux appels, la racine aurait lu « terminé » alors que le tour continue. Le
    // composant sait qu'une exécution est vivante (`live`) : la dernière demande est donc en cours.
    if (!live || pickedTurnId) return settled
    return settled.map((event) =>
      event.display?.kind === 'request' && event.status !== 'running'
        ? { ...event, status: 'running' }
        : event
    )
  }, [events, live, pickedTurnId])
  const graph = useMemo(() => buildCausalPath(settledEvents), [settledEvents])
  const nodes = useMemo(() => flattenCausalNodes(graph.roots), [graph.roots])
  // Debut de la demande = plus petit horodatage projete. Sert de reference aux evenements sans
  // duree mesuree, pour qu'aucun bloc n'affiche « inconnue ».
  const baseMs = useMemo(() => {
    const stamps = nodes
      .map((node) => Date.parse(node.event.timestamp ?? ''))
      .filter((at) => Number.isFinite(at))
    return stamps.length > 0 ? Math.min(...stamps) : undefined
  }, [nodes])
  const selected = selectedId ? graph.byId.get(selectedId) : undefined

  // La publication passe par un effet plutôt que par le gestionnaire de clic : la sélection change
  // aussi quand un rechargement fait disparaître le nœud choisi, et le panneau doit le savoir.
  const selectionRef = useRef<string | null>(null)
  const onSelectRef = useRef(onSelect)
  // Assignation dans un effet, jamais pendant le rendu : écrire une ref au rendu casse la garantie
  // de pureté de React (et le lint le refuse). Déclaré AVANT l’effet de publication pour que la
  // fonction à jour soit déjà en place quand celui-ci s’exécute.
  useEffect(() => {
    onSelectRef.current = onSelect
  })
  useEffect(() => {
    const event = selected?.event
    const closure = event?.display?.kind === 'closure' ? event.display.closure : undefined
    const verdictEventIds =
      event?.display?.kind === 'closure' ? event.display.verdictEventIds : undefined
    const gantt = event?.display?.kind === 'closure' ? event.display.gantt : undefined
    // La clôture d'un run CHANGE sous un nœud resté sélectionné (open → green, coût réglé après
    // coup, nouveau passage du juge) : sans ces champs dans la clé, son bilan resterait figé sur
    // l'état du premier clic.
    const key = event
      ? closure
        ? [
            event.id,
            closure.status,
            closure.totalCostUsd,
            closure.runPath ?? '',
            verdictEventIds?.length ?? 0,
            gantt ? `${gantt.lanes.length}:${gantt.end}` : ''
          ].join('|')
        : event.id
      : null
    if (selectionRef.current === key) return
    selectionRef.current = key
    onSelectRef.current?.(
      event
        ? {
            id: event.id,
            kind: event.display?.kind ?? 'event',
            ...(event.display?.runId ? { runId: event.display.runId } : {}),
            ...(event.display?.skillName ? { skillName: event.display.skillName } : {}),
            ...(turnId ? { turnId } : {}),
            ...(closure ? { closure } : {}),
            ...(verdictEventIds ? { verdictEventIds } : {}),
            ...(gantt ? { gantt } : {})
          }
        : null
    )
  }, [selected, turnId])

  // LARGEUR RÉELLE DE L'ARBRE : la constellation se pose dans la colonne qu'on lui donne, et se
  // replace quand on élargit ou rétrécit le panneau.
  const [arbre, setArbre] = useState<HTMLDivElement | null>(null)
  const [largeur, setLargeur] = useState(0)
  useEffect(() => {
    if (!arbre) return
    const mesurer = (): void => setLargeur(Math.round(arbre.clientWidth))
    mesurer()
    if (typeof ResizeObserver !== 'function') return
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(arbre)
    return () => observateur.disconnect()
  }, [arbre])
  // Identifiant des dégradés SVG, propre à cette instance : deux graphes ouverts ne se volent pas
  // leurs couleurs. `useId` rend des deux-points, illisibles dans une référence `url(#…)`.
  const idDegrade = `wx${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const constellation = useMemo(() => {
    // Une étape est « active » si elle tourne ou si l'une de ses descendantes tourne : c'est sur
    // ce chemin que le flux coule. L'ordre préfixe renversé visite les enfants avant leur parent.
    const actifs = new Set<string>()
    for (const node of [...nodes].reverse())
      if (node.event.status === 'running' || node.children.some((child) => actifs.has(child.id)))
        actifs.add(node.id)
    const layout = layoutConstellation(
      nodes.map((node) => ({
        id: node.id,
        ...(node.parentId && !node.issues.includes('missing-parent')
          ? { parentId: node.parentId }
          : {}),
        depth: node.depth,
        // La clôture résume le run, elle n'en est pas une étape : sa taille ne suit pas la durée.
        durationMs: node.event.display?.kind === 'closure' ? undefined : dureeDuNoeud(node),
        hasFailure: Boolean(node.event.display?.failure),
        running: node.event.status === 'running'
      })),
      { width: largeur, rootQuote: true }
    )
    return { layout, actifs }
  }, [nodes, largeur])
  // Durée de toute la demande : la jauge de la fiche dit la part qu'une étape en a prise.
  const dureeDemande = useMemo(() => {
    const racine = graph.roots[0]?.inclusiveDurationMs
    if (racine != null && racine > 0) return racine
    let fin = Number.NEGATIVE_INFINITY
    for (const node of nodes) {
      const at = Date.parse(node.event.timestamp ?? '')
      if (Number.isFinite(at)) fin = Math.max(fin, at + (node.event.durationMs ?? 0))
    }
    return baseMs != null && Number.isFinite(fin) && fin > baseMs ? fin - baseMs : undefined
  }, [graph.roots, nodes, baseMs])

  const runCount = new Set(
    nodes
      .map((node) => node.event.display?.runId)
      .filter((runId): runId is string => Boolean(runId))
  ).size

  if (!conversationId) {
    return <div className="workflow-execution-empty">{t('graphe.sans-conversation')}</div>
  }

  return (
    <section
      className="workflow-execution-graph"
      data-conversation-id={conversationId}
      data-turn-id={turnId}
      aria-label={t('graphe.arbre')}
      aria-busy={loading}
    >
      <header className="workflow-execution-summary">
        <div>
          <strong>{t('graphe.traitement')}</strong>
          <span>
            {runCount > 0 && (
              <>
                {runCount} run{runCount > 1 ? 's' : ''}
                {' · '}
              </>
            )}
            {nodes.filter((node) => node.event.display?.kind === 'agent').length} agent
            {nodes.filter((node) => node.event.display?.kind === 'agent').length > 1 ? 's' : ''}
            {' · '}
            {t(nodes.length > 2 ? 'graphe.etapes.n' : 'graphe.etapes.un', {
              n: Math.max(0, nodes.length - 1)
            })}
            {live ? t('graphe.en-direct') : ''}
          </span>
        </div>
        {/*
          SÉLECTEUR DE TOUR. Le graphe ne projetait que le dernier : tout l'historique de la
          conversation existait dans la trace et restait inatteignable. Masqué sous deux tours —
          une commande sans alternative est du bruit.
        */}
        {!imposedTurnId && turns.length > 1 && (
          <select
            className="workflow-execution-turn-select"
            data-execution-turn-select
            aria-label={t('graphe.choix-demande')}
            value={turnId ?? turns[0].id}
            onChange={(changed) =>
              setPicked({
                ...(conversationId ? { convId: conversationId } : {}),
                turnId: changed.target.value
              })
            }
          >
            {turns.map((turn) => (
              <option key={turn.id} value={turn.id}>
                {turn.label}
              </option>
            ))}
          </select>
        )}
        {/* Pas de bouton « ↻ » : le graphe se recharge seul à chaque écriture de trace
            (`causal-trace-updated`), chaque seconde en direct, et à la fin du tour. */}
      </header>

      {loading && nodes.length === 0 && (
        <div className="workflow-execution-loading" role="status">
          <Spinner />
          {t('graphe.chargement')}
        </div>
      )}
      {!loading && error && (
        <div className="workflow-execution-error" role="alert">
          {t('graphe.indisponible', { erreur: error })}
        </div>
      )}
      {!loading && !error && nodes.length === 0 && (
        <div className="workflow-execution-empty">
          {/* « la dernière demande » mentait dès qu'un tour ANTÉRIEUR était sélectionné. */}
          {pickedTurnId ? t('graphe.vide.choisie') : t('graphe.vide.derniere')}
        </div>
      )}

      {nodes.length > 0 && (
        <div
          className="workflow-execution-tree"
          role="tree"
          aria-label={t('graphe.traitement')}
          ref={setArbre}
          data-execution-constellation
        >
          <ExecutionConstellation
            conversationId={conversationId}
            nodes={nodes}
            layout={constellation.layout}
            actifs={constellation.actifs}
            selectedId={selectedId}
            idDegrade={idDegrade}
            baseMs={baseMs}
            dureeDemande={dureeDemande}
            onToggle={(id) => setSelectedId((current) => (current === id ? null : id))}
          />
        </div>
      )}
    </section>
  )
}
