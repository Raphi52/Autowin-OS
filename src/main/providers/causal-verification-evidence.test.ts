import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OutcomeLearningLedger } from '../activity/outcome-learning-ledger'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from '../outcome-learning-proposal'
import { OutcomeLearningSupervisor } from '../outcome-learning-supervisor'
import { attestIsolatedVerificationEvidence } from './causal-verification-evidence'
import { codexExecutionEvidenceFromItem } from './codex'
import type { ExecutionEvidence } from './types'

const TRUSTED_ORACLE = {
  command: 'npx vitest run src/main/x.test.ts',
  covers: ['src/main/x.ts'],
  attestedFiles: ['src/main/x.test.ts'],
  attestation: 'manifest:x'
}

describe('preuve causale provider → outcome learning', () => {
  it('atteste un vrai flux Codex red → mutation → deux greens dans un worktree isolé', () => {
    const events: ExecutionEvidence[] = [
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'failed',
        command: 'npx vitest run src/main/x.test.ts',
        exit_code: 1
      }),
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: 'rg "failure" src/main/x.ts',
        exit_code: 0
      }),
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'snapshot diff',
        paths: ['src/main/x.ts'],
        pathFingerprints: { 'src/main/x.ts': 'sha-after' }
      },
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: 'npx vitest run src/main/x.test.ts',
        exit_code: 0
      }),
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: 'npx vitest run src/main/x.test.ts',
        exit_code: 0
      })
    ]

    attestIsolatedVerificationEvidence(events, true, [TRUSTED_ORACLE])

    expect(events.filter((event) => event.kind === 'verification')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oracleStable: true,
          oracleAttestation: 'manifest:x',
          paths: ['src/main/x.ts']
        })
      ])
    )
    expect(events.filter((event) => event.kind === 'verification')).toHaveLength(3)
  })

  it('refuse d’attester un workspace partagé ou une simple inspection', () => {
    const evidence: ExecutionEvidence[] = [
      {
        type: 'file_change',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'changed',
        paths: ['C:/repo/x.ts']
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'status',
        command: 'git status'
      }
    ]

    attestIsolatedVerificationEvidence(evidence, false)
    attestIsolatedVerificationEvidence(evidence, true)

    expect(evidence[1]).not.toHaveProperty('oracleStable')
    expect(evidence[1]).not.toHaveProperty('paths')
  })

  it('refuse un test sans rapport ou une mutation hors couverture déclarée', () => {
    const evidence: ExecutionEvidence[] = [
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'snapshot',
        paths: ['src/unrelated.ts'],
        pathFingerprints: { 'src/unrelated.ts': 'sha' }
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'failed',
        ok: false,
        summary: 'unrelated red',
        command: 'npx vitest run unrelated.test.ts',
        exitCode: 1
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'unrelated green',
        command: 'npx vitest run unrelated.test.ts',
        exitCode: 0
      }
    ]

    attestIsolatedVerificationEvidence(evidence, true, [TRUSTED_ORACLE])

    for (const item of evidence.filter((entry) => entry.kind === 'verification')) {
      expect(item.oracleStable).not.toBe(true)
      expect(item.oracleAttestation).toBeUndefined()
      expect(item.paths).toBeUndefined()
    }
  })

  it('refuse tout le snapshot si une mutation est hors couverture ou touche l’oracle', () => {
    const mixed: ExecutionEvidence[] = [
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'mixed snapshot',
        paths: ['src/main/x.ts', 'src/unrelated.ts'],
        pathFingerprints: { 'src/main/x.ts': 'x', 'src/unrelated.ts': 'other' }
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'green',
        command: TRUSTED_ORACLE.command,
        exitCode: 0
      }
    ]
    const oracleMutation: ExecutionEvidence[] = [
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'oracle changed',
        paths: ['src/main/x.test.ts'],
        pathFingerprints: { 'src/main/x.test.ts': 'changed' }
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'green',
        command: TRUSTED_ORACLE.command,
        exitCode: 0
      }
    ]

    attestIsolatedVerificationEvidence(mixed, true, [TRUSTED_ORACLE])
    attestIsolatedVerificationEvidence(oracleMutation, true, [
      { ...TRUSTED_ORACLE, covers: [...TRUSTED_ORACLE.covers, 'src/main/x.test.ts'] }
    ])

    expect(mixed[1].oracleAttestation).toBeUndefined()
    expect(oracleMutation[1].oracleAttestation).toBeUndefined()
  })

  it('refuse une altération shell sans chemin même si oracle est restauré avant le snapshot final', () => {
    const evidence: ExecutionEvidence[] = [
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'failed',
        ok: false,
        summary: 'red',
        command: TRUSTED_ORACLE.command,
        exitCode: 1
      },
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: "Set-Content src/main/x.test.ts 'expect(true)'",
        exit_code: 0
      }),
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'covered production mutation',
        paths: ['src/main/x.ts'],
        pathFingerprints: { 'src/main/x.ts': 'sha-after' }
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'green one',
        command: TRUSTED_ORACLE.command,
        exitCode: 0
      },
      {
        type: 'command_execution',
        kind: 'verification',
        status: 'completed',
        ok: true,
        summary: 'green two',
        command: TRUSTED_ORACLE.command,
        exitCode: 0
      },
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: 'git restore src/main/x.test.ts',
        exit_code: 0
      })
    ]

    attestIsolatedVerificationEvidence(evidence, true, [TRUSTED_ORACLE])

    for (const item of evidence.filter((entry) => entry.kind === 'verification')) {
      expect(item.oracleStable).not.toBe(true)
      expect(item.oracleAttestation).toBeUndefined()
    }
  })

  it.each([
    [
      'python inspection',
      `python -c "from pathlib import Path; Path('src/main/x.test.ts').write_text('skip')"`,
      `python -c "from pathlib import Path; Path('src/main/x.test.ts').write_text('restored')"`
    ],
    [
      'node verification',
      `node -e "require('fs').writeFileSync('src/main/x.test.ts','skip')"`,
      `node -e "require('fs').writeFileSync('src/main/x.test.ts','restored')"`
    ],
    [
      'PowerShell nested substitution',
      `rg "$(Set-Content src/main/x.test.ts 'skip')" src/main/x.ts`,
      `rg "$(git restore src/main/x.test.ts)" src/main/x.ts`
    ],
    [
      'git read verb with output option',
      'git diff --output=src/main/x.test.ts',
      'git show --output=src/main/x.test.ts HEAD:src/main/x.test.ts'
    ],
    [
      'git external helper option',
      'git diff --ext-diff',
      'git show --textconv HEAD:src/main/x.test.ts'
    ],
    [
      'environment-prefixed reader',
      'env RIPGREP_CONFIG_PATH=mutating.conf rg failure src/main/x.ts',
      'env GIT_EXTERNAL_DIFF=restorer git diff'
    ],
    [
      'cmd environment-prefixed reader',
      'set RIPGREP_CONFIG_PATH=mutating.conf rg failure src/main/x.ts',
      'set GIT_EXTERNAL_DIFF=restorer git diff'
    ],
    [
      'nested environment after neutral launcher',
      'sudo env RIPGREP_CONFIG_PATH=mutating.conf rg failure src/main/x.ts',
      'time env GIT_EXTERNAL_DIFF=restorer git diff'
    ],
    [
      'environment inside inline shell launcher',
      'bash -c "env RIPGREP_CONFIG_PATH=mutating.conf rg failure src/main/x.ts"',
      'cmd /c "set GIT_EXTERNAL_DIFF=restorer git diff"'
    ]
  ])('refuse un mutateur inconnu classé %s', (_label, mutate, restore) => {
    const evidence: ExecutionEvidence[] = [
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'failed',
        command: TRUSTED_ORACLE.command,
        exit_code: 1
      }),
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: mutate,
        exit_code: 0
      }),
      {
        type: 'workspace_delta',
        kind: 'mutation',
        status: 'completed',
        ok: true,
        summary: 'covered production mutation',
        paths: ['src/main/x.ts'],
        pathFingerprints: { 'src/main/x.ts': 'sha-after' }
      },
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: TRUSTED_ORACLE.command,
        exit_code: 0
      }),
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: TRUSTED_ORACLE.command,
        exit_code: 0
      }),
      ...codexExecutionEvidenceFromItem({
        type: 'command_execution',
        status: 'completed',
        command: restore,
        exit_code: 0
      })
    ]

    attestIsolatedVerificationEvidence(evidence, true, [TRUSTED_ORACLE])

    expect(evidence.find((item) => item.command === mutate)?.kind).toBeDefined()
    for (const item of evidence.filter((entry) => entry.command === TRUSTED_ORACLE.command)) {
      expect(item.oracleAttestation).toBeUndefined()
    }
  })

  it('ouvre réellement la publication du supervisor avec les preuves Codex de production', async () => {
    const evidence = attestIsolatedVerificationEvidence(
      [
        ...codexExecutionEvidenceFromItem({
          type: 'command_execution',
          status: 'failed',
          command: 'npx vitest run x.test.ts',
          exit_code: 1
        }),
        {
          type: 'workspace_delta',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'snapshot diff',
          paths: ['src/x.ts'],
          pathFingerprints: { 'src/x.ts': 'sha-after' }
        },
        ...codexExecutionEvidenceFromItem({
          type: 'command_execution',
          status: 'completed',
          command: 'npx vitest run x.test.ts',
          exit_code: 0
        }),
        ...codexExecutionEvidenceFromItem({
          type: 'command_execution',
          status: 'completed',
          command: 'npx vitest run x.test.ts',
          exit_code: 0
        })
      ],
      true,
      [
        {
          command: 'npx vitest run x.test.ts',
          covers: ['src/x.ts'],
          attestedFiles: ['x.test.ts'],
          attestation: 'manifest:x'
        }
      ]
    )
    const ledger = new OutcomeLearningLedger(
      join(mkdtempSync(join(tmpdir(), 'provider-learning-')), 'events.jsonl')
    )
    const promote = vi.fn(() => ({ to: 'knowledge/domain/autowin-os-proof.md' }))
    const supervisor = new OutcomeLearningSupervisor({ ledger, mode: 'auto', promote })
    const proposal = {
      outcome: 'success' as const,
      title: 'Oracle Vitest reproductible',
      body: 'Le test ciblé passe deux fois après la mutation.',
      type: 'lesson' as const,
      scope: 'autowin-os',
      tags: [] as string[],
      confidence: 'high' as const
    }
    supervisor.recordProposal({
      conversationId: 'conv',
      turnId: 'turn',
      runId: 'run',
      ...proposal,
      source: 'session:turn',
      candidateId: 'inbox/proof.md',
      stored: true,
      truncated: false
    })

    const result = await supervisor.observeOutcome({
      conversationId: 'conv',
      turnId: 'turn',
      runId: 'run',
      workspace: 'C:/repo',
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      evidence,
      attestedProposalHashes: [learningProposalAttestation(proposal)],
      independentProposalAttestations: [
        createIndependentLearningAttestation(
          learningProposalAttestation(proposal),
          'run',
          'judge:test'
        )
      ]
    })

    expect(result.state).toBe('published')
    expect(promote).toHaveBeenCalledOnce()
  })
})
