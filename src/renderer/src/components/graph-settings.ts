import { autowinStorageKey, readMigratedStorageValue } from '../storage-keys'
import {
  DEFAULT_GRAPH_NODE_SPACING,
  normalizeGraphNodeSpacing,
  type GraphVisualMode
} from './graph-view-model'

export type GraphVisibilitySettings = {
  labels: boolean
  links: boolean
  orphans: boolean
  arrows: boolean
  contextOpacity: number
  nodeSize: number
  linkWidth: number
  nodeSpacing: number
  lod: number
}

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const GRAPH_VISIBILITY_SETTINGS_SUFFIX = 'graph.visibility-settings.v1'
const LEGACY_NODE_SPACING_SUFFIX = 'graph.node-spacing.v1'

export const DEFAULT_GRAPH_VISIBILITY_SETTINGS: GraphVisibilitySettings = {
  labels: true,
  links: true,
  orphans: true,
  arrows: false,
  contextOpacity: 0.22,
  nodeSize: 1.4,
  linkWidth: 0.7,
  nodeSpacing: DEFAULT_GRAPH_NODE_SPACING,
  lod: 300
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined
}

export function loadGraphVisibilitySettings(storage: StorageLike): GraphVisibilitySettings {
  let stored: Record<string, unknown> = {}
  const raw = readMigratedStorageValue(storage, GRAPH_VISIBILITY_SETTINGS_SUFFIX)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stored = parsed as Record<string, unknown>
      }
    } catch {
      // Une préférence corrompue ne doit jamais empêcher Memory de s'ouvrir.
    }
  }
  const legacySpacing = readMigratedStorageValue(storage, LEGACY_NODE_SPACING_SUFFIX)
  const boolean = (key: keyof GraphVisibilitySettings): boolean | undefined =>
    typeof stored[key] === 'boolean' ? stored[key] : undefined
  return {
    labels: boolean('labels') ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.labels,
    links: boolean('links') ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.links,
    orphans: boolean('orphans') ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.orphans,
    arrows: boolean('arrows') ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.arrows,
    contextOpacity:
      boundedNumber(stored.contextOpacity, 0.05, 0.8) ??
      DEFAULT_GRAPH_VISIBILITY_SETTINGS.contextOpacity,
    nodeSize: boundedNumber(stored.nodeSize, 0.5, 3) ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.nodeSize,
    linkWidth:
      boundedNumber(stored.linkWidth, 0.1, 2) ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.linkWidth,
    nodeSpacing:
      boundedNumber(stored.nodeSpacing, 30, 240) ??
      (legacySpacing === null
        ? DEFAULT_GRAPH_VISIBILITY_SETTINGS.nodeSpacing
        : normalizeGraphNodeSpacing(legacySpacing)),
    lod: boundedNumber(stored.lod, 100, 10_000) ?? DEFAULT_GRAPH_VISIBILITY_SETTINGS.lod
  }
}

export function saveGraphVisibilitySettings(
  storage: StorageLike,
  settings: GraphVisibilitySettings
): void {
  storage.setItem(autowinStorageKey(GRAPH_VISIBILITY_SETTINGS_SUFFIX), JSON.stringify(settings))
}

/** Largeurs de la colonne détail (Memory) mémorisées PAR MODE : thème vs nœud. null = pas encore réglé. */
export type MemoryDetailWidths = { theme: number | null; node: number | null }

export const MEMORY_DETAIL_WIDTHS_SUFFIX = 'memory.detail-widths.v1'
const DETAIL_MIN = 160
const DETAIL_MAX = 2400

export function loadMemoryDetailWidths(storage: StorageLike): MemoryDetailWidths {
  const raw = readMigratedStorageValue(storage, MEMORY_DETAIL_WIDTHS_SUFFIX)
  const slot = (value: unknown): number | null =>
    boundedNumber(value, DETAIL_MIN, DETAIL_MAX) ?? null
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        return { theme: slot(record.theme), node: slot(record.node) }
      }
    } catch {
      /* fallback vide */
    }
  }
  return { theme: null, node: null }
}

export function saveMemoryDetailWidths(storage: StorageLike, widths: MemoryDetailWidths): void {
  storage.setItem(autowinStorageKey(MEMORY_DETAIL_WIDTHS_SUFFIX), JSON.stringify(widths))
}

/** Mode visuel du graphe Memory (sombre vs galaxy), persisté entre lancements. */
export const GRAPH_VISUAL_MODE_SUFFIX = 'memory.visual-mode.v1'

export function loadGraphVisualMode(storage: StorageLike): GraphVisualMode {
  return readMigratedStorageValue(storage, GRAPH_VISUAL_MODE_SUFFIX) === 'galaxy'
    ? 'galaxy'
    : 'serious'
}

export function saveGraphVisualMode(storage: StorageLike, mode: GraphVisualMode): void {
  storage.setItem(autowinStorageKey(GRAPH_VISUAL_MODE_SUFFIX), mode)
}

/**
 * DISPOSITION des nœuds — DEUX lectures des mêmes fiches, dont aucune ne subsume l'autre.
 *
 * - `force` : positions émergentes (historique, défaut HARD). Montre la CONNECTIVITÉ — ce qui est
 *   lié à quoi.
 * - `tree` : arborescence radiale, un anneau = un NIVEAU de profondeur, les branches portent la
 *   FILIATION, et le premier anneau porte le SUJET. Montre la hiérarchie réelle du vault.
 *
 * Un troisième mode a existé — `radial`, des bandes concentriques par famille — et il a été SUPPRIMÉ
 * sur demande de l'utilisateur : l'arborescence montre graphiquement la même hiérarchie que ces
 * bandes suggéraient, en la rendant navigable. Le forage textuel qui y était accroché disparaît avec
 * lui, pour la même raison : l'arbre l'affiche au lieu de le lister.
 */
export type GraphLayoutMode = 'force' | 'tree'

export const GRAPH_LAYOUT_MODE_SUFFIX = 'memory.layout-mode.v1'

const MODES_CONNUS: readonly GraphLayoutMode[] = ['force', 'tree']

export function loadGraphLayoutMode(storage: StorageLike): GraphLayoutMode {
  // Toute valeur inconnue retombe sur `force` : une clé corrompue ne doit pas rendre le graphe illisible.
  const brut = readMigratedStorageValue(storage, GRAPH_LAYOUT_MODE_SUFFIX)
  return MODES_CONNUS.includes(brut as GraphLayoutMode) ? (brut as GraphLayoutMode) : 'force'
}

/** L'ordre de bascule du bouton : libre → arbre → libre. */
export function nextGraphLayoutMode(mode: GraphLayoutMode): GraphLayoutMode {
  const index = MODES_CONNUS.indexOf(mode)
  return MODES_CONNUS[(index + 1) % MODES_CONNUS.length]
}

export function saveGraphLayoutMode(storage: StorageLike, mode: GraphLayoutMode): void {
  storage.setItem(autowinStorageKey(GRAPH_LAYOUT_MODE_SUFFIX), mode)
}
