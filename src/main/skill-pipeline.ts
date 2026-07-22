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

/**
 * Retire la frontmatter YAML (`---\n…\n---`) d'un SKILL.md. Ce bloc (`name:` + le long
 * `description:` d'heuristiques "Trigger on… / Do NOT use to…") sert au SÉLECTEUR de skill de
 * Claude Code, PAS à un sous-agent qui exécute déjà la phase imposée : l'injecter est du bruit
 * (tokens gaspillés + risque de confusion). On ne garde que le CORPS (les vraies instructions).
 */
export function stripSkillFrontmatter(text: string): string {
  const m = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return m ? text.slice(m[0].length).replace(/^\s+/, '') : text
}

/**
 * Chapitre d'ENGINE.md pertinent par phase (le doc lui-même annote « used during <phase> »).
 * Injecter ENGINE.md ENTIER (22 k chars) à chaque phase serait l'overkill qu'on combat : on ne
 * fournit que la FONDATION (les 7 concepts « keep in mind ») + le seul chapitre de la phase.
 */
const PHASE_ENGINE_CHAPTER: Record<PipelinePhase, 'Ch.1' | 'Ch.2' | 'Ch.3' | 'Ch.4' | null> = {
  scout: 'Ch.1',
  frame: 'Ch.1',
  terrain: 'Ch.3',
  build: 'Ch.4',
  clean: 'Ch.4',
  judge: 'Ch.2'
}

function engineSection(full: string, headingPattern: string, stop: string): string {
  return new RegExp(`${headingPattern}[\\s\\S]*?(?=${stop})`).exec(full)?.[0].trim() ?? ''
}

/**
 * Mécanique ENGINE ciblée pour une phase : FONDATION (toujours) + chapitre de la phase.
 * Les SKILL.md renvoient à `_engine/ENGINE.md` comme mécanique canonique ; sans ça le sous-agent
 * lit des références vers un fichier qu'il n'a pas. Ciblé pour rester sous ~2 k tokens/phase.
 */
export function engineForPhase(
  phase: PipelinePhase,
  root = skillsRoot(),
  withFoundation = true
): string {
  const full = loadEngineText(root)
  if (!full) return ''
  // La FONDATION (7 concepts) est identique à chaque phase → réinjectée 5× sur un run = gaspillage.
  // `withFoundation=false` la coupe : l'orchestrateur ne la fournit qu'à la 1ʳᵉ phase (1×/run).
  const foundation = withFoundation ? engineSection(full, '## ⚡ THE FOUNDATION', '\\n# REFERENCE') : ''
  const chap = PHASE_ENGINE_CHAPTER[phase]
  const chapter = chap
    ? engineSection(full, `## ${chap.replace('.', '\\.')}`, '\\n## (?:Ch\\.\\d|Telemetry|Roadmap)|$')
    : ''
  const body = [foundation, chapter].filter(Boolean).join('\n\n')
  return body ? `\n=== ENGINE (mécanique partagée du kit) ===\n${body}\n` : ''
}

/**
 * Instruction system prompt pour une phase = CORPS du SKILL.md (sans frontmatter de routing)
 * + la mécanique ENGINE ciblée (fondation + chapitre de la phase).
 */
export function phaseInstruction(
  phase: PipelinePhase,
  root = skillsRoot(),
  opts: { withFoundation?: boolean } = {}
): string {
  // Défaut true : un appel ISOLÉ (chat, phase unique) garde la fondation. L'orchestrateur multi-phases
  // passe false sur les phases ≥2 pour n'injecter la fondation qu'UNE fois par run.
  const withFoundation = opts.withFoundation ?? true
  const body = stripSkillFrontmatter(loadSkillText(phase, root))
  if (!body) return ''
  const skill = `\n=== SKILL ${phase.toUpperCase()} (kit) ===\n${body}\n`
  // A/B LEAN (env AUTOWIN_LEAN_INJECT=1) : corps du skill SEUL, sans la mécanique ENGINE.
  if (process.env.AUTOWIN_LEAN_INJECT === '1') return skill
  return skill + engineForPhase(phase, root, withFoundation)
}
