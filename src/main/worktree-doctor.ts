import type {
  WorktreeDoctorFinding,
  WorktreeDoctorProposal,
  WorktreeDoctorReport,
  WorktreeMapEntry
} from '../shared/worktree-map'

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

function pruneProposals(repoPath: string): WorktreeDoctorProposal[] {
  const scope = 'Cette commande inspecte le dépôt entier, pas seulement cette copie.'
  return [
    {
      action: 'prune-preview',
      cwd: repoPath,
      argv: ['worktree', 'prune', '--dry-run', '--verbose'],
      reason: scope,
      mutates: false,
      automatic: false,
      requiresConfirmation: false
    },
    {
      action: 'prune',
      cwd: repoPath,
      argv: ['worktree', 'prune', '--verbose'],
      reason: scope,
      mutates: true,
      automatic: false,
      requiresConfirmation: true
    }
  ]
}

export function diagnoseWorktrees(
  repoPath: string,
  entries: readonly WorktreeMapEntry[]
): WorktreeDoctorReport {
  const findings: WorktreeDoctorFinding[] = []

  for (const entry of entries) {
    if (samePath(entry.path, repoPath)) continue

    if (entry.locked) {
      findings.push({
        code: 'locked',
        severity: 'info',
        path: entry.path,
        evidence: entry.lockedReason
          ? `La copie est verrouillée : ${entry.lockedReason}`
          : 'La copie est verrouillée sans raison documentée.',
        proposals: [
          {
            action: 'unlock',
            cwd: repoPath,
            argv: ['worktree', 'unlock', entry.path],
            reason: 'À exécuter seulement quand la cause du verrou a disparu.',
            mutates: true,
            automatic: false,
            requiresConfirmation: true
          }
        ]
      })
    }

    if (entry.prunableReason) {
      findings.push({
        code: 'prunable',
        severity: 'warning',
        path: entry.path,
        evidence: entry.prunableReason,
        proposals: pruneProposals(repoPath)
      })
      continue
    }

    if (entry.pathExists === false && !entry.locked) {
      findings.push({
        code: 'missing',
        severity: 'warning',
        path: entry.path,
        evidence:
          'Le dossier enregistré par Git est absent du disque et la copie n’est pas verrouillée.',
        proposals: [
          ...pruneProposals(repoPath),
          {
            action: 'lock',
            cwd: repoPath,
            argv: [
              'worktree',
              'lock',
              '--reason',
              'Autowin: volume temporairement indisponible',
              entry.path
            ],
            reason:
              'À choisir seulement si le dossier vit sur un volume externe ou réseau qui reviendra.',
            mutates: true,
            automatic: false,
            requiresConfirmation: true
          }
        ]
      })
      continue
    }

    if (entry.pathExists === true && entry.dirtyFiles === undefined) {
      findings.push({
        code: 'unreadable',
        severity: 'blocked',
        path: entry.path,
        evidence: 'Le dossier existe, mais Git ne peut pas lire son état.',
        proposals: [
          {
            action: 'repair',
            cwd: repoPath,
            argv: ['worktree', 'repair', entry.path],
            reason:
              'Répare les liens administratifs si cette copie a été déplacée ou ses métadonnées altérées.',
            mutates: true,
            automatic: false,
            requiresConfirmation: true
          }
        ]
      })
      continue
    }
  }

  return {
    status: findings.some((finding) => finding.severity === 'blocked')
      ? 'blocked'
      : findings.length > 0
        ? 'attention'
        : 'healthy',
    findings
  }
}
