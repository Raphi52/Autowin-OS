import { describe, expect, it } from 'vitest'
import type { WorktreeMapEntry } from '../shared/worktree-map'
import { diagnoseWorktrees } from './worktree-doctor'

const entry = (partial: Partial<WorktreeMapEntry>): WorktreeMapEntry => ({
  path: 'C:/repo/copy',
  head: 'abc1234',
  detached: true,
  locked: false,
  ...partial
})

describe('diagnoseWorktrees', () => {
  it('propose uniquement des commandes manuelles structurées pour une entrée prunable', () => {
    const report = diagnoseWorktrees('C:/repo', [
      entry({ prunableReason: 'gitdir file points to non-existent location', pathExists: false })
    ])

    expect(report.status).toBe('attention')
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({
      code: 'prunable',
      path: 'C:/repo/copy',
      evidence: 'gitdir file points to non-existent location'
    })
    expect(report.findings[0].proposals).toEqual([
      {
        action: 'prune-preview',
        cwd: 'C:/repo',
        argv: ['worktree', 'prune', '--dry-run', '--verbose'],
        reason: expect.stringContaining('dépôt entier'),
        mutates: false,
        automatic: false,
        requiresConfirmation: false
      },
      {
        action: 'prune',
        cwd: 'C:/repo',
        argv: ['worktree', 'prune', '--verbose'],
        reason: expect.stringContaining('dépôt entier'),
        mutates: true,
        automatic: false,
        requiresConfirmation: true
      }
    ])
  })

  it('ne prescrit rien sur la copie principale et garde les choix ambigus explicites', () => {
    const report = diagnoseWorktrees('C:/repo', [
      entry({ path: 'C:/repo', pathExists: true, dirtyFiles: 0 }),
      entry({ path: 'C:/repo/missing', pathExists: false })
    ])

    expect(report.findings).toHaveLength(1)
    expect(report.findings[0].code).toBe('missing')
    expect(report.findings[0].proposals.map((proposal) => proposal.action)).toEqual([
      'prune-preview',
      'prune',
      'lock'
    ])
  })

  it('propose repair quand la copie existe mais que Git ne peut pas la lire', () => {
    const report = diagnoseWorktrees('C:/repo', [
      entry({ pathExists: true, dirtyFiles: undefined })
    ])

    expect(report.status).toBe('blocked')
    expect(report.findings[0]).toMatchObject({ code: 'unreadable', severity: 'blocked' })
    expect(report.findings[0].proposals[0]).toMatchObject({
      action: 'repair',
      argv: ['worktree', 'repair', 'C:/repo/copy'],
      mutates: true,
      automatic: false,
      requiresConfirmation: true
    })
  })

  it('distingue toute copie verrouillée et propose seulement un déverrouillage manuel', () => {
    const reports = [
      diagnoseWorktrees('C:/repo', [
        entry({ pathExists: true, dirtyFiles: 0, locked: true, lockedReason: 'volume externe' })
      ]),
      diagnoseWorktrees('C:/repo', [
        entry({ pathExists: true, dirtyFiles: 0, locked: true, lockedReason: undefined })
      ])
    ]

    for (const report of reports) {
      expect(report.status).toBe('attention')
      expect(report.findings[0]).toMatchObject({ code: 'locked', severity: 'info' })
      expect(report.findings[0].proposals).toEqual([
        expect.objectContaining({
          action: 'unlock',
          argv: ['worktree', 'unlock', 'C:/repo/copy'],
          mutates: true,
          automatic: false,
          requiresConfirmation: true
        })
      ])
    }
    expect(reports[0].findings[0].evidence).toContain('volume externe')
    expect(reports[1].findings[0].evidence).toContain('sans raison')
  })

  it('considère sain un dépôt sans anomalie', () => {
    expect(diagnoseWorktrees('C:/repo', [entry({ pathExists: true, dirtyFiles: 0 })])).toEqual({
      status: 'healthy',
      findings: []
    })
  })
})
