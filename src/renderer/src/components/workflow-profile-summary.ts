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
