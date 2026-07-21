import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Charge le TEXTE des skills du kit (`~/.claude/skills/<phase>/SKILL.md` + `_engine/ENGINE.md`)
 * au runtime, pour que l'orchestration in-app joue la vraie pipeline du user — quel que soit le
 * PROVIDER (le texte est injecté en system prompt de chaque phase). Si le kit est absent (app
 * packagée chez un autre), chaque loader renvoie '' → l'orchestration retombe sur la discipline
 * condensée intégrée (pipeline-discipline.ts). Aucune dépendance dure au home du dev.
 */
export type PipelinePhase = 'scout' | 'frame' | 'terrain' | 'build' | 'clean' | 'judge'

export const PIPELINE_PHASES: PipelinePhase[] = [
  'scout',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge'
]

export function skillsRoot(root = join(homedir(), '.claude', 'skills')): string {
  return root
}

function readIfExists(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

/** Texte brut du SKILL.md d'une phase (vide si absent). */
export function loadSkillText(phase: PipelinePhase, root = skillsRoot()): string {
  return readIfExists(join(root, phase, 'SKILL.md'))
}

/** Texte de `_engine/ENGINE.md` (mécanique partagée ; vide si absent). */
export function loadEngineText(root = skillsRoot()): string {
  return readIfExists(join(root, '_engine', 'ENGINE.md'))
}

/** true si le kit de skills est disponible sur ce poste (au moins une phase clé présente). */
export function kitAvailable(root = skillsRoot()): boolean {
  return loadSkillText('frame', root).length > 0 || loadSkillText('build', root).length > 0
}

/** Instruction system prompt pour une phase = le SKILL.md du kit s'il existe, sinon ''. */
export function phaseInstruction(phase: PipelinePhase, root = skillsRoot()): string {
  const text = loadSkillText(phase, root)
  return text ? `\n=== SKILL ${phase.toUpperCase()} (kit) ===\n${text}\n` : ''
}
