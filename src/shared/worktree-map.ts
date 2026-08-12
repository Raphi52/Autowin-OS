// Contrat et geometrie de la vue Worktrees "plan de metro".
//
// Pourquoi un fichier partage : les trois grandeurs affichees (retard en commits, saleté,
// taille disque) n'existaient nulle part avant ce run. Les declarer une seule fois evite la
// divergence main/preload/renderer qu'on a deja payee sur les listes d'evenements pilote.
//
// Pourquoi la geometrie est PURE ici : elle porte les decisions de lecture (territoire,
// echelle rompue, largeur au prorata) et doit etre falsifiable sans DOM ni capture.

/** Un worktree git, avec ce que `git worktree list --porcelain` NE donne pas. */
export interface WorktreeMapEntry {
  path: string
  /** SHA court du HEAD de cette copie. */
  head: string
  /** Branche nommee, absente si la copie est detachee. */
  branch?: string
  detached: boolean
  locked: boolean
  lockedReason?: string
  prunableReason?: string
  /** Existence physique du dossier. `undefined` = non vérifiable. */
  pathExists?: boolean
  /** Commits de retard sur la branche de reference. `undefined` = non calculable, jamais 0 par defaut. */
  behind?: number
  /** Fichiers non commités. 0 = copie propre. `undefined` = non mesuré. */
  dirtyFiles?: number
  /** Taille sur disque en octets, `undefined` si non mesurée. */
  sizeBytes?: number
}

export interface GitWorktreePorcelainEntry {
  path: string
  head: string
  branch?: string
  detached: boolean
  locked: boolean
  lockedReason?: string
  prunableReason?: string
}

/** Parse la sortie de `git worktree list --porcelain`, avec ou sans séparateurs NUL. */
export function parseGitWorktrees(input: string): GitWorktreePorcelainEntry[] {
  const blocks = input.includes('\0')
    ? input.split('\0\0').map((block) => block.split('\0').filter(Boolean))
    : input
        .trim()
        .split(/\r?\n\r?\n/)
        .map((block) => block.split(/\r?\n/))

  return blocks.flatMap((fields) => {
    const path = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length)
    const head = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length)
    if (!path || !head) return []
    const branchRef = fields.find((field) => field.startsWith('branch '))?.slice('branch '.length)
    const lockedField = fields.find((field) => field === 'locked' || field.startsWith('locked '))
    const prunableField = fields.find(
      (field) => field === 'prunable' || field.startsWith('prunable ')
    )
    const lockedReason = lockedField?.slice('locked'.length).trim()
    const prunableReason = prunableField?.slice('prunable'.length).trim()
    return [
      {
        path,
        head,
        ...(branchRef ? { branch: branchRef.replace(/^refs\/heads\//, '') } : {}),
        detached: fields.includes('detached'),
        locked: Boolean(lockedField),
        ...(lockedReason ? { lockedReason } : {}),
        ...(prunableField
          ? { prunableReason: prunableReason || 'entrée déclarée prunable par Git' }
          : {})
      }
    ]
  })
}

export interface WorktreeMapSnapshot {
  available: boolean
  repoPath: string
  repositoryName?: string
  /** Branche de reference sur laquelle le retard est calculé (typiquement `main`). */
  baseBranch?: string
  /** SHA court de la tete de la branche de reference. */
  baseHead?: string
  entries: WorktreeMapEntry[]
  doctor?: WorktreeDoctorReport
  /** Renseigné quand la lecture a partiellement echoué : la vue doit le DIRE, pas le masquer. */
  error?: string
}

export type WorktreeDoctorSeverity = 'info' | 'warning' | 'blocked'
export type WorktreeDoctorAction = 'repair' | 'prune-preview' | 'prune' | 'lock' | 'unlock'

export interface WorktreeDoctorProposal {
  action: WorktreeDoctorAction
  cwd: string
  argv: readonly string[]
  reason: string
  mutates: boolean
  automatic: false
  requiresConfirmation: boolean
}

export interface WorktreeDoctorFinding {
  code: 'prunable' | 'missing' | 'unreadable' | 'locked'
  severity: WorktreeDoctorSeverity
  path: string
  evidence: string
  proposals: readonly WorktreeDoctorProposal[]
}

export interface WorktreeDoctorReport {
  status: 'healthy' | 'attention' | 'blocked'
  findings: readonly WorktreeDoctorFinding[]
}

/* ------------------------------------------------------------------ agregats */

export interface WorktreeMapTotals extends Readonly<{
  count: number
  dirty: number
  clean: number
  /** Copies dont la saleté n'a pas pu etre mesurée : ni sales, ni propres. */
  unknown: number
  totalBytes: number
  /** Octets des copies propres et sans retard nul : ce qui peut partir sans rien perdre. */
  reclaimableBytes: number
  /**
   * Nombre de copies dont la taille a RÉELLEMENT été mesurée.
   *
   * Sans ce compteur, `totalBytes` valant 0 est ambigu : soit les copies sont vides, soit personne
   * n'a mesuré. L'en-tête affichait « 0 o au total » dans les deux cas — donc il affirmait une mesure
   * qui n'avait pas eu lieu (la mesure de taille n'est pas activée par défaut côté IPC). Le modèle
   * d'entrée distingue déjà les deux (`sizeBytes?: number`) ; l'agrégat écrasait la distinction.
   */
  measuredSizes: number
  maxBehind: number
}> {}

export function summarizeWorktreeMap(entries: readonly WorktreeMapEntry[]): WorktreeMapTotals {
  let dirty = 0
  let clean = 0
  let unknown = 0
  let totalBytes = 0
  let reclaimableBytes = 0
  let measuredSizes = 0
  let maxBehind = 0
  for (const entry of entries) {
    if (entry.dirtyFiles === undefined) unknown += 1
    else if (entry.dirtyFiles > 0) dirty += 1
    else clean += 1
    if (entry.sizeBytes !== undefined) measuredSizes += 1
    totalBytes += entry.sizeBytes ?? 0
    // Recuperable = propre AVEC certitude. Une saleté non mesurée n'est pas une copie propre.
    if (entry.dirtyFiles === 0) reclaimableBytes += entry.sizeBytes ?? 0
    if ((entry.behind ?? 0) > maxBehind) maxBehind = entry.behind ?? 0
  }
  return {
    count: entries.length,
    dirty,
    clean,
    unknown,
    totalBytes,
    reclaimableBytes,
    measuredSizes,
    maxBehind
  }
}

/* ------------------------------------------------------------------ geometrie */

export type WorktreeLineKind = 'live' | 'closed' | 'unknown'

export interface WorktreeMapStation {
  x: number
  y: number
  entryPath: string
  /** Present et > 0 uniquement sur une station en travaux. */
  dirtyFiles?: number
}

export interface WorktreeMapLine {
  kind: WorktreeLineKind
  /** Polyligne a 45/90 degres, du tronc jusqu'au terminus. */
  points: ReadonlyArray<readonly [number, number]>
  stations: readonly WorktreeMapStation[]
  terminus: readonly [number, number]
  label: string
  /** Chemins des worktrees portes par cette ligne, dans l'ordre des stations. */
  entryPaths: readonly string[]
}

export interface WorktreeMapInterchange {
  x: number
  head: string
  behind: number
  /** Vrai au-dela du seuil de retard : c'est ce qui declenche l'ambre. */
  late: boolean
  /** Commits sautés entre la correspondance precedente et celle-ci, si cassure. */
  skipped?: number
  /** Abscisse de la cassure qui precede, presente si et seulement si `skipped` l'est. */
  breakX?: number
}

export interface WorktreeMapLayout {
  width: number
  height: number
  trunkY: number
  interchanges: readonly WorktreeMapInterchange[]
  lines: readonly WorktreeMapLine[]
}

/** Retard a partir duquel une correspondance passe en ambre. */
export const LATE_BEHIND_THRESHOLD = 20

const GEO = {
  trunkY: 268,
  marginX: 210,
  /** Reserve horizontale par station, pour que la largeur suive le contenu. */
  stepX: 66,
  diag: 42,
  laneBase: 78,
  laneStep: 46,
  /** Marge entre l'extremite d'un eventail et la correspondance suivante. */
  gutter: 90,
  bottomPad: 96
} as const

/**
 * Regroupe les worktrees par commit d'accrochage, puis pose le plan.
 *
 * Deux decisions de lecture sont encodees ici, toutes deux nees de captures mesurees :
 *  - TERRITOIRE : une copie sale monte toujours au-dessus du tronc, une copie propre descend
 *    toujours en dessous. Sans exception, sinon la regle cesse d'etre lisible d'un coup d'oeil.
 *  - ECHELLE ROMPUE : l'abscisse suit la largeur reellement consommee par chaque eventail, pas
 *    le retard. Une echelle proportionnelle depensait ~2000 px de canevas sur un intervalle
 *    d'historique ou aucun worktree n'existe (constaté sur les maquettes V1 et V4).
 */
export function layoutWorktreeMap(
  entries: readonly WorktreeMapEntry[],
  options: { lateThreshold?: number } = {}
): WorktreeMapLayout {
  const lateThreshold = options.lateThreshold ?? LATE_BEHIND_THRESHOLD
  const groups = groupByHead(entries)

  const interchanges: WorktreeMapInterchange[] = []
  const lines: WorktreeMapLine[] = []
  let cursor: number = GEO.marginX
  let maxLaneAbove = 0
  let maxLaneBelow = 0
  let previousBehind: number | undefined

  for (const group of groups) {
    const x = cursor
    const live = group.entries.filter((entry) => (entry.dirtyFiles ?? 0) > 0)
    const closed = group.entries.filter((entry) => entry.dirtyFiles === 0)
    const unknown = group.entries.filter((entry) => entry.dirtyFiles === undefined)

    const interchange: WorktreeMapInterchange = {
      x,
      head: group.head,
      behind: group.behind,
      late: group.behind >= lateThreshold
    }
    // Cassure : l'intervalle d'historique sans aucun worktree est DECLARÉ, pas represente
    // par du vide. Un seul commit d'ecart n'est pas un trou.
    if (previousBehind !== undefined) {
      const skipped = group.behind - previousBehind - 1
      if (skipped > 0) {
        interchange.skipped = skipped
        interchange.breakX = Math.round((interchanges[interchanges.length - 1].x + x) / 2)
      }
    }
    interchanges.push(interchange)
    previousBehind = group.behind

    let extent = 0
    // Une ligne par copie sale (au-dessus), une par copie propre (en dessous) : chaque copie
    // reste identifiable, aucune n'est fondue dans un agregat.
    live.forEach((entry, lane) => {
      const line = buildLine(x, -1, lane, [entry], 'live')
      lines.push(line)
      maxLaneAbove = Math.max(maxLaneAbove, lane)
      extent = Math.max(extent, line.terminus[0])
    })
    closed.forEach((entry, lane) => {
      const line = buildLine(x, 1, lane, [entry], 'closed')
      lines.push(line)
      maxLaneBelow = Math.max(maxLaneBelow, lane)
      extent = Math.max(extent, line.terminus[0])
    })
    unknown.forEach((entry, lane) => {
      const actualLane = closed.length + lane
      const line = buildLine(x, 1, actualLane, [entry], 'unknown')
      lines.push(line)
      maxLaneBelow = Math.max(maxLaneBelow, actualLane)
      extent = Math.max(extent, line.terminus[0])
    })

    cursor = Math.max(x + GEO.gutter, extent + GEO.gutter)
  }

  const deepestLane = Math.max(maxLaneAbove, maxLaneBelow)
  const halfHeight = GEO.laneBase + deepestLane * GEO.laneStep + GEO.diag
  return {
    width: Math.round(cursor + GEO.marginX / 2),
    height: Math.round(GEO.trunkY + halfHeight + GEO.bottomPad),
    trunkY: GEO.trunkY,
    interchanges,
    lines
  }
}

interface HeadGroup {
  head: string
  behind: number
  entries: WorktreeMapEntry[]
}

/**
 * Un commit d'accrochage = une correspondance. Ordonne du plus a jour au plus en retard :
 * c'est le sens de lecture attendu (on part de main, on s'en eloigne).
 */
function groupByHead(entries: readonly WorktreeMapEntry[]): HeadGroup[] {
  const byHead = new Map<string, HeadGroup>()
  for (const entry of entries) {
    const existing = byHead.get(entry.head)
    if (existing) {
      existing.entries.push(entry)
      // Un retard non calculable ne doit pas ecraser un retard connu du meme commit.
      if (existing.behind === 0 && (entry.behind ?? 0) > 0) existing.behind = entry.behind ?? 0
      continue
    }
    byHead.set(entry.head, { head: entry.head, behind: entry.behind ?? 0, entries: [entry] })
  }
  return [...byHead.values()].sort((a, b) => a.behind - b.behind || a.head.localeCompare(b.head))
}

function buildLine(
  fromX: number,
  dirY: -1 | 1,
  lane: number,
  entries: readonly WorktreeMapEntry[],
  kind: WorktreeLineKind
): WorktreeMapLine {
  const points: Array<readonly [number, number]> = [[fromX, GEO.trunkY]]
  let x = fromX + GEO.diag
  let y = GEO.trunkY + dirY * GEO.diag
  points.push([x, y])
  const laneY = GEO.trunkY + dirY * (GEO.laneBase + lane * GEO.laneStep)
  if (y !== laneY) {
    y = laneY
    points.push([x, y])
  }
  const stations: WorktreeMapStation[] = []
  for (const entry of entries) {
    x += GEO.stepX
    points.push([x, y])
    stations.push({
      x,
      y,
      entryPath: entry.path,
      ...((entry.dirtyFiles ?? 0) > 0 ? { dirtyFiles: entry.dirtyFiles } : {})
    })
  }
  x += GEO.diag
  y += dirY * GEO.diag
  points.push([x, y])
  return {
    kind,
    points,
    stations,
    terminus: [x, y],
    label: terminusLabel(entries, kind),
    entryPaths: entries.map((entry) => entry.path)
  }
}

function terminusLabel(entries: readonly WorktreeMapEntry[], kind: WorktreeLineKind): string {
  if (kind === 'closed') return 'FERMÉ'
  if (kind === 'unknown') return 'INCONNU'
  const files = entries.reduce((sum, entry) => sum + (entry.dirtyFiles ?? 0), 0)
  return `EN TRAVAUX · ${files} ${files === 1 ? 'fichier' : 'fichiers'}`
}

/** Libellé court d'un worktree : la branche si elle existe, sinon le dossier. */
export function worktreeLabel(entry: WorktreeMapEntry): string {
  if (entry.branch) return entry.branch
  const segments = entry.path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? entry.path
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} Go`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} Mo`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} Ko`
  return `${bytes} o`
}
