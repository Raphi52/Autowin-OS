import {
  isRunRequestCurrent,
  CHAT_PANE_LIMITS,
  type RunRequestIdentity,
  type OrchStep,
  type ScopedLiveRun
} from './chat-view-model'
import { traceSilentFailure } from './chat-view-outils'
import { reclamerFicheAOuvrir, runDeLaFiche } from './fiches-du-fil'
import type { RunEntry } from './chat-view-types'
import type { FicheDeDemande } from '../../../shared/fiche-de-demande'
import { useState, useRef, useEffect, useCallback } from 'react'
import { pickRunForTrace } from './run-trace-target'
import type { OpenRunState, RunDetailTab } from './WorkflowsPanel'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que le panneau des runs et des fiches du fil lit de ChatView. */
export type PanneauRunsCtx = {
  activeRef: React.RefObject<string | null>
  fichesRequestRef: React.RefObject<number>
  refreshFiches: () => Promise<void>
  refreshRuns: () => Promise<void>
  runsPaneWidth: number
  runsRequestRef: React.RefObject<RunRequestIdentity>
  setFiches: React.Dispatch<React.SetStateAction<FicheDeDemande[]>>
  setOngletPanneau: React.Dispatch<React.SetStateAction<{ tab: 'runs'; jeton: number } | null>>
  setRuns: React.Dispatch<React.SetStateAction<RunEntry[]>>
  setRunsPaneWidth: React.Dispatch<React.SetStateAction<number>>
  setShowRuns: React.Dispatch<React.SetStateAction<boolean>>
  viewRun: (r: RunEntry) => Promise<void>
}

/**
 * Workflows affichés : ceux de la CONVERSATION ACTIVE, et rien d'autre. Le cadrage « tous »
 * a été retiré — cette barre montre le contexte courant, le global relève de l'Observatory.
 */
export async function refreshRuns(ctx: PanneauRunsCtx): Promise<void> {
  const { activeRef, runsRequestRef, setRuns } = ctx
  const request: RunRequestIdentity = {
    id: runsRequestRef.current.id + 1,
    scope: 'conv',
    convId: activeRef.current
  }
  runsRequestRef.current = request
  const nextRuns = request.convId
    ? ((await window.api.conversationRuns(request.convId)) as RunEntry[])
    : []
  const currentRequest = {
    id: runsRequestRef.current.id,
    scope: 'conv' as const,
    convId: activeRef.current
  }
  if (isRunRequestCurrent(request, currentRequest)) setRuns(nextRuns)
}

/**
 * Relit les fiches de demande du fil actif. Un échec de lecture vide la liste au lieu
 * de garder celle d'un autre fil, et ne touche pas aux runs. Une ouverture demandée depuis un
 * post-it du Board (`demanderFicheAOuvrir`) est honorée ici, une fois les fiches de CE fil lues.
 */
export async function refreshFiches(ctx: PanneauRunsCtx): Promise<void> {
  const { activeRef, fichesRequestRef, setFiches, setOngletPanneau, setShowRuns, viewRun } = ctx
  const convId = activeRef.current
  const demande = ++fichesRequestRef.current
  let lues: FicheDeDemande[] = []
  if (convId) {
    try {
      lues = await window.api.fichesDuFil(convId)
    } catch (error) {
      traceSilentFailure('fiches-du-fil', error)
    }
  }
  if (demande !== fichesRequestRef.current || convId !== activeRef.current) return
  setFiches(lues)
  const chemin = convId ? reclamerFicheAOuvrir(convId) : null
  const fiche = chemin ? lues.find((f) => f.chemin === chemin) : undefined
  if (!fiche) return
  setShowRuns(true)
  setOngletPanneau((precedent) => ({ tab: 'runs', jeton: (precedent?.jeton ?? 0) + 1 }))
  void viewRun(runDeLaFiche(fiche))
}

export function rechargerRunsEtFiches(ctx: PanneauRunsCtx): void {
  const { refreshFiches, refreshRuns } = ctx
  void Promise.resolve().then(refreshRuns)
  void Promise.resolve().then(refreshFiches)
}

export function beginRunsResize(
  ctx: PanneauRunsCtx,
  event: React.PointerEvent<HTMLDivElement>
): void {
  const { runsPaneWidth, setRunsPaneWidth } = ctx
  event.preventDefault()
  const startX = event.clientX
  const startWidth = runsPaneWidth
  let latestWidth = startWidth
  const onMove = (move: PointerEvent): void => {
    latestWidth = Math.min(
      CHAT_PANE_LIMITS.workflows.max,
      Math.max(CHAT_PANE_LIMITS.workflows.min, startWidth + startX - move.clientX)
    )
    setRunsPaneWidth(latestWidth)
  }
  const onUp = (): void => {
    window.localStorage.setItem('autowin.chat.runsPaneWidth', String(latestWidth))
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type RunOuvertCtx = {
  runsRef: React.RefObject<RunEntry[]>
  setShowRuns: React.Dispatch<React.SetStateAction<boolean>>
}

/** Le run ouvert dans le panneau Détails, sa trace et les runs en direct. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useRunOuvert(ctx: RunOuvertCtx) {
  const { runsRef, setShowRuns } = ctx
  const [openRun, setOpenRun] = useState<OpenRunState | null>(null)
  // Chemin du run déplié à l'instant présent : une relecture en vol vérifie dessus que
  // l'utilisateur n'a pas replié ou changé de run pendant qu'elle lisait le disque.
  const openRunPathRef = useRef<string | null>(null)
  useEffect(() => {
    openRunPathRef.current = openRun?.path ?? null
  })
  const [openTrace, setOpenTrace] = useState<OrchStep[] | null>(null)
  // Détail d'un run : bascule entre le fil des sous-agents (trace) et le RUN.md brut.
  const [runDetailTab, setRunDetailTab] = useState<RunDetailTab>('trace')
  const [liveRuns, setLiveRuns] = useState<Record<string, ScopedLiveRun<OrchStep>>>({})
  // Carte de l'orchestration EN COURS dans le panneau Workflows : cible du clic sur
  // l'indicateur « action en cours » d'un message (ouvre le panneau + cadre le run/step actif).
  const liveRunCardRef = useRef<HTMLDivElement>(null)
  /** Onglet a imposer au panneau droit (voir `revealLiveAction`). */
  const [ongletPanneau, setOngletPanneau] = useState<{ tab: 'runs'; jeton: number } | null>(null)
  /** `viewRun` vient de `useRepriseDesTours`, appele plus bas : le clic le lit par sa ref. */
  const viewRunRef = useRef<((run: RunEntry) => Promise<void>) | null>(null)
  // Clic sur le bloc d'activité d'un message → Workflows, à l'endroit qui montre RÉELLEMENT ce qui
  // s'est passé : la section Sous-agents pour le fil du run, l'onglet Activité (historique) quand on
  // veut la trace d'un run précis (elle survit au redémarrage, l'écho de session non).
  const revealLiveAction = useCallback(
    (mode: 'live' | 'history' = 'live', runId?: string) => {
      setShowRuns(true)
      // Le fil des sous-agents et les RUN.md vivent tous deux dans l'onglet Runs : ouvrir le panneau
      // sur le graphe laisserait l'utilisateur a un clic de ce qu'il vient justement de demander.
      setOngletPanneau((precedent) => ({ tab: 'runs', jeton: (precedent?.jeton ?? 0) + 1 }))
      if (mode === 'history') {
        // Action déjà terminée/interrompue : sa carte live n'existe plus. On OUVRE LA TRACE du run
        // concerné — cadrer la seule liste laissait l'utilisateur chercher lequel regarder.
        // `pickRunForTrace` dégrade proprement : chemin portant le runId → sinon le plus récent →
        // sinon rien, et dans ce dernier cas on retombe sur le cadrage d'origine (aucune régression).
        const target = pickRunForTrace(runsRef.current, runId)
        if (target) void viewRunRef.current?.(target)
        return
      }
      requestAnimationFrame(() =>
        liveRunCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      )
      // `setShowRuns` est stable (setter de useState) : le nommer ne recrée jamais ce rappel. Sans
      // lui, le compilateur React, qui le déduit comme dépendance, renonce à optimiser le composant.
    },
    // `runsRef` vient de `useRef` (ChatView.tsx) : stable, il ne change pas le rappel.
    [runsRef, setShowRuns]
  )
  return {
    openRun,
    setOpenRun,
    openRunPathRef,
    openTrace,
    setOpenTrace,
    runDetailTab,
    setRunDetailTab,
    liveRuns,
    setLiveRuns,
    liveRunCardRef,
    ongletPanneau,
    setOngletPanneau,
    viewRunRef,
    revealLiveAction
  }
}
