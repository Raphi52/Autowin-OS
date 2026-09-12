import { execFile, execFileSync } from 'node:child_process'
import { HookBus, type HookContext, type HookResult } from './hook-bus'
import { createVerifyReplayHook, type VerifyRunner } from './verify-replay-hook'
import {
  runHooks,
  requireVisualProofForFrontDiff,
  requireMotionProofForAnimationDiff
} from '../gates/hooks'
import type { HookHandler } from './hook-bus'
import { exigenceAppuiSourcesNeuves } from '../autowin-kaizen-context'

/**
 * Un handler pre-green qui RÉUTILISE les hooks synchrones existants (gates/hooks.ts :
 * anti-flaky / fix-gate / done-without-proof). On ne réécrit PAS leur logique — on la branche
 * comme handler du bus (unification demandée, zéro duplication).
 */
function syncGateHooksHandler(ctx: HookContext): HookResult {
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

/**
 * PREUVE VISUELLE — le hook existait, personne ne l'allumait.
 *
 * `requireVisualProofForFrontDiff` (gates/hooks.ts) refuse un vert quand le RENDU est modifié sans
 * capture réellement lue. Il était écrit, testé... et passé par AUCUN site de production : `grep -rn
 * requireVisualProof src/main` ne rendait que sa propre définition. L'exigence ne vivait donc qu'en
 * PROSE (pipeline-discipline.ts), et une prose ne refuse rien.
 *
 * Mesure (conv-512, tour `24bf5294-7ab1-4104-aa0c-1c0f62009fb8`) : un run modifie
 * `ModelActivityLogPane.tsx` + `.css`, se clôture VERT, et l'agent écrit lui-même « je ne l'ai pas
 * observé à l'écran — aucune capture, aucun verdict visuel de ma part ».
 *
 * Le diff n'est pas transporté jusqu'ici : on reconstruit la liste des fichiers TOUCHÉS depuis le
 * dépôt de travail (état non enregistré + écart avec HEAD), au format `+++ b/<chemin>` que le hook
 * sait lire. Injectable pour les tests ; en cas d'échec git, on rend une liste vide — un garde-fou
 * ne doit pas inventer un refus sur un dépôt qu'il n'a pas su lire.
 */
export function fichiersTouchesGit(cwd: string): readonly string[] {
  const lire = (args: string[]): string[] => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true })
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }
  const porcelain = lire(['status', '--porcelain'])
    .map((l) => l.slice(3).trim())
    .map((l) => (l.includes(' -> ') ? l.split(' -> ')[1] : l))
  return [...new Set([...porcelain, ...lire(['diff', '--name-only', 'HEAD'])])]
}

/** Une capture est une preuve VISUELLE seulement si elle a réellement été exécutée et rendue ok. */
function capturesLues(evidence: HookContext['evidence']): number {
  return (evidence ?? []).filter((e) => e.ok && /ui-capture/.test(e.command ?? '')).length
}

export function creerPreuveVisuelleHandler(
  listerFichiersTouches: (cwd: string) => readonly string[] = fichiersTouchesGit
): HookHandler {
  return (ctx: HookContext): HookResult => {
    // `requireProof` marque déjà les tâches MUTANTES : hors de là, aucun rendu n'est en jeu.
    if (!ctx.requireProof || !ctx.cwd) return { block: false }
    const diff = listerFichiersTouches(ctx.cwd)
      .map((f) => `+++ b/${f.replace(/\\/g, '/')}`)
      .join('\n')
    if (!diff) return { block: false }
    const violations = requireVisualProofForFrontDiff(diff, capturesLues(ctx.evidence))
    return violations.length
      ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
      : { block: false }
  }
}

/**
 * PREUVE DE MOUVEMENT — meme trou que la preuve visuelle, autre hook.
 *
 * `requireMotionProofForAnimationDiff` n'etait lui non plus passe par AUCUN appelant de production.
 * Une capture FIXE satisfait la preuve visuelle tout en etant aveugle a la seule chose qu'un diff
 * d'animation modifie : le mouvement. On lui donne donc le VRAI diff du depot de travail (`git diff
 * HEAD`), seul texte ou les lignes ajoutees `animation:` / `@keyframes` sont lisibles. Diff illisible
 * ou vide => aucun refus invente.
 */
export function diffGit(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024
    })
  } catch {
    return ''
  }
}

export function creerPreuveMouvementHandler(
  lireDiff: (cwd: string) => string = diffGit
): HookHandler {
  return (ctx: HookContext): HookResult => {
    if (!ctx.requireProof || !ctx.cwd) return { block: false }
    const diff = lireDiff(ctx.cwd)
    if (!diff) return { block: false }
    const mesures = (ctx.evidence ?? []).filter(
      (e) => e.ok && /ui-capture/.test(e.command ?? '') && /--motion/.test(e.command ?? '')
    ).length
    const violations = requireMotionProofForAnimationDiff(diff, mesures)
    return violations.length
      ? { block: true, reason: violations.map((h) => `hook ${h.hook}: ${h.detail}`).join('; ') }
      : { block: false }
  }
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
    .register('pre-green', creerPreuveVisuelleHandler())
    .register('pre-green', creerPreuveMouvementHandler())
    .register('pre-green', createVerifyReplayHook(verifyRunner))
}
