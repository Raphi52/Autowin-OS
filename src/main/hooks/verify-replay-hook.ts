import { isMutationTask } from '../orchestrator'
import type { HookContext, HookHandler, HookResult } from './hook-bus'

/** Rejoue une commande de vérification et rend son exit code (injecté → testable sans exec réel). */
export type VerifyRunner = (cmd: string, cwd?: string) => Promise<{ exitCode: number; output?: string }>

/**
 * Hook `pre-green` verify-replay : pour une tâche de MUTATION, REJOUE réellement la commande de
 * vérification (au lieu de croire l'executionEvidence sur parole) et BLOQUE si elle échoue. C'est
 * l'analogue interne du stop-gate Claude Code — mais côté Autowin, donc valable pour TOUS les
 * exécuteurs. Sans commande de vérif, on ne peut pas rejouer → on ne bloque pas (le gate evidence
 * existant s'applique toujours) mais on ne certifie rien de plus.
 */
export function createVerifyReplayHook(runVerify: VerifyRunner): HookHandler {
  return async (ctx: HookContext): Promise<HookResult> => {
    if (ctx.event !== 'pre-green') return { block: false }
    if (!isMutationTask(ctx.task)) return { block: false }
    if (!ctx.verifyCmd) return { block: false }
    const res = await runVerify(ctx.verifyCmd, ctx.cwd)
    if (res.exitCode !== 0) {
      return {
        block: true,
        reason: `verify-replay: « ${ctx.verifyCmd} » a échoué (exit ${res.exitCode}) — vert refusé`
      }
    }
    return { block: false }
  }
}
