import { oublierBrouillons } from './brouillons-persistes'
import { texteFil } from './chat-view-outils'
import { clampConversationPaneWidth, type OrchStep } from './chat-view-model'
import type { Conv, RunEntry, ComposerDraft } from './chat-view-types'
import type { OpenRunState } from './WorkflowsPanel'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que les gestes de la liste des conversations (renommer, supprimer, sélection, largeur) lisent de ChatView. */
export type GestesListeCtx = {
  activeId: string | null
  composerDraftsRef: React.RefObject<Map<string, ComposerDraft>>
  conversationsPaneWidth: number
  deleteCandidate: Conv | null
  deleteRunCandidate: {
    run: RunEntry
    scope: 'conv' | 'tous'
    conversationId?: string | undefined
  } | null
  newConv: () => void
  openRun: OpenRunState | null
  quitterModeSelection: () => void
  refreshConvs: () => Promise<void>
  refreshRuns: () => Promise<void>
  renameCandidate: { conv: Conv; value: string } | null
  runDeletePending: boolean
  selectedConvIds: ReadonlySet<string>
  setBulkDeleteAsking: React.Dispatch<React.SetStateAction<boolean>>
  setBulkDeleteError: React.Dispatch<React.SetStateAction<string | null>>
  setConversationsPaneWidth: React.Dispatch<React.SetStateAction<number>>
  setConvSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  setDeleteCandidate: React.Dispatch<React.SetStateAction<Conv | null>>
  setDeleteRunCandidate: React.Dispatch<
    React.SetStateAction<{
      run: RunEntry
      scope: 'conv' | 'tous'
      conversationId?: string | undefined
    } | null>
  >
  setOpenRun: React.Dispatch<React.SetStateAction<OpenRunState | null>>
  setOpenTrace: React.Dispatch<React.SetStateAction<OrchStep[] | null>>
  setRenameCandidate: React.Dispatch<React.SetStateAction<{ conv: Conv; value: string } | null>>
  setRunDeleteError: React.Dispatch<React.SetStateAction<string | null>>
  setRunDeletePending: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedConvIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
}

export function renameConv(ctx: GestesListeCtx, c: Conv): void {
  const { setRenameCandidate } = ctx
  setRenameCandidate({ conv: c, value: c.title })
}

export async function confirmRenameConv(ctx: GestesListeCtx): Promise<void> {
  const { refreshConvs, renameCandidate, setRenameCandidate } = ctx
  const candidate = renameCandidate
  if (!candidate) return
  const titre = candidate.value.trim()
  if (!titre || titre === candidate.conv.title) {
    setRenameCandidate(null)
    return
  }
  setRenameCandidate(null)
  await window.api.conversationsRename(candidate.conv.id, titre)
  await refreshConvs()
}

export async function removeConv(ctx: GestesListeCtx, c: Conv): Promise<void> {
  const { setDeleteCandidate } = ctx
  setDeleteCandidate(c)
}

export async function confirmRemoveConv(ctx: GestesListeCtx): Promise<void> {
  const {
    activeId,
    composerDraftsRef,
    deleteCandidate,
    newConv,
    refreshConvs,
    setDeleteCandidate
  } = ctx
  const c = deleteCandidate
  if (!c) return
  setDeleteCandidate(null)
  await window.api.conversationsRemove(c.id)
  composerDraftsRef.current.delete(c.id)
  oublierBrouillons([c.id])
  if (activeId === c.id) newConv()
  await refreshConvs()
}

export function toggleConvSelection(ctx: GestesListeCtx, id: string): void {
  const { setSelectedConvIds } = ctx
  setSelectedConvIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

export function quitterModeSelection(ctx: GestesListeCtx): void {
  const { setBulkDeleteError, setConvSelectionMode, setSelectedConvIds } = ctx
  setConvSelectionMode(false)
  setSelectedConvIds(new Set())
  setBulkDeleteError(null)
}

/** Supprime le LOT sélectionné en UNE confirmation. Les ids non sélectionnés restent intacts. */
export async function confirmBulkDelete(ctx: GestesListeCtx): Promise<void> {
  const {
    activeId,
    composerDraftsRef,
    newConv,
    quitterModeSelection,
    refreshConvs,
    selectedConvIds,
    setBulkDeleteAsking,
    setBulkDeleteError
  } = ctx
  const ids = [...selectedConvIds]
  if (ids.length === 0) return
  setBulkDeleteError(null)
  try {
    const removed = await window.api.conversationsRemoveMany(ids)
    for (const id of removed) composerDraftsRef.current.delete(id)
    oublierBrouillons(removed)
    if (activeId && removed.includes(activeId)) newConv()
    setBulkDeleteAsking(false)
    quitterModeSelection()
    await refreshConvs()
  } catch (error) {
    setBulkDeleteError(error instanceof Error ? error.message : String(error))
  }
}

export function requestDeleteRun(ctx: GestesListeCtx, run: RunEntry): void {
  const { activeId, setDeleteRunCandidate, setRunDeleteError } = ctx
  // Portée toujours « conv » : on ne supprime que dans la conversation affichée.
  if (!activeId) return
  setRunDeleteError(null)
  setDeleteRunCandidate({ run, scope: 'conv', conversationId: activeId })
}

export async function confirmDeleteRun(ctx: GestesListeCtx): Promise<void> {
  const {
    deleteRunCandidate,
    openRun,
    refreshRuns,
    runDeletePending,
    setDeleteRunCandidate,
    setOpenRun,
    setOpenTrace,
    setRunDeleteError,
    setRunDeletePending
  } = ctx
  const candidate = deleteRunCandidate
  if (!candidate || runDeletePending) return
  setRunDeletePending(true)
  setRunDeleteError(null)
  try {
    if (candidate.scope === 'tous') {
      await window.api.deleteRun(candidate.run.path)
    } else if (candidate.conversationId) {
      await window.api.deleteConversationRun(candidate.conversationId, candidate.run.path)
    } else {
      throw new Error(texteFil('run.conversationIntrouvable'))
    }
    if (openRun?.path === candidate.run.path) {
      setOpenRun(null)
      setOpenTrace(null)
    }
    setDeleteRunCandidate(null)
    await refreshRuns()
  } catch (error) {
    setRunDeleteError(error instanceof Error ? error.message : String(error))
  } finally {
    setRunDeletePending(false)
  }
}

export function beginConversationsResize(
  ctx: GestesListeCtx,
  event: React.PointerEvent<HTMLDivElement>
): void {
  const { conversationsPaneWidth, setConversationsPaneWidth } = ctx
  event.preventDefault()
  const startX = event.clientX
  const startWidth = conversationsPaneWidth
  let latestWidth = startWidth
  const onMove = (move: PointerEvent): void => {
    latestWidth = clampConversationPaneWidth(startWidth + move.clientX - startX)
    setConversationsPaneWidth(latestWidth)
  }
  const onUp = (): void => {
    window.localStorage.setItem('autowin.chat.conversationsPaneWidth', String(latestWidth))
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
