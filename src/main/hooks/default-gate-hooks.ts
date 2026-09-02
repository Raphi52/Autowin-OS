import { execFile } from 'node:child_process'
import { HookBus, type HookContext, type HookResult } from './hook-bus'
import { createVerifyReplayHook, type VerifyRunner } from './verify-replay-hook'
import { runHooks } from '../gates/hooks'
import { exigenceAppuiSourcesNeuves } from '../autowin-kaizen-context'

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

/**
 * APPUI SUR LES SOURCES NEUVES — contrôle hors modèle d'un rendu de /kaizen.
 *
 * Mesuré sur conv-105 : le dossier de preuve joignait les appels modèle, le journal des tours et
 * les saisies, l'exigence de s'en servir était écrite dans la consigne, et le rendu n'en citait
 * aucun — les corrections portaient sur le mécanisme qui fabrique le dossier. Une exigence
 * seulement écrite ne tient pas : elle est donc VÉRIFIÉE ici, sur le texte produit. Le contrôle ne
 * juge pas la pertinence de la correction, seulement qu'un identifiant réel est cité ; il ne
 * s'applique ni hors kaizen, ni quand le dossier ne porte aucune de ces trois sources.
 */
export function appuiSourcesNeuvesHandler(ctx: HookContext): HookResult {
  if (!ctx.output) return { block: false }
  const verdict = exigenceAppuiSourcesNeuves(ctx.task, ctx.output)
  return verdict.manque
    ? { block: true, reason: `hook kaizen-appui-sources-neuves: ${verdict.motif}` }
    : { block: false }
}

/** Cap du re-jeu de vérification (comme le stop-gate CC) : au-delà → kill → bloque. */
const VERIFY_TIMEOUT_MS = 120_000

/** Runner réel par défaut (verify-replay) : exécute la commande via le shell et rend son exit code. */
const defaultVerifyRunner: VerifyRunner = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      { cwd, shell: true, windowsHide: true, timeout: VERIFY_TIMEOUT_MS },
      (error) => {
        // timeout → error.killed=true → exitCode non-zéro → block (jamais un faux-vert sur dépassement).
        const exitCode =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : error
              ? 1
              : 0
        resolve({ exitCode })
      }
    )
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
    .register('pre-green', appuiSourcesNeuvesHandler)
    .register('pre-green', createVerifyReplayHook(verifyRunner))
}
