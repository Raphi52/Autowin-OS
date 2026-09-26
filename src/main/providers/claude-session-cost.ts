import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'

/**
 * LE COÛT D'UN TOUR, PAS CELUI DE LA SESSION ENTIÈRE.
 *
 * Le CLI Claude rend `total_cost_usd` dans son event `result`. Sur une session REPRISE (`--resume`,
 * ce que font le pilote de chat ET chaque itération d'agent), ce champ est le CUMUL de la session
 * depuis son premier tour — pas le coût du tour qui vient de finir. Autowin l'écrivait tel quel
 * dans le journal d'appels et dans le journal d'activité ; l'indicateur de la barre du haut
 * ADDITIONNE ces lignes, donc il additionnait des cumuls.
 *
 * Mesure du 2026-09-20 sur les journaux réels (661 conversations) : 9 320 $ affichés contre
 * 4 428 $ réellement dépensés. Sur conv-729, 1 896 $ affichés pour 110 $ réels (×17). Preuve que le
 * champ est bien un cumul, sur les 16 tours de conv-733 : la série est strictement croissante
 * (5,48 → 51,27) et chaque DIFFÉRENCE successive retombe à 2-3 % près sur le coût recalculé depuis
 * les tokens du tour au tarif public (`shared/cost-estimate`), alors que la valeur brute en est à
 * un facteur 15 sur les derniers tours.
 *
 * On ne remplace donc PAS le montant du provider par une estimation : on lui retire ce qu'il avait
 * déjà facturé sur la même session. La soustraction est l'arithmétique du CLI lui-même, pas une
 * deuxième vérité.
 */

/** Ce qu'on retient d'une session : le dernier cumul vu. */
export interface SessionCostState {
  /** Dernier `total_cost_usd` rendu par le CLI pour cette session. */
  readonly lastTotalUsd: number
  /** Horodatage de la dernière mise à jour, pour purger les sessions mortes. */
  readonly updatedAt: number
}

/** Au-delà, une session n'est plus reprise : son état ne sert qu'à faire grossir le fichier. */
export const SESSION_COST_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Coût du TOUR à partir du cumul rendu par le CLI.
 *
 * - session inconnue → le cumul EST le coût du premier tour ;
 * - cumul en baisse → le CLI a reparti d'une autre base (session recyclée, compteur remis) : on
 *   prend la valeur telle quelle plutôt qu'un négatif ou un zéro silencieux ;
 * - pas de sessionId → rien à dé-cumuler, on rend la valeur (cas du one-shot, jamais repris).
 *
 * Fonction PURE : l'état entre et ressort, le stockage est le problème de l'appelant.
 */
export function perTurnCostUsd(
  reportedTotalUsd: number,
  previous: SessionCostState | undefined
): number {
  if (!Number.isFinite(reportedTotalUsd) || reportedTotalUsd < 0) return 0
  if (!previous || !Number.isFinite(previous.lastTotalUsd)) return reportedTotalUsd
  if (reportedTotalUsd < previous.lastTotalUsd) return reportedTotalUsd
  return reportedTotalUsd - previous.lastTotalUsd
}

/** Purge les sessions plus vieilles que le TTL — le fichier ne grossit pas indéfiniment. */
export function purgeSessionCostStates(
  states: Readonly<Record<string, SessionCostState>>,
  now: number,
  ttlMs: number = SESSION_COST_TTL_MS
): Record<string, SessionCostState> {
  const kept: Record<string, SessionCostState> = {}
  for (const [id, state] of Object.entries(states)) {
    if (!state || typeof state.updatedAt !== 'number') continue
    if (now - state.updatedAt > ttlMs) continue
    kept[id] = state
  }
  return kept
}

/*
 * ------------------------------------------------------------------------------------------------
 * STOCKAGE. Séparé des fonctions pures ci-dessus : elles se testent sans disque.
 *
 * Pourquoi sur DISQUE et pas en mémoire : une session CLI survit au redémarrage de l'app
 * (`--resume` rejoue la même session), donc un état en mémoire seule rendrait au premier tour
 * d'après-redémarrage le cumul entier de la session — exactement le défaut qu'on corrige.
 */

function cheminMagasin(): string {
  return join(ensureAutowinAppData(), 'claude-session-cost.json')
}

function lireMagasin(chemin: string): Record<string, SessionCostState> {
  try {
    if (!existsSync(chemin)) return {}
    const brut: unknown = JSON.parse(readFileSync(chemin, 'utf-8'))
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {}
    const états: Record<string, SessionCostState> = {}
    for (const [id, valeur] of Object.entries(brut as Record<string, unknown>)) {
      const v = valeur as Partial<SessionCostState> | null
      if (!v || typeof v.lastTotalUsd !== 'number' || !Number.isFinite(v.lastTotalUsd)) continue
      états[id] = {
        lastTotalUsd: v.lastTotalUsd,
        updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now()
      }
    }
    return états
  } catch {
    // Un magasin illisible ne doit pas faire échouer un tour : on repart d'une ardoise vide, ce qui
    // sur-compte AU PIRE un tour, jamais toute une session.
    return {}
  }
}

function écrireMagasin(chemin: string, états: Record<string, SessionCostState>): void {
  try {
    mkdirSync(dirname(chemin), { recursive: true })
    // Écriture atomique : un tour interrompu ne laisse pas un JSON tronqué qui ferait perdre TOUS
    // les cumuls des autres sessions au prochain démarrage.
    const temporaire = `${chemin}.${process.pid}.tmp`
    writeFileSync(temporaire, JSON.stringify(états), 'utf-8')
    renameSync(temporaire, chemin)
  } catch {
    /* le coût du tour reste juste pour CE tour ; seul le suivant sur-comptera */
  }
}

/**
 * Vide le magasin — POUR LES TESTS. Le magasin est volontairement PERSISTANT (une session CLI
 * survit au redémarrage de l'app), donc deux exécutions de la suite partageant la même racine de
 * données se verraient l'une l'autre : le second passage rendrait 0 là où le premier rendait le
 * montant. Sans cette remise à zéro, un test à coût constant est vert une fois sur deux.
 */
export function reinitialiserMagasinCoutsDeSession(): void {
  try {
    const chemin = cheminMagasin()
    if (existsSync(chemin)) rmSync(chemin, { force: true })
  } catch {
    /* rien a vider */
  }
}

/**
 * Convertit le cumul de session rendu par le CLI en coût du TOUR, et retient le nouveau cumul.
 *
 * Sans `sessionId` on rend la valeur inchangée : il n'y a alors rien à quoi rattacher un cumul.
 */
export function coutDuTourDepuisCumul(
  sessionId: string | undefined,
  reportedTotalUsd: number,
  now: number = Date.now()
): number {
  if (!sessionId) return reportedTotalUsd
  if (!Number.isFinite(reportedTotalUsd) || reportedTotalUsd < 0) return reportedTotalUsd
  const chemin = cheminMagasin()
  const états = lireMagasin(chemin)
  const tour = perTurnCostUsd(reportedTotalUsd, états[sessionId])
  const suivants = purgeSessionCostStates(états, now)
  suivants[sessionId] = { lastTotalUsd: reportedTotalUsd, updatedAt: now }
  écrireMagasin(chemin, suivants)
  return tour
}
