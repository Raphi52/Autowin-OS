import { useEffect, useState } from 'react'
import type { SemanticTemporalProjectionV1 } from '../../../main/knowledge/semantic-temporal-projection'

/**
 * Chargement des sources INDEPENDANTES d'Observatory : sessions d'activite, activite de la
 * conversation, traces natives.
 *
 * Extrait d'`ObservatoryView.tsx` le 2026-08-07. Ces trois recuperations n'ont aucun lien entre
 * elles ni avec le rendu : elles vivaient dans le composant uniquement parce que leur etat y etait
 * declare. Les sortir rend visible ce que la vue va CHERCHER, et separement de ce qu'elle AFFICHE.
 *
 * Chaque effet porte son propre garde `disposed` : sans lui, une reponse arrivant apres un changement
 * de conversation ecraserait l'etat de la conversation SUIVANTE — la donnee affichee ne
 * correspondrait plus a la conversation selectionnee.
 */

export interface ConversationActivity {
  ts: string
  kind: string
  label: string
  text?: string
}

export interface ActivitySessionMeta {
  id: string
  project: string
  path: string
  sizeMb: number
  mtime: number
}

export function useObservatorySources<TNativeTrace>({
  active,
  conversationId,
  refreshKey,
  semanticRetryKey,
  onSourceError
}: {
  active: boolean
  conversationId: string
  refreshKey: number
  semanticRetryKey: number
  /** Signale l'echec d'une source SANS la confondre avec un resultat vide. */
  onSourceError: (source: string, message?: string) => void
}): {
  activitySessions: ActivitySessionMeta[]
  conversationActivity: ConversationActivity[]
  nativeTraces: TNativeTrace[]
  semanticTimeline: SemanticTemporalProjectionV1 | null
} {
  const [activitySessions, setActivitySessions] = useState<ActivitySessionMeta[]>([])
  const [conversationActivity, setConversationActivity] = useState<ConversationActivity[]>([])
  const [nativeTraces, setNativeTraces] = useState<TNativeTrace[]>([])
  const [semanticTimeline, setSemanticTimeline] = useState<SemanticTemporalProjectionV1 | null>(
    null
  )

  useEffect(() => {
    if (!active) return
    let disposed = false
    void (window.api.activitySessions?.() ?? Promise.resolve([]))
      .then((sessions) => {
        if (!disposed) {
          setActivitySessions((sessions ?? []) as ActivitySessionMeta[])
          onSourceError('activitySessions')
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setActivitySessions([])
          onSourceError('activitySessions', error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      disposed = true
    }
  }, [active, refreshKey, onSourceError])

  useEffect(() => {
    if (!active) return
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setConversationActivity([])
    })
    if (!conversationId) {
      queueMicrotask(() => {
        if (disposed) return
        setConversationActivity([])
        onSourceError('conversationActivity')
      })
      return () => {
        disposed = true
      }
    }
    void (window.api.conversationActivity?.(conversationId) ?? Promise.resolve([]))
      .then((entries) => {
        if (!disposed) {
          setConversationActivity(entries as ConversationActivity[])
          onSourceError('conversationActivity')
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setConversationActivity([])
          onSourceError(
            'conversationActivity',
            error instanceof Error ? error.message : String(error)
          )
        }
      })
    return () => {
      disposed = true
    }
  }, [active, conversationId, refreshKey, onSourceError])

  useEffect(() => {
    if (!active) return
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setSemanticTimeline(null)
    })
    if (!conversationId) {
      queueMicrotask(() => {
        if (!disposed) onSourceError('semanticTimeline')
      })
      return () => {
        disposed = true
      }
    }
    void (window.api.semanticTimeline?.(conversationId) ?? Promise.resolve(null))
      .then((projection) => {
        if (!disposed) {
          setSemanticTimeline(projection)
          onSourceError('semanticTimeline')
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSemanticTimeline(null)
          onSourceError('semanticTimeline', error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      disposed = true
    }
  }, [active, conversationId, semanticRetryKey, onSourceError])

  useEffect(() => {
    if (!active) return
    let disposed = false
    void window.api
      .authorizeDiagnostics()
      .then((capability) =>
        capability ? window.api.promptTracesGlobal(capability) : Promise.resolve([])
      )
      .then((traces) => {
        if (!disposed) {
          setNativeTraces(traces as TNativeTrace[])
          onSourceError('nativeDetails')
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setNativeTraces([])
          onSourceError('nativeDetails', error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      disposed = true
    }
  }, [active, refreshKey, onSourceError])

  return { activitySessions, conversationActivity, nativeTraces, semanticTimeline }
}
