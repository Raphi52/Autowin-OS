import { execFile } from 'node:child_process'
import { HookBus, type HookContext, type HookResult } from './hook-bus'
import { createVerifyReplayHook, type VerifyRunner } from './verify-replay-hook'
import { runHooks } from '../gates/hooks'

/**
 * Un handler pre-green qui RÉUTILISE les hooks synchrones existants (gates/hooks.ts :
 * anti-flaky / fix-gate / done-without-proof). On ne réécrit PAS leur logique — on la branche
 * comme handler du bus (unification demandée, zéro duplication).
 */
export function syncGateHooksHandler(ctx: HookContext): HookResult {
  const violations = runHooks({
    requireProof: ctx.requireProof,
    evidenceOkCount: ctx.evidenceOkCount,
    producedDiff: ctx.producedDiff,
    editsByFile: ctx.editsByFile,
    causeTokensByFile: ctx.causeTokensByFile
  })
  return violations.length
    ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
    : { block: false }
}

/** Runner réel par défaut (verify-replay) : exécute la commande via le shell et rend son exit code. */
const defaultVerifyRunner: VerifyRunner = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, { cwd, shell: true, windowsHide: true }, (error) => {
      const exitCode =
        error && typeof (error as { code?: unknown }).code === 'number'
          ? ((error as { code: number }).code as number)
          : error
            ? 1
            : 0
      resolve({ exitCode })
    })
  })

/**
 * Construit le HookBus par défaut d'Autowin : les hooks synchrones existants + verify-replay,
 * tous branchés sur `pre-green`. Sans bus fourni à l'orchestrateur, celui-ci utilise CE bus →
 * comportement d'enforcement identique à l'existant (rétrocompat) + verify-replay en plus.
 * Les events pre-exec/post-exec/run-stop existent (extensibles) mais n'ont pas de handler par défaut.
 */
export function createDefaultHookBus(verifyRunner: VerifyRunner = defaultVerifyRunner): HookBus {
  return new HookBus()
    .register('pre-green', syncGateHooksHandler)
    .register('pre-green', createVerifyReplayHook(verifyRunner))
}
