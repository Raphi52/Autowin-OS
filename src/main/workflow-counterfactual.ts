import { createHash } from 'node:crypto'
import type { WorkflowComparisonRow } from './workflow-comparison'
import {
  createCheckpointForkManifest,
  type CheckpointForkManifest,
  type PersistedCheckpoint,
  type SourceSnapshot
} from './wire-checkpoint-fork'

export interface CounterfactualCheckpointState {
  objective: string
  dirty: boolean
  profileId?: string | null
  profileName?: string
}

export interface CounterfactualRisk {
  code:
    | 'run-red'
    | 'proof-failed'
    | 'proof-unknown'
    | 'cost-unknown'
    | 'workspace-missing'
    | 'base-diverged'
    | 'source-dirty'
    | 'content-state-missing'
  severity: 'warning' | 'blocking'
  detail: string
}

export interface CounterfactualArm {
  profileId: string
  profileName: string
  fork: CheckpointForkManifest<CounterfactualCheckpointState>
  costUsd: number | null
  durationMs: number | null
  changedFiles: string[]
  fileDigests: Record<string, string | null>
  resultDigest: string
  risks: CounterfactualRisk[]
  verdict: 'eligible' | 'inconclusive' | 'rejected'
}

export interface WorkflowCounterfactualRecord {
  schema: 'autowin.workflow-counterfactual/v1'
  objective: string
  checkpointId: string
  sourceSnapshot: SourceSnapshot
  arms: CounterfactualArm[]
  diff: {
    sharedFiles: string[]
    onlyByProfile: Record<string, string[]>
    differingSharedFiles: string[]
    sameResult: boolean
  }
  verdict: {
    winnerProfileId?: string
    rationale: string
  }
}

export interface CounterfactualRecordInput {
  objective: string
  checkpoint: PersistedCheckpoint<CounterfactualCheckpointState>
  rows: readonly WorkflowComparisonRow[]
  results: ReadonlyMap<string, string>
  recommendedProfileId?: string
  qualityWinnerProfileId?: string | null
  createdAt: string
  workspaceStates?: ReadonlyMap<string, Record<string, string | null>>
}

function profileKey(profileId: string): string {
  return profileId || 'current'
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function risksFor(
  row: WorkflowComparisonRow,
  checkpoint: PersistedCheckpoint<CounterfactualCheckpointState>
): CounterfactualRisk[] {
  const risks: CounterfactualRisk[] = []
  if (!row.green) {
    risks.push({ code: 'run-red', severity: 'blocking', detail: 'Le run ne cloture pas vert.' })
  }
  if (row.proofStatus === 'failed') {
    risks.push({
      code: 'proof-failed',
      severity: 'blocking',
      detail: 'Au moins une preuve executable est rouge.'
    })
  } else if (row.proofStatus !== 'passed') {
    risks.push({
      code: 'proof-unknown',
      severity: 'warning',
      detail: 'Aucune preuve executable verte ne permet de conclure.'
    })
  }
  if (row.comparableCostUsd === null) {
    risks.push({
      code: 'cost-unknown',
      severity: 'warning',
      detail: 'Le cout complet de ce bras est inconnu.'
    })
  }
  if (!row.retainedWorkspace) {
    risks.push({
      code: 'workspace-missing',
      severity: 'blocking',
      detail: 'Aucun bureau isole conserve ne permet de relire ce bras.'
    })
  } else if (row.retainedWorkspace.baseSha !== checkpoint.sourceSnapshot.baseSha) {
    risks.push({
      code: 'base-diverged',
      severity: 'blocking',
      detail: 'Le bras ne part pas du SHA fige par le checkpoint.'
    })
  }
  if (checkpoint.state.dirty) {
    risks.push({
      code: 'source-dirty',
      severity: 'warning',
      detail: 'Le workspace source contenait des modifications non commitees.'
    })
  }
  return risks
}

export function buildWorkflowCounterfactual(
  input: CounterfactualRecordInput
): WorkflowCounterfactualRecord {
  if (input.rows.length !== 2) {
    throw new Error('Un contrefactuel exige exactement deux workflows.')
  }

  const arms = input.rows.map((row) => {
    const risks = risksFor(row, input.checkpoint)
    const fork = createCheckpointForkManifest([input.checkpoint], {
      checkpointId: input.checkpoint.id,
      forkId: `counterfactual:${profileKey(row.profileId)}`,
      createdAt: input.createdAt,
      deriveState: (state) => ({
        ...state,
        profileId: row.profileId || null,
        profileName: row.profileName
      })
    })
    const fileDigests = input.workspaceStates?.get(row.profileId) ?? {}
    if (row.retainedWorkspace && Object.keys(fileDigests).length === 0) {
      risks.push({
        code: 'content-state-missing',
        severity: 'blocking',
        detail: 'Le contenu du bureau retenu n’a pas pu être empreinté.'
      })
    }
    const blocking = risks.some((risk) => risk.severity === 'blocking')
    const inconclusive = risks.some((risk) => risk.code === 'proof-unknown')
    return {
      profileId: row.profileId,
      profileName: row.profileName,
      fork,
      costUsd: row.comparableCostUsd,
      durationMs: row.durationMs ?? null,
      changedFiles: [...(row.retainedWorkspace?.files ?? [])].sort(),
      fileDigests,
      resultDigest: digest(input.results.get(row.profileId) ?? ''),
      risks,
      verdict: blocking
        ? ('rejected' as const)
        : inconclusive
          ? ('inconclusive' as const)
          : ('eligible' as const)
    }
  })

  const firstFiles = new Set(arms[0].changedFiles)
  const secondFiles = new Set(arms[1].changedFiles)
  const sharedFiles = [...firstFiles].filter((file) => secondFiles.has(file)).sort()
  const onlyByProfile = Object.fromEntries(
    arms.map((arm, index) => {
      const other = index === 0 ? secondFiles : firstFiles
      return [profileKey(arm.profileId), arm.changedFiles.filter((file) => !other.has(file))]
    })
  )
  const differingSharedFiles = sharedFiles.filter(
    (file) => arms[0].fileDigests[file] !== arms[1].fileDigests[file]
  )

  const eligibleIds = new Set(
    arms.filter((arm) => arm.verdict === 'eligible').map((arm) => arm.profileId)
  )
  const quality = input.qualityWinnerProfileId ?? undefined
  const winnerProfileId =
    quality !== undefined && eligibleIds.has(quality)
      ? quality
      : input.recommendedProfileId !== undefined && eligibleIds.has(input.recommendedProfileId)
        ? input.recommendedProfileId
        : eligibleIds.size === 1
          ? [...eligibleIds][0]
          : undefined
  const rationale =
    winnerProfileId !== undefined
      ? `${arms.find((arm) => arm.profileId === winnerProfileId)?.profileName ?? winnerProfileId} est retenu parmi les bras comparables sur le meme checkpoint.`
      : 'Aucun verdict decisif : les deux bras ne sont pas simultanement comparables et attestes.'

  return {
    schema: 'autowin.workflow-counterfactual/v1',
    objective: input.objective,
    checkpointId: input.checkpoint.id,
    sourceSnapshot: structuredClone(input.checkpoint.sourceSnapshot),
    arms,
    diff: {
      sharedFiles,
      onlyByProfile,
      differingSharedFiles,
      sameResult: arms[0].resultDigest === arms[1].resultDigest
    },
    verdict: {
      ...(winnerProfileId !== undefined ? { winnerProfileId } : {}),
      rationale
    }
  }
}
