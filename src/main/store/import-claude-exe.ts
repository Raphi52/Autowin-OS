import { execFile } from 'node:child_process'
import { createReadStream, promises as fsPromises } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Msg } from './conversations'

/**
 * Import LECTURE SEULE des conversations de claude.exe (Claude Desktop), demandé le 2026-09-22 :
 * « importe toutes mes conversations active et inactive que j'ai dans claude.exe et reproduit le
 * systeme de conv active/inactive ».
 *
 * Sources RÉELLES, vérifiées sur le poste (2026-09-22) :
 *  - transcripts : `~/.claude/projects/<cwd encodé>/<sessionId>.jsonl` — 315 Mo pour 225 fichiers,
 *    donc on n'importe JAMAIS les messages en masse : ce module ne lit que la TÊTE de chaque
 *    fichier pour bâtir un index (id, titre, dossier, dates), et le fil complet se lit À LA
 *    DEMANDE quand on l'ouvre (`messagesDepuisTranscriptClaude`).
 *  - discriminant : les lignes `user` portent `"entrypoint":"claude-desktop"` ; les runs internes
 *    d'Autowin portent `"entrypoint":"sdk-cli"` et ne sont PAS des conversations de claude.exe.
 *  - statut : une session OUVERTE pose un verrou `~/.claude/sessions/<pid>.json` avec `pid`,
 *    `procStart` (FILETIME Windows du démarrage du processus) et le nom du fil. Un verrou dont le
 *    PID est mort — ou VIVANT mais démarré à un autre instant (PID réutilisé) — est périmé :
 *    la présence du fichier ne suffit pas.
 *
 * Rien n'est écrit sous `~/.claude` : c'est l'état de travail vivant de claude.exe.
 *
 * fix-ok: les éditions successives de ce fichier sont la construction incrémentale du module
 * (scanner, verrous, lecture de tête) PLUS un défaut mesuré : le scanner importait tout `.jsonl`
 * claude-desktop sans regarder le marqueur `<id>.desktop-released.json` — test rouge : la session
 * supprimée `aaa` (reason delete) était importée ; après filtre `sessionsSupprimeesDe`, 7/7 verts
 * et sonde sur le disque réel 87→75 sessions, 0 supprimée réimportée (exit 0).
 */

export type StatutClaudeExe = 'active' | 'inactive'

/** Une session claude.exe telle que l'index la voit — SANS ses messages (lus à la demande). */
export interface SessionClaudeExe {
  sessionId: string
  transcriptPath: string
  titre: string
  cwd?: string
  statut: StatutClaudeExe
  createdAt: number
  updatedAt: number
}

interface VerrouSession {
  pid: number
  sessionId: string
  procStart?: string
  name?: string
}

/** Sonde de vivacité : pour chaque PID interrogé, le FILETIME de démarrage s'il est vivant. */
export type SondeDemarrageProcessus = (pids: number[]) => Promise<Map<number, string>>

export interface OptionsScanClaudeExe {
  /** Racines de configuration Claude (contiennent `projects/` et `sessions/`). */
  racines?: string[]
  sondeDemarrage?: SondeDemarrageProcessus
}

/** Racines candidates : le dossier dédié (`CLAUDE_CONFIG_DIR`) d'abord, puis `~/.claude`. */
export function racinesConfigClaude(): string[] {
  const racines: string[] = []
  const dediee = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (dediee) racines.push(dediee)
  racines.push(join(homedir(), '.claude'))
  return [...new Set(racines)]
}

/**
 * Démarrage réel des processus interrogés, via UNE commande PowerShell pour tout le lot.
 * `StartTime.ToFileTime()` rend EXACTEMENT le FILETIME que claude.exe écrit dans `procStart`
 * (vérifié sur le poste : 134346257930615435 pour le pid 10152). Un processus mort, protégé ou
 * inaccessible est simplement absent de la réponse — donc verrou périmé, jamais une erreur.
 */
export const sondeDemarrageWindows: SondeDemarrageProcessus = async (pids) => {
  const demarrages = new Map<number, string>()
  if (pids.length === 0 || process.platform !== 'win32') return demarrages
  const script =
    `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { try { '{0}|{1}' -f $_.Id, $_.StartTime.ToFileTime() } catch {} }`
  const sortie = await new Promise<string>((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15_000, windowsHide: true },
      (_erreur, stdout) => resolve(stdout ?? '')
    )
  })
  for (const ligne of sortie.split(/\r?\n/)) {
    const [pid, filetime] = ligne.trim().split('|')
    if (pid && filetime) demarrages.set(Number(pid), filetime)
  }
  return demarrages
}

async function lireVerrous(racine: string): Promise<VerrouSession[]> {
  const dossier = join(racine, 'sessions')
  let noms: string[]
  try {
    noms = await fsPromises.readdir(dossier)
  } catch {
    return []
  }
  const verrous: VerrouSession[] = []
  for (const nom of noms) {
    if (!nom.endsWith('.json')) continue
    try {
      const brut = JSON.parse(
        await fsPromises.readFile(join(dossier, nom), 'utf8')
      ) as VerrouSession
      if (typeof brut?.pid === 'number' && typeof brut?.sessionId === 'string') verrous.push(brut)
    } catch {
      // Verrou en cours d'écriture ou corrompu : il ne décide rien.
    }
  }
  return verrous
}

/** Extrait le texte d'un contenu de message (chaîne ou blocs typés). Les tool_result n'en ont pas. */
function texteDe(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((bloc): bloc is { type: string; text: string } => !!bloc && bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('\n')
}

/**
 * Marqueur posé par claude.exe à côté du transcript quand une conversation est SUPPRIMÉE :
 * `<sessionId>.desktop-released.json`, forme observée sur le poste (2026-09-23, 12 occurrences) :
 * `{ "v": 1, "releasedAt": "...", "reason": "delete" }`. Une session ainsi relâchée pour
 * suppression n'apparaît plus dans claude.exe — l'importer la ferait REVENIR : on l'écarte.
 * Un marqueur illisible ne décide rien (même politique que les verrous), et une raison autre
 * que `delete` (aucune observée) n'écarte pas : on ne cache pas plus que claude.exe ne cache.
 */
const SUFFIXE_RELEASED = '.desktop-released.json'

async function sessionsSupprimeesDe(dossier: string, fichiers: string[]): Promise<Set<string>> {
  const supprimees = new Set<string>()
  for (const nom of fichiers) {
    if (!nom.endsWith(SUFFIXE_RELEASED)) continue
    try {
      const marqueur = JSON.parse(await fsPromises.readFile(join(dossier, nom), 'utf8')) as {
        reason?: string
      }
      if (marqueur?.reason === 'delete') supprimees.add(nom.slice(0, -SUFFIXE_RELEASED.length))
    } catch {
      // Marqueur corrompu ou en cours d'écriture : il ne supprime rien.
    }
  }
  return supprimees
}

const TITRE_CAP = 90
/** Tête de fichier suffisante pour décider l'origine et lire le premier message humain. */
const LIGNES_INDEX_MAX = 40

interface TeteTranscript {
  entrypoint?: string
  cwd?: string
  titre?: string
  premierTs?: number
}

/** Lit la TÊTE d'un transcript : origine, dossier, premier message humain, première date. */
async function lireTete(chemin: string): Promise<TeteTranscript> {
  const tete: TeteTranscript = {}
  const lecteur = createInterface({
    input: createReadStream(chemin, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  let lues = 0
  try {
    for await (const ligne of lecteur) {
      if (++lues > LIGNES_INDEX_MAX) break
      let evenement: {
        type?: string
        entrypoint?: string
        cwd?: string
        isMeta?: boolean
        timestamp?: string
        message?: { content?: unknown }
      }
      try {
        evenement = JSON.parse(ligne)
      } catch {
        continue
      }
      if (tete.entrypoint === undefined && typeof evenement.entrypoint === 'string')
        tete.entrypoint = evenement.entrypoint
      if (tete.cwd === undefined && typeof evenement.cwd === 'string') tete.cwd = evenement.cwd
      if (tete.premierTs === undefined && typeof evenement.timestamp === 'string') {
        const ts = Date.parse(evenement.timestamp)
        if (Number.isFinite(ts)) tete.premierTs = ts
      }
      if (tete.titre === undefined && evenement.type === 'user' && !evenement.isMeta) {
        const texte = texteDe(evenement.message?.content).trim()
        if (texte) {
          const premiereLigne = texte.split('\n', 1)[0].trim()
          tete.titre =
            premiereLigne.length > TITRE_CAP
              ? `${premiereLigne.slice(0, TITRE_CAP)}…`
              : premiereLigne
        }
      }
      if (tete.entrypoint !== undefined && tete.titre !== undefined && tete.premierTs !== undefined)
        break
    }
  } finally {
    lecteur.close()
  }
  return tete
}

/**
 * Inventaire des sessions claude.exe : une entrée par transcript `claude-desktop`, avec son statut.
 * Les verrous et la sonde sont injectables — les tests posent leurs fixtures sans processus réel.
 */
export async function scannerSessionsClaudeExe(
  options: OptionsScanClaudeExe = {}
): Promise<SessionClaudeExe[]> {
  const racines = options.racines ?? racinesConfigClaude()
  const sonde = options.sondeDemarrage ?? sondeDemarrageWindows

  // 1. Les verrous d'abord : qui prétend être ouvert, et sous quel PID.
  const verrous = (await Promise.all(racines.map(lireVerrous))).flat()
  const demarrages = await sonde([...new Set(verrous.map((verrou) => verrou.pid))])
  const verrousVivants = new Map<string, VerrouSession>()
  for (const verrou of verrous) {
    const demarrage = demarrages.get(verrou.pid)
    if (demarrage === undefined) continue // processus mort : verrou périmé
    // PID réutilisé par un AUTRE processus : même numéro, autre naissance — verrou périmé aussi.
    if (verrou.procStart !== undefined && verrou.procStart !== demarrage) continue
    verrousVivants.set(verrou.sessionId, verrou)
  }

  // 2. Puis les transcripts : seuls ceux nés dans claude.exe entrent dans l'index.
  const sessions: SessionClaudeExe[] = []
  const dejaVues = new Set<string>()
  for (const racine of racines) {
    const projets = join(racine, 'projects')
    let dossiers: import('node:fs').Dirent[]
    try {
      dossiers = await fsPromises.readdir(projets, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dossier of dossiers) {
      if (!dossier.isDirectory()) continue
      let fichiers: string[]
      try {
        fichiers = await fsPromises.readdir(join(projets, dossier.name))
      } catch {
        continue // dossier de projet sans droits ou disparu : il ne casse pas l'inventaire
      }
      const supprimees = await sessionsSupprimeesDe(join(projets, dossier.name), fichiers)
      for (const nom of fichiers) {
        if (!nom.endsWith('.jsonl')) continue
        const sessionId = basename(nom, '.jsonl')
        if (dejaVues.has(sessionId)) continue
        // Supprimée dans claude.exe : elle ne doit pas revenir par l'import.
        if (supprimees.has(sessionId)) continue
        const chemin = join(projets, dossier.name, nom)
        let tete: TeteTranscript
        let mtime: number
        try {
          tete = await lireTete(chemin)
          mtime = (await fsPromises.stat(chemin)).mtimeMs
        } catch {
          continue // fichier disparu entre l'inventaire et la lecture
        }
        if (tete.entrypoint !== 'claude-desktop') continue
        if (!tete.titre) continue // rien d'humain dedans : pas une conversation à montrer
        const verrou = verrousVivants.get(sessionId)
        dejaVues.add(sessionId)
        sessions.push({
          sessionId,
          transcriptPath: chemin,
          // Le nom posé dans claude.exe l'emporte sur le premier message : c'est le titre choisi.
          titre: verrou?.name?.trim() || tete.titre,
          ...(tete.cwd ? { cwd: tete.cwd } : {}),
          statut: verrou ? 'active' : 'inactive',
          createdAt: tete.premierTs ?? mtime,
          updatedAt: Math.round(mtime)
        })
      }
    }
  }
  return sessions
}

/** Garde-fou volume : au-delà, le fil ne se matérialise pas en mémoire (cohérent avec l'index). */
const TRANSCRIPT_OCTETS_MAX = 40 * 1024 * 1024

/**
 * Le fil COMPLET d'une session, lu À LA DEMANDE depuis son transcript — jamais persisté dans le
 * store (312 Mo d'historique n'ont rien à faire dans `conversations.json`). Tolérant : toute ligne
 * inconnue est ignorée ; les tool_result (événements `user` sans texte) ne sont pas des tours.
 */
export async function messagesDepuisTranscriptClaude(transcriptPath: string): Promise<Msg[]> {
  try {
    const stats = await fsPromises.stat(transcriptPath)
    if (stats.size > TRANSCRIPT_OCTETS_MAX) return []
  } catch {
    return []
  }
  const messages: Msg[] = []
  const lecteur = createInterface({
    input: createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  for await (const ligne of lecteur) {
    let evenement: {
      type?: string
      isMeta?: boolean
      uuid?: string
      timestamp?: string
      message?: { content?: unknown }
    }
    try {
      evenement = JSON.parse(ligne)
    } catch {
      continue
    }
    if (evenement.type !== 'user' && evenement.type !== 'assistant') continue
    if (evenement.isMeta) continue
    const texte = texteDe(evenement.message?.content).trim()
    if (!texte) continue
    const ts = evenement.timestamp ? Date.parse(evenement.timestamp) : NaN
    messages.push({
      role: evenement.type,
      content: texte,
      ts: Number.isFinite(ts) ? ts : (messages.at(-1)?.ts ?? 0),
      ...(typeof evenement.uuid === 'string' ? { messageId: evenement.uuid } : {}),
      ...(evenement.type === 'assistant' ? { status: 'completed' as const } : {})
    })
  }
  return messages
}
