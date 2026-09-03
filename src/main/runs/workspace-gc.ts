import { closeSync, openSync, readSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ramasse-miettes DATÉ des workspaces de runs de conversation
 * (`<racine>/<convId>/<slug>-workspace/`).
 *
 * Pourquoi. Rien ne supprimait jamais un workspace de run. Le seul entretien existant
 * (`reconcileAbandonedConvRuns`) REPEINT `open` en `red` : il augmente la population de bloqués,
 * il n'en retire aucun. Mesuré le 2026-08-18 sur la racine dev : 11 784 `RUN.md`, dont
 * 9 341 `green` — et l'énumération seule coûte 806 ms, la lecture de leur première ligne 14,8 s
 * à froid.
 *
 * OÙ EST LA MASSE, et pourquoi la règle n'est pas centrée sur les bloqués : 9 341 verts contre
 * 2 442 non clos. Une politique qui ne viserait que les runs en échec ne bornerait tout
 * simplement pas cet arbre. Ce sont les runs CLOS et ANCIENS qu'il faut jeter.
 *
 * CE QU'ON NE SUPPRIME JAMAIS :
 *  - un run NON CLOS, quel que soit son âge — la trace d'un échec doit rester lisible ;
 *  - un run de moins de `maxAgeMs` (7 j par défaut) ;
 *  - les `maxPerConversation` (50) plus récents de CHAQUE conversation, même clos et anciens —
 *    le plafond est PAR CONVERSATION et non global : un plafond global effacerait l'historique
 *    d'une conversation dormante simplement parce qu'on travaille ailleurs ;
 *  - un run dont le `runId` figure dans les orchestrations REPRENABLES — supprimer son workspace
 *    condamnerait une reprise en vol ;
 *  - un run touché depuis moins de `assumeDeadMs` (6 h) : garde de vivacité reprise telle quelle
 *    de `journal-gc.ts`, pour la raison qui y est écrite — `mtime` ne distingue pas un run fini
 *    d'un run qui réfléchit.
 *
 * On supprime le DOSSIER, pas le seul `RUN.md` : un run porte un sidecar `trace.json`
 * (`conv-runs.ts:337`) qui resterait orphelin.
 *
 * Le PLAN est PUR (entrées → chemins à supprimer) : testable sans toucher au disque, exactement
 * comme `planJournalGc`. `collectRunWorkspaces` ne fait que l'appliquer, et journalise.
 */

/** Statuts qui CONCLUENT un run. Tout le reste est « non clos » et donc protégé. */
const STATUTS_CLOS = new Set(['green', 'degraded-closed', 'succeeded'])

export interface WorkspaceEntry {
  /** Dossier du workspace (c'est LUI qui sera supprimé, sidecars compris). */
  path: string
  convId: string
  /** Statut lu en tête du RUN.md. Inconnu/illisible → traité comme NON clos. */
  status: string
  modifiedMs: number
}

export interface WorkspaceGcPolicy {
  /** Instant de référence (injecté → test déterministe). */
  nowMs: number
  /** En deçà de cet âge, un run clos est gardé. */
  maxAgeMs?: number
  /** Nombre de runs gardés par conversation, même clos et anciens. */
  maxPerConversation?: number
  /** Inactivité en deçà de laquelle le run est présumé VIVANT (garde de `journal-gc`). */
  assumeDeadMs?: number
  /** `runId` des orchestrations reprenables : intouchables, quel que soit l'âge. */
  protectedRunIds?: readonly string[]
  /** Plafond de travail par passe. Le reste est RENVOYÉ, jamais tronqué en silence. */
  maxDeletions?: number
}

/** 7 jours : une semaine de recul suffit à relire un run réussi. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 50 runs par conversation : l'historique récent reste consultable à la main. */
export const DEFAULT_MAX_PER_CONVERSATION = 50
/** 6 h sans écriture — même seuil et même justification que `journal-gc.DEFAULT_ASSUME_DEAD_MS`. */
export const DEFAULT_ASSUME_DEAD_MS = 6 * 60 * 60 * 1000
/** Borne le coût d'une passe de démarrage. */
const DEFAULT_MAX_DELETIONS = 500

export interface WorkspaceGcPlan {
  doomed: string[]
  /** Candidats écartés par `maxDeletions` : à reprendre au prochain démarrage. */
  remaining: number
}

function normaliser(valeur: string): string {
  return valeur.toLocaleLowerCase('en-US')
}

/**
 * Décide quels workspaces supprimer. PUR.
 *
 * Ordre des gardes : vivacité et protection d'abord, plafond ensuite — un run protégé n'est
 * JAMAIS candidat, même ancien, même au-delà du plafond. Le plafond compte les SURVIVANTS
 * (protégés inclus : ils occupent bien une place), comme `planJournalGc`.
 */
export function planWorkspaceGc(
  entries: readonly WorkspaceEntry[],
  policy: WorkspaceGcPolicy
): WorkspaceGcPlan {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxPerConversation = policy.maxPerConversation ?? DEFAULT_MAX_PER_CONVERSATION
  const assumeDeadMs = policy.assumeDeadMs ?? DEFAULT_ASSUME_DEAD_MS
  const maxDeletions = policy.maxDeletions ?? DEFAULT_MAX_DELETIONS
  const proteges = (policy.protectedRunIds ?? []).map(normaliser).filter((id) => id.length > 0)

  const ageDe = (entry: WorkspaceEntry): number => policy.nowMs - entry.modifiedMs

  /**
   * Protection VOLONTAIREMENT LARGE : le `runId` d'une orchestration reprenable n'est pas le nom
   * du dossier, et se tromper de sens coûte un run en vol. On protège dès que l'identifiant
   * apparaît quelque part dans le chemin. Sur-protéger fait garder un dossier de trop ;
   * sous-protéger détruit un travail en cours.
   */
  const estProtege = (entry: WorkspaceEntry): boolean => {
    const chemin = normaliser(entry.path)
    return proteges.some((id) => chemin.includes(id))
  }

  const touchable = (entry: WorkspaceEntry): boolean =>
    STATUTS_CLOS.has(entry.status) && ageDe(entry) >= assumeDeadMs && !estProtege(entry)

  // Les trois gardes sont CUMULATIVES : on ne supprime qu'un run à la fois CLOS, plus vieux que
  // `maxAgeMs`, ET au-delà du plafond de sa conversation. Franchir une seule d'entre elles ne
  // suffit jamais — un vert d'hier au-delà du plafond reste lisible, un vert d'il y a un an sous
  // le plafond aussi.
  const parConv = new Map<string, WorkspaceEntry[]>()
  for (const entry of entries) {
    const liste = parConv.get(entry.convId)
    if (liste) liste.push(entry)
    else parConv.set(entry.convId, [entry])
  }

  const doomed: string[] = []
  for (const conv of parConv.values()) {
    // Le plafond compte TOUS les runs de la conversation (protégés et non clos inclus : ils
    // occupent bien une place), et ne libère que les plus anciens au-delà.
    const horsPlafond = [...conv]
      .sort((a, b) => b.modifiedMs - a.modifiedMs)
      .slice(maxPerConversation)
    for (const entry of horsPlafond) {
      if (touchable(entry) && ageDe(entry) > maxAgeMs) doomed.push(entry.path)
    }
  }

  const tous = doomed
  return { doomed: tous.slice(0, maxDeletions), remaining: Math.max(0, tous.length - maxDeletions) }
}

/** Lit le `status:` en tête d'un RUN.md sans charger le document. */
function lireStatut(runPath: string): string {
  const tampon = Buffer.alloc(96)
  let fd: number | undefined
  try {
    fd = openSync(runPath, 'r')
    const lus = readSync(fd, tampon, 0, tampon.length, 0)
    const tete = tampon.subarray(0, lus).toString('utf8')
    return tete.match(/^\s*status:\s*(\S+)/i)?.[1].toLowerCase() ?? 'unknown'
  } catch {
    return 'unknown' // illisible = non clos = protégé
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Inventorie les workspaces sous la racine des runs de conversation. */
function inventoryRunWorkspaces(root: string): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = []
  let convs: string[]
  try {
    convs = readdirSync(root)
  } catch {
    return entries // racine absente : rien à faire, et surtout rien à casser
  }
  for (const convId of convs) {
    let workspaces: string[]
    try {
      workspaces = readdirSync(join(root, convId))
    } catch {
      continue
    }
    for (const ws of workspaces) {
      if (!ws.endsWith('-workspace')) continue
      const dossier = join(root, convId, ws)
      const runPath = join(dossier, 'RUN.md')
      try {
        entries.push({
          path: dossier,
          convId,
          status: lireStatut(runPath),
          modifiedMs: statSync(runPath).mtimeMs
        })
      } catch {
        /* pas de RUN.md ici : ce n'est pas un workspace de run, on n'y touche pas */
      }
    }
  }
  return entries
}

export interface WorkspaceGcOutcome {
  removed: number
  remaining: number
  /** Chemins réellement supprimés — journalisés par l'appelant. */
  paths: string[]
}

/**
 * Applique le plan au disque. Best-effort assumé : l'échec d'UNE suppression n'interrompt pas la
 * passe. La sûreté vient UNIQUEMENT de `planWorkspaceGc` — un dossier verrouillé par un run vivant
 * n'est pas protégé par l'OS sous Windows (libuv ouvre en FILE_SHARE_DELETE).
 */
export function collectRunWorkspaces(
  root: string,
  policy: Partial<WorkspaceGcPolicy> = {}
): WorkspaceGcOutcome {
  const plan = planWorkspaceGc(inventoryRunWorkspaces(root), { nowMs: Date.now(), ...policy })
  const paths: string[] = []
  for (const dossier of plan.doomed) {
    try {
      rmSync(dossier, { recursive: true, force: true })
      paths.push(dossier)
    } catch {
      /* verrouillé ou déjà parti : la prochaine passe s'en chargera */
    }
  }
  return { removed: paths.length, remaining: plan.remaining, paths }
}
