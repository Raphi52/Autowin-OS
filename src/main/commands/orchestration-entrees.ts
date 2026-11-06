/**
 * Ce que l'orchestration reçoit d'un appel : phases admises, chemins du watchdog, identité de preuve.
 *
 * Code libre sorti de `commands.ts` tel quel (lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { PIPELINE_PHASES } from '../../shared/pipeline-phases'

/**
 * Phases qu'un MODÈLE peut demander. Liste FERMÉE : une valeur hors liste est ignorée plutôt que
 * transmise, sinon un modèle pourrait préfixer la tâche de n'importe quoi. `kaizen` est volontairement
 * absent — il a son propre chemin de construction de tâche, plus bas dans ce même `case`.
 */
/**
 * Les phases qu'une phase choisie par le MODELE peut designer — derivees, jamais recopiees.
 *
 * La copie en dur listait six phases sur huit (`kaizen` et `remake` manquaient), et c'est la troisieme
 * copie d'une liste que `shared/pipeline-phases.ts` etait censee unifier.
 *
 * Ce que la garde protege reste INTACT : une phase venant du modele n'ampute jamais une tache classee
 * `critical` (le test juste apres cette constante). Ce qui change, c'est qu'elle ne refuse plus une
 * phase parfaitement valide au seul motif qu'on avait oublie de l'ecrire ici.
 */
export const ORCHESTRATE_PHASES = new Set<string>(PIPELINE_PHASES)

/** Le log déclencheur reste une preuve en lecture seule ; l'agent reçoit un chemin relatif au bureau. */
export function isolateWatchdogPromptPaths(
  prompt: string,
  watchedPaths: readonly string[],
  workspaceRoot: string
): string {
  let isolated = prompt
  for (const watchedPath of watchedPaths) {
    const absolute = isAbsolute(watchedPath)
      ? resolve(watchedPath)
      : resolve(workspaceRoot, watchedPath)
    const rel = relative(workspaceRoot, absolute)
    if (!rel || rel === '..' || /^\.\.[\\/]/.test(rel) || isAbsolute(rel)) continue
    const replacement = rel.replaceAll('\\', '/')
    for (const candidate of [watchedPath, watchedPath.replaceAll('\\', '/'), absolute]) {
      isolated = isolated.split(candidate).join(replacement)
    }
  }
  return watchedPaths.length
    ? `${isolated}\n\nCONTRAINTE WATCHDOG : la source surveillée est une preuve en lecture seule. Ne la modifie, ne la tronque et ne la recrée jamais ; corrige uniquement la cause dans les fichiers du bureau isolé.`
    : isolated
}

export function watchdogEvidenceIdentity(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const evidence = value as Record<string, unknown>
  if (evidence.trust !== 'untrusted') return undefined
  if (typeof evidence.signal !== 'object' || evidence.signal === null) return undefined
  const signal = evidence.signal as Record<string, unknown>
  const signature = typeof signal.signature === 'string' ? signal.signature.slice(0, 4096) : ''
  const context = typeof signal.context === 'string' ? signal.context.slice(0, 20_000) : ''
  if (!signature && !context) return undefined
  return createHash('sha256').update(`${signature}\0${context}`).digest('hex')
}
