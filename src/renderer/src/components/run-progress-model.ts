/**
 * Modèle de la vue « Avancée » d'un RUN : la timeline VIVANTE du travail, pas le fichier produit.
 *
 * Pourquoi : `RunInspector` ne rend que le RUN.md final ; le suivi (où on en est, sur quoi ça
 * frotte, ce que le modèle pensait) existait dans les données (`OrchStep.thinking`, `status`,
 * `error`, `evidence`) sans jamais être présenté comme un AVANCEMENT. Fonction PURE → testable.
 */
import { phaseLabel, type LiveRunPhase, type OrchStep } from './chat-view-model'

export type RunProgressEntry = {
  key: string
  label: string
  role?: string
  model?: string
  state: 'done' | 'failed' | 'running'
  costUsd?: number
  tokens?: number
  thinking?: string
  obstacles: string[]
  evidence: Array<{ ok: boolean; summary: string }>
  /** Icône de TYPE d'étape (en plus du liseré, qui porte le statut). */
  icon: string
  /** Étages : sous-étapes de la carte (obstacles puis preuves) — vide si l'étape est simple. */
  substeps: Array<{ icon: string; label: string; state: 'ok' | 'ko' }>
}

export type RunProgressView = {
  entries: RunProgressEntry[]
  doneCount: number
  failedCount: number
  obstacleCount: number
  totalCost: number
  activeLabel?: string
}

/**
 * Lignes de FRICTION seulement — marqueurs explicites (⛔ / ⚠️ / « bloqué » / « non résolu »).
 * Volontairement étroit : élargir aux mots vagues ferait remonter le corps du texte comme obstacle.
 */
export function extractObstacles(text?: string): string[] {
  if (!text) return []
  const MARQUEUR = /(⛔|⚠️|\bbloqué\b|\bnon résolu\b|\bnon vérifié\b)/i
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && MARQUEUR.test(l))
}

function phaseOf(s: OrchStep): string | undefined {
  return s.detail?.match(/phase (\w+)/)?.[1]
}

function evidenceSummary(e: NonNullable<OrchStep['evidence']>[number]): string {
  if (e.command) return `$ ${e.command} — exit ${e.exitCode ?? '?'}`
  if (e.path) return `📝 ${e.path}`
  return e.summary || e.type
}

/** Icône par TYPE d'étape — le statut reste porté par le liseré/le point. */
const ICONE_PHASE: Record<string, string> = {
  scout: '🔍',
  cadrage: '🧭',
  terrain: '🗺️',
  build: '🔧',
  nettoyage: '🧹',
  juge: '⚖️'
}

function iconeEtape(label: string): string {
  const phase = label.split('·').pop()?.trim() ?? ''
  return ICONE_PHASE[phase] ?? '•'
}

function iconePreuve(summary: string): string {
  if (summary.startsWith('$')) return '⌨️'
  if (summary.startsWith('📝')) return '📄'
  return '🧪'
}

export function buildRunProgress(steps: OrchStep[], activePhase?: LiveRunPhase): RunProgressView {
  const entries: RunProgressEntry[] = steps.map((s, i) => {
    const failed = s.status === 'failed'
    const label = phaseLabel({ step: s.step, phase: phaseOf(s) })
    const obstacles = [
      ...(failed && s.error ? [s.error] : []),
      ...extractObstacles(s.text),
      ...extractObstacles(s.thinking)
    ]
    const evidence = (s.evidence ?? []).map((e) => ({ ok: e.ok, summary: evidenceSummary(e) }))
    return {
      key: `${i}`,
      label,
      icon: iconeEtape(label),
      substeps: [
        ...obstacles.map((o) => ({ icon: '⛔', label: o, state: 'ko' as const })),
        ...evidence.map((e) => ({
          icon: iconePreuve(e.summary),
          label: e.summary,
          state: (e.ok ? 'ok' : 'ko') as 'ok' | 'ko'
        }))
      ],
      role: s.role,
      model: s.model,
      state: failed ? 'failed' : 'done',
      costUsd: s.costUsd,
      tokens: s.tokens,
      thinking: s.thinking,
      obstacles,
      evidence
    }
  })

  if (activePhase) {
    entries.push({
      key: 'active',
      label: phaseLabel(activePhase),
      role: activePhase.role,
      model: activePhase.model,
      state: 'running',
      icon: iconeEtape(phaseLabel(activePhase)),
      substeps: [],
      obstacles: [],
      evidence: []
    })
  }

  return {
    entries,
    doneCount: entries.filter((e) => e.state === 'done').length,
    failedCount: entries.filter((e) => e.state === 'failed').length,
    obstacleCount: entries.reduce((n, e) => n + e.obstacles.length, 0),
    totalCost: entries.reduce((n, e) => n + (e.costUsd ?? 0), 0),
    activeLabel: activePhase ? phaseLabel(activePhase) : undefined
  }
}
