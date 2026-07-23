import type { ExecutionEvidence } from '../providers/types'

/**
 * Système de hooks INTERNE à Autowin : enforcement déterministe, uniforme pour TOUS les exécuteurs
 * (claude/codex/omniroute), indépendant des hooks Claude Code (désactivés quand on lance le CLI « nu »
 * via --setting-sources ""). Handlers TypeScript enregistrés in-repo (pas de shell arbitraire).
 */
export type HookEvent = 'pre-exec' | 'post-exec' | 'pre-green' | 'run-stop'

export interface HookContext {
  event: HookEvent
  task: string
  phase?: string
  cwd?: string
  evidence?: ExecutionEvidence[]
  /** Commande de vérification à REJOUER (verify-replay) — absente = pas de replay possible. */
  verifyCmd?: string
  // Entrées des hooks synchrones existants (gates/hooks.ts), réutilisés comme handlers pre-green.
  requireProof?: boolean
  evidenceOkCount?: number
  producedDiff?: string
  editsByFile?: Record<string, number>
  causeTokensByFile?: Record<string, boolean>
}

/** Ce qu'un handler retourne : bloquer (avec raison) ou laisser passer. */
export interface HookResult {
  block?: boolean
  reason?: string
}

/** Résultat agrégé de tous les handlers d'un event. */
export interface HookOutcome {
  blocked: boolean
  reasons: string[]
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult> | HookResult

export class HookBus {
  private readonly handlers = new Map<HookEvent, HookHandler[]>()

  register(event: HookEvent, handler: HookHandler): this {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return this
  }

  /**
   * Exécute TOUS les handlers de l'event. Fail-closed : un handler qui jette = BLOQUE (avec la raison),
   * jamais avalé silencieusement (un garde-fou qui plante ne doit pas passer pour un vert).
   * L'appelant décide quoi faire du blocage selon l'event (pre-green bloquant → gateBlocked).
   */
  async run(event: HookEvent, ctx: Omit<HookContext, 'event'>): Promise<HookOutcome> {
    const list = this.handlers.get(event) ?? []
    const reasons: string[] = []
    let blocked = false
    for (const handler of list) {
      let result: HookResult
      try {
        result = await handler({ ...ctx, event })
      } catch (error) {
        result = { block: true, reason: `hook '${event}' a échoué: ${error instanceof Error ? error.message : String(error)}` }
      }
      if (result?.block) {
        blocked = true
        if (result.reason) reasons.push(result.reason)
      }
    }
    return { blocked, reasons }
  }

  /** Nombre de handlers enregistrés pour un event (introspection/tests). */
  count(event: HookEvent): number {
    return this.handlers.get(event)?.length ?? 0
  }
}
