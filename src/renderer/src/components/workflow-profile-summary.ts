import { trackNodes, type ExecutabilityInput } from './workflow-executability'

export interface PromptEffectifInput {
  phases?: string[]
  graph?: ExecutabilityInput['graph']
  instructions?: { mode: 'append' | 'replace'; text?: string; perPhase?: Record<string, string> }
}

export interface WorkflowProfileSummaryInput {
  id?: string
  name?: string
  roles?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
  phases?: string[]
  allocation?: { judgeMembers?: number }
  instructions?: { mode: 'append' | 'replace'; text?: string }
}

/** Résume un profil en une ligne : ce qu'il change, pas ce qu'il contient. */
export function profileSummary(profile: WorkflowProfileSummaryInput): string {
  const parts: string[] = []
  const roles = Object.entries(profile.roles ?? {})
  if (roles.length) {
    parts.push(
      roles
        .map(([role, binding]) =>
          [role, binding.model, binding.reasoningEffort].filter(Boolean).join(' ')
        )
        .join(' · ')
    )
  }
  if (profile.phases?.length) parts.push(profile.phases.join(' → '))
  if (typeof profile.allocation?.judgeMembers === 'number') {
    parts.push(`${profile.allocation.judgeMembers} juge(s)`)
  }
  if (profile.instructions) {
    parts.push(
      profile.instructions.mode === 'replace' ? 'consignes remplacées' : 'consigne ajoutée'
    )
  }
  return parts.length ? parts.join(' · ') : 'aucun écart — configuration courante'
}

/**
 * Les consignes RÉELLEMENT envoyées, phase par phase. Le résumé d'une ligne disait « consignes
 * remplacées » sans jamais montrer QUOI : un prompt partait donc sur un texte que personne n'avait
 * relu, et le mode `replace` (qui écrase le corps de la phase) ne se distinguait pas d'un ajout.
 */
export function promptEffectif(
  profile: PromptEffectifInput
): { phase: string; texte: string; origine: 'phase' | 'global' }[] {
  const instructions = profile.instructions
  if (!instructions) return []
  const phases = [...new Set(trackNodes(profile as ExecutabilityInput).map((n) => n.phase))]
  const cibles = phases.length ? phases : Object.keys(instructions.perPhase ?? {})
  const lignes = cibles
    .map((phase) => {
      const propre = instructions.perPhase?.[phase]
      const texte = propre ?? instructions.text
      return texte ? { phase, texte, origine: propre ? 'phase' : 'global' } : null
    })
    .filter((l): l is { phase: string; texte: string; origine: 'phase' | 'global' } => l !== null)
  // Une consigne écrite pour une phase HORS topologie doit rester visible : la taire donnerait à
  // croire qu'elle s'applique.
  for (const [phase, texte] of Object.entries(instructions.perPhase ?? {})) {
    if (!cibles.includes(phase) && texte) lignes.push({ phase, texte, origine: 'phase' })
  }
  return lignes
}
