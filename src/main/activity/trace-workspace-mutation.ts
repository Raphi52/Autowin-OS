// fix-ok: mesure en reel (instance cachee, Write du modele Claude) — le modele rend un chemin ABSOLU du dossier du tour ; la trace doit le normaliser en relatif au workspace avant empreinte, sinon le fichier n est pas rattache a la conversation.
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import type { ExecutionEvidence } from '../providers/types'
import { ensureAutowinAppData } from '../app-data'
import { cheminsEcritsParCommande } from './chemins-ecrits-par-commande'
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

function cheminsDeTrace(paths: readonly string[], workspaceRoot: string): string[] {
  return [
    ...new Set(
      paths
        .map((path) => normalizeWorkspaceTracePath(path, workspaceRoot))
        .filter((path): path is string => Boolean(path))
    )
  ]
}

export async function appendWorkspaceMutationTrace(
  input: {
    conversationId?: string
    turnId?: string
    workspaceRoot: string
    source: ConversationFileTrace['source']
    paths: readonly string[]
    before?: WorkspaceSnapshot
    /** Photo déjà prise APRÈS la mutation et couvrant `paths` : rien n'est relu. */
    after?: WorkspaceSnapshot
    pathLineFingerprints?: Record<string, string[]>
    /** Chemins nommés par une commande shell d'écriture du fil (voir `ConversationFileTrace`). */
    nommeParCommande?: boolean
    eventId?: string
  },
  base = ensureAutowinAppData()
): Promise<'appended' | 'duplicate' | 'ignored' | 'failed'> {
  if (!input.conversationId || !input.workspaceRoot.trim()) return 'ignored'
  try {
    const paths = cheminsDeTrace(input.paths, input.workspaceRoot)
    if (paths.length === 0) return 'ignored'
    const after =
      input.after ?? (await captureWorkspaceMutationSnapshot(input.workspaceRoot, paths))
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
          : {}),
        ...(input.nommeParCommande ? { nommeParCommande: true } : {})
      },
      base
    )
  } catch {
    // L'observabilité ne doit jamais interrompre la mutation qu'elle décrit.
    return 'failed'
  }
}

type EcritureDeLAppel = {
  workspaceRoot: string
  paths: readonly string[]
  pathLineFingerprints?: Record<string, string[]>
  nommeParCommande?: boolean
}

/**
 * ÉCRITURES EN LIGNE DE COMMANDE DU FIL. Une commande shell réussie qui NOMME un fichier en écriture
 * (`prettier --write x`, `cat >> x <<EOF`, `sed -i … x`) est tracée au nom du fil avec
 * `nommeParCommande` : sans cela, le journal ne connaissait ce fichier que par la comparaison
 * avant/après, que TOUS les fils en cours écrivent aussi, et le commit automatique ne savait plus
 * qui l'avait écrit (d7af3730 et dd0c3d6a, 2026-10-13). Une commande en échec n'est pas tracée.
 *
 * ÉDITIONS DU MODÈLE. Les Edit/Write natifs n'étaient jamais écrits au journal, donc l'onglet
 * Fichiers restait vide pour un tour de chat direct. Une édition échouée (`ok: false`) n'est pas
 * tracée.
 */
function ecrituresDeLAppel(
  evidence: readonly ExecutionEvidence[],
  workspaceRoot: string
): EcritureDeLAppel[] {
  const ecritures: EcritureDeLAppel[] = []
  for (const item of evidence) {
    if (!item.ok || !item.command?.trim()) continue
    const dossier = item.workspaceRoot ?? workspaceRoot
    const paths = cheminsEcritsParCommande(item.command, dossier)
    if (paths.length > 0) ecritures.push({ workspaceRoot: dossier, paths, nommeParCommande: true })
  }
  for (const item of evidence) {
    if (!item.ok || item.kind !== 'mutation') continue
    const paths = item.path ? [item.path] : (item.paths ?? [])
    if (paths.length === 0) continue
    const lignes = item.writtenLineFingerprints
    ecritures.push({
      workspaceRoot: item.workspaceRoot ?? workspaceRoot,
      paths,
      ...(lignes?.length && paths.length === 1
        ? { pathLineFingerprints: { [paths[0] as string]: lignes } }
        : {})
    })
  }
  return ecritures
}

/**
 * Une photo par dossier de travail, couvrant tous les chemins écrits de ce dossier. Un dossier dont
 * aucun chemin n'est traçable n'en reçoit pas : `appendWorkspaceMutationTrace` l'ignorera.
 */
async function photosDesEcritures(
  ecritures: readonly EcritureDeLAppel[]
): Promise<Map<string, WorkspaceSnapshot | undefined>> {
  const cheminsParDossier = new Map<string, string[]>()
  for (const { workspaceRoot, paths } of ecritures) {
    const chemins = cheminsParDossier.get(workspaceRoot) ?? []
    chemins.push(...paths)
    cheminsParDossier.set(workspaceRoot, chemins)
  }
  const photos = await Promise.all(
    [...cheminsParDossier].map(async ([dossier, paths]) => {
      const chemins = cheminsDeTrace(paths, dossier)
      if (chemins.length === 0) return [dossier, undefined] as const
      return [dossier, await captureMutationTraceBase(dossier, chemins)] as const
    })
  )
  return new Map(photos)
}

/**
 * LE SPINNER D'UN LOT TOURNAIT ENCORE APRÈS SA RÉPONSE (conv-1379, 2026-10-31).
 *
 * Trace tout ce qu'un appel au modèle vient d'écrire, et rend les chemins des éditions du modèle.
 * Le tour ne s'arrête qu'une fois ces traces écrites (le commit automatique les relit), et chaque
 * écriture reprenait sa propre photo du dépôt : 887 ms sur D:/AutoWinOS et ses 206 fichiers modifiés,
 * soit 70 s pour les 76 écritures de Lot 1/3 et 81 s pour les 164 de Lot 3/3, spinner allumé. Or
 * toutes arrivent ici APRÈS la fin de l'appel et photographiaient donc le même état : une seule
 * photo par dossier suffit, sans changer une trace.
 */
export async function appendCallMutationTraces(
  input: {
    conversationId?: string
    turnId?: string
    workspaceRoot: string
    evidence: readonly ExecutionEvidence[]
  },
  base = ensureAutowinAppData()
): Promise<Set<string>> {
  const ecritures = ecrituresDeLAppel(input.evidence, input.workspaceRoot)
  const editionsTracees = new Set<string>()
  const photos = input.conversationId
    ? await photosDesEcritures(ecritures)
    : new Map<string, WorkspaceSnapshot | undefined>()
  for (const { workspaceRoot, paths, pathLineFingerprints, nommeParCommande } of ecritures) {
    if (!nommeParCommande) {
      for (const path of paths) editionsTracees.add(path.replaceAll('\\', '/').toLowerCase())
    }
    const after = photos.get(workspaceRoot)
    await appendWorkspaceMutationTrace(
      {
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.turnId ? { turnId: input.turnId } : {}),
        workspaceRoot,
        source: 'chat_tool',
        paths,
        ...(after ? { after } : {}),
        ...(pathLineFingerprints ? { pathLineFingerprints } : {}),
        ...(nommeParCommande ? { nommeParCommande } : {})
      },
      base
    )
  }
  return editionsTracees
}
