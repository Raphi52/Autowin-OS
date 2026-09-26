// fix-ok: mesure en reel (instance cachee, Write du modele Claude) — le modele rend un chemin ABSOLU du dossier du tour ; la trace doit le normaliser en relatif au workspace avant empreinte, sinon le fichier n est pas rattache a la conversation.
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import { ensureAutowinAppData } from '../app-data'
import {
  appendConversationFileTrace,
  normalizeWorkspaceTracePath,
  workspaceTracePathKey,
  type ConversationFileTrace
} from './conversation-file-trace-spool'

type WorkspaceSnapshot = Awaited<ReturnType<typeof captureWorkspaceMutationSnapshot>>

/**
 * TRACE COMMUNE d'une mutation de fichier faite par l'agent du chat (create/move/delete_file,
 * Edit/Write natifs). Avant ce point, seule `edit_file` écrivait dans le journal des fichiers : tout
 * le reste était invisible dans l'onglet Fichiers, qui ne montre qu'un fichier TRACÉ par la
 * conversation. On capture l'état git AVANT, on mute, puis on écrit les empreintes d'APRÈS.
 */
export async function captureMutationTraceBase(
  workspaceRoot: string,
  paths: readonly string[]
): Promise<WorkspaceSnapshot | undefined> {
  try {
    return await captureWorkspaceMutationSnapshot(workspaceRoot, paths)
  } catch {
    return undefined
  }
}

export async function appendWorkspaceMutationTrace(
  input: {
    conversationId?: string
    turnId?: string
    workspaceRoot: string
    source: ConversationFileTrace['source']
    paths: readonly string[]
    before?: WorkspaceSnapshot
    pathLineFingerprints?: Record<string, string[]>
    eventId?: string
  },
  base = ensureAutowinAppData()
): Promise<'appended' | 'duplicate' | 'ignored' | 'failed'> {
  if (!input.conversationId || !input.workspaceRoot.trim()) return 'ignored'
  try {
    const paths = [
      ...new Set(
        input.paths
          .map((path) => normalizeWorkspaceTracePath(path, input.workspaceRoot))
          .filter((path): path is string => Boolean(path))
      )
    ]
    if (paths.length === 0) return 'ignored'
    const after = await captureWorkspaceMutationSnapshot(input.workspaceRoot, paths)
    // Même clé que `paths` : le CLI Claude rend ces empreintes sous le chemin ABSOLU (mesuré en
    // instance réelle le 2026-09-23), clé qu'aucun lecteur du journal ne retrouvait.
    const pathLineFingerprints = input.pathLineFingerprints
      ? Object.fromEntries(
          Object.entries(input.pathLineFingerprints).flatMap(([path, lines]) => {
            const key = normalizeWorkspaceTracePath(path, input.workspaceRoot)
            return key ? [[key, lines] as const] : []
          })
        )
      : undefined
    const find = <T>(entries: Iterable<[string, T]>, path: string): T | undefined =>
      [...entries].find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
      )?.[1]
    const pathFingerprints: Record<string, string> = {}
    const pathBaseFingerprints: Record<string, string | null> = {}
    const pathGenerationMarkers: Record<string, string> = {}
    const pathBaseGenerationMarkers: Record<string, string | null> = {}
    for (const path of paths) {
      const fingerprint = find(after, path)
      if (fingerprint) pathFingerprints[path] = fingerprint
      pathBaseFingerprints[path] = input.before ? (find(input.before, path) ?? null) : null
      pathGenerationMarkers[path] = await captureWorkspacePathGenerationMarker(
        input.workspaceRoot,
        path
      )
      pathBaseGenerationMarkers[path] = input.before
        ? (find(input.before.generationMarkers, path) ?? null)
        : null
    }
    return appendConversationFileTrace(
      {
        ...(input.eventId ? { eventId: input.eventId } : {}),
        timestamp: new Date().toISOString(),
        conversationId: input.conversationId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        workspaceRoot: input.workspaceRoot,
        source: input.source,
        paths,
        ...(Object.keys(pathFingerprints).length ? { pathFingerprints } : {}),
        pathBaseFingerprints,
        pathGenerationMarkers,
        pathBaseGenerationMarkers,
        ...(pathLineFingerprints && Object.keys(pathLineFingerprints).length
          ? { pathLineFingerprints }
          : {})
      },
      base
    )
  } catch {
    // L'observabilité ne doit jamais interrompre la mutation qu'elle décrit.
    return 'failed'
  }
}
