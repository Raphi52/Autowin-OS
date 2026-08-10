export interface InterruptedWorktreeSummaryItem {
  runId: string
  worktreePath?: string
  conversationId?: string
}

/**
 * Résumé de démarrage borné : l'inventaire complet reste disponible dans la vue Worktrees, tandis
 * que les rechargements HMR ne répètent plus des dizaines de chemins historiques dans le terminal.
 */
export function summarizeInterruptedWorktrees(
  worktrees: readonly InterruptedWorktreeSummaryItem[],
  visibleLimit = 3
): string[] {
  if (worktrees.length === 0) return []
  const limit = Math.max(0, Math.floor(visibleLimit))
  const lines = [`[worktrees] ${worktrees.length} copies isolées interrompues conservées`]
  for (const worktree of worktrees.slice(0, limit)) {
    lines.push(
      `[worktrees] ${worktree.runId}` +
        `${worktree.worktreePath ? ` → ${worktree.worktreePath}` : ''}` +
        `${worktree.conversationId ? ` (${worktree.conversationId})` : ''}`
    )
  }
  const hidden = worktrees.length - Math.min(worktrees.length, limit)
  if (hidden > 0) lines.push(`[worktrees] … ${hidden} autres copies visibles dans la vue Worktrees`)
  return lines
}
