import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Chronométrage des JALONS d'un tour de chat — pour répondre factuellement à « pourquoi ce délai
 * quand je clique sur Envoyer ? » au lieu de supposer. Une ligne JSONL par tour dans
 * `<appdata>/autowin-os/turn-timing.jsonl`, écrite en best-effort (jamais bloquante, jamais throw).
 *
 * Jalons mesurés depuis l'entrée du handler jusqu'au PREMIER token affiché : c'est exactement la
 * latence perçue par l'utilisateur.
 */

let timingDir: string | undefined

/** Fixe le dossier d'écriture (appelé par le main au démarrage). Absent → chronométrage inerte. */
export function configureTurnTiming(dir: string): void {
  timingDir = dir
}

export interface TurnTimer {
  /** Enregistre un jalon nommé (ms depuis le début du tour). */
  mark: (name: string) => void
  /** Clôt le tour et persiste la ligne (best-effort, non attendu). */
  end: (extra?: Record<string, unknown>) => void
}

/**
 * QUI est chronométré. Mesure du 2026-09-02 : les 398 lignes réelles de `turn-timing.jsonl` ne
 * portent que `label: 'chat'` — on sait qu'un tour a duré 42 s sans pouvoir dire LEQUEL, donc sans
 * pouvoir joindre la mesure au journal du tour, à la conversation, ni au gel du même instant.
 * L'identité est demandée au DÉMARRAGE, seul endroit où elle est de toute façon connue.
 */
export interface TurnIdentity {
  turnId?: string
  conversationId?: string
}

export function startTurnTimer(label: string, identity: TurnIdentity = {}): TurnTimer {
  const startedAt = performance.now()
  const marks: Record<string, number> = {}
  return {
    mark: (name) => {
      marks[name] = Math.round(performance.now() - startedAt)
    },
    end: (extra) => {
      if (!timingDir) return
      const line =
        JSON.stringify({
          ts: new Date().toISOString(),
          label,
          // Champs OPTIONNELS : le journal est en ajout-seul, les lignes deja ecrites restent lisibles.
          ...(identity.turnId ? { turnId: identity.turnId } : {}),
          ...(identity.conversationId ? { conversationId: identity.conversationId } : {}),
          totalMs: Math.round(performance.now() - startedAt),
          marks,
          ...extra
        }) + '\n'
      void mkdir(timingDir, { recursive: true })
        .then(() => appendFile(join(timingDir as string, 'turn-timing.jsonl'), line, 'utf8'))
        .catch(() => {
          /* observabilité best-effort : ne jamais perturber un tour */
        })
    }
  }
}
