import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * Journal d'activité PAR CONVERSATION — chaque appel modèle facturé (tour de chat de
 * l'agent, sous-étape d'orchestration) laisse une entrée avec son coût en tokens.
 * Un fichier JSONL par conversation : `%APPDATA%\autowin-os\activity\<convId>.jsonl`.
 * C'est la matière de l'onglet Activité (scopé à la conversation, plus de global).
 */
export interface ConvActivityEntry {
  ts: string
  kind: 'chat' | 'exec' | 'judge' | 'gate' | string
  label: string
  provider?: string
  model?: string
  reasoningEffort?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  costUsd?: number
  /** Stable id of the provider call, when this entry mirrors prompt observability. */
  usageCallId?: string
  /**
   * Tour de chat d'origine. ABSENT jusqu'au 2026-09-02 : le rapport /rendement devait deviner le
   * tour par l'HORODATAGE (« la derniere demande utilisateur avant cet evenement »), ce qui casse
   * des que deux tours se chevauchent. Renseigne seulement quand l'appelant le connait.
   */
  turnId?: string
  /** Phase du pipeline (frame, build, judge...) quand elle est connue — jamais devinee. */
  phase?: string
  /**
   * Duree de l'operation. ABSENTE jusqu'au 2026-07-29 : ce journal porte les sous-agents les plus
   * couteux (mesure conv-75 : 2,83 $ vus cote appels contre ~20,70 $ reels), donc on ne pouvait pas
   * repondre a « quelle phase prend le TEMPS », seulement a « laquelle prend l'argent » — les deux ne
   * coincident pas forcement.
   */
  durationMs?: number
  text?: string
  screenshots?: string[]
}

const TEXT_CAP = 600
const SCREENSHOT_RE =
  /(?:[A-Za-z]:[\\/][^\n\r<>|?*"']+?\.(?:png|jpe?g|webp|gif|bmp)|(?:\.\.?[\\/])[^\n\r<>|?*"']+?\.(?:png|jpe?g|webp|gif|bmp))/gi

/** Chemins image cités par un agent : preuve locale, jamais un scan du disque. */
export function extractScreenshotEvidence(text?: string): string[] {
  if (!text) return []
  return [...new Set((text.match(SCREENSHOT_RE) ?? []).map((path) => path.trim()))]
}

function convActivityRoot(): string {
  return join(ensureAutowinAppData(), 'activity')
}

function fileFor(convId: string, root: string): string {
  // convId est de forme conv-N (sûr) ; on neutralise tout de même les séparateurs.
  return join(root, `${convId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`)
}

export function appendConvActivity(
  convId: string,
  entry: Omit<ConvActivityEntry, 'ts'>,
  root = convActivityRoot(),
  now: () => number = () => Date.now()
): void {
  try {
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    const e: ConvActivityEntry = {
      ts: new Date(now()).toISOString(),
      kind: entry.kind,
      label: entry.label,
      provider: entry.provider,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      costUsd: entry.costUsd,
      usageCallId: entry.usageCallId,
      turnId: entry.turnId,
      phase: entry.phase,
      durationMs: entry.durationMs,
      // Configuration diffs are audit evidence: truncating them would make the
      // Workflows view unable to explain the exact effective prompt change.
      text: entry.text
        ? entry.kind === 'configuration-change'
          ? entry.text
          : entry.text.slice(0, TEXT_CAP)
        : undefined,
      screenshots: extractScreenshotEvidence(entry.text)
    }
    appendFileSync(fileFor(convId, root), `${JSON.stringify(e)}\n`, 'utf8')
  } catch {
    /* le journal est un bonus : son échec ne casse jamais l'action tracée */
  }
}

/** Entrées d'une conversation, dans l'ordre chronologique. */
export function loadConvActivity(convId: string, root = convActivityRoot()): ConvActivityEntry[] {
  try {
    const p = fileFor(convId, root)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8')
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as ConvActivityEntry
        } catch {
          return null
        }
      })
      .filter((e): e is ConvActivityEntry => e !== null)
  } catch {
    return []
  }
}
