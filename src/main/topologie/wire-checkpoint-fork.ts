export interface SourceSnapshot {
  readonly workspaceId: string
  readonly baseSha: string
  readonly contentHash: string
}

export interface PersistedCheckpoint<State> {
  readonly id: string
  readonly runId: string
  readonly createdAt: string
  readonly sourceSnapshot: SourceSnapshot
  readonly state: State
}

export type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value

export interface CheckpointForkManifest<State> {
  readonly schema: 'autowin.checkpoint-fork/v1'
  readonly id: string
  readonly createdAt: string
  readonly ancestor: {
    readonly checkpointId: string
    readonly runId: string
    readonly checkpointCreatedAt: string
  }
  readonly sourceSnapshot: DeepReadonly<SourceSnapshot>
  readonly branchState: DeepReadonly<State>
}

export interface CreateCheckpointForkRequest<State> {
  readonly checkpointId: string
  readonly forkId: string
  readonly createdAt: string
  readonly deriveState?: (checkpointState: State) => State
}

export type CheckpointForkErrorCode =
  'CHECKPOINT_ID_MISSING' | 'CHECKPOINT_NOT_FOUND' | 'FORK_ID_MISSING'

export class CheckpointForkError extends Error {
  constructor(
    readonly code: CheckpointForkErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CheckpointForkError'
  }
}

function clone<Value>(value: Value): Value {
  return structuredClone(value)
}

function deepFreeze<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<Value>
}

export function createCheckpointForkManifest<State>(
  checkpoints: readonly PersistedCheckpoint<State>[],
  request: CreateCheckpointForkRequest<State>
): CheckpointForkManifest<State> {
  if (!request.checkpointId.trim()) {
    throw new CheckpointForkError(
      'CHECKPOINT_ID_MISSING',
      'Un identifiant de checkpoint est requis.'
    )
  }
  if (!request.forkId.trim()) {
    throw new CheckpointForkError('FORK_ID_MISSING', 'Un identifiant de fork est requis.')
  }

  const checkpoint = checkpoints.find((candidate) => candidate.id === request.checkpointId)
  if (!checkpoint) {
    throw new CheckpointForkError(
      'CHECKPOINT_NOT_FOUND',
      `Checkpoint inconnu : ${request.checkpointId}`
    )
  }

  const checkpointState = clone(checkpoint.state)
  const branchState = request.deriveState ? request.deriveState(checkpointState) : checkpointState
  const manifest: CheckpointForkManifest<State> = {
    schema: 'autowin.checkpoint-fork/v1',
    id: request.forkId,
    createdAt: request.createdAt,
    ancestor: {
      checkpointId: checkpoint.id,
      runId: checkpoint.runId,
      checkpointCreatedAt: checkpoint.createdAt
    },
    sourceSnapshot: clone(checkpoint.sourceSnapshot),
    branchState: clone(branchState) as DeepReadonly<State>
  }

  return deepFreeze(manifest) as CheckpointForkManifest<State>
}
