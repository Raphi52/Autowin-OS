import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

function requireString(value, label, defects) {
  if (typeof value !== 'string' || value.trim() === '') defects.push(`${label} absent`)
}

function requireExact(value, expected, label, defects) {
  if (value !== expected) defects.push(`${label}: attendu ${expected}, reçu ${String(value)}`)
}

function requireAtLeast(value, minimum, label, defects) {
  if (!Number.isInteger(value) || value < minimum) {
    defects.push(`${label}: attendu >= ${minimum}, reçu ${String(value)}`)
  }
}

export function validateTaskManagerProof(proof, options = {}) {
  const defects = []
  const root = resolve(options.root ?? process.cwd())

  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, defects: ['preuve JSON invalide'] }
  }

  requireString(proof.runId, 'runId', defects)
  requireString(proof.sentinel, 'sentinel', defects)
  requireString(proof.occurrenceId, 'occurrenceId', defects)
  requireString(proof.executableSha256, 'executableSha256', defects)
  requireExact(proof.packageFresh, true, 'packageFresh', defects)

  const capturedAt = Date.parse(proof.capturedAt)
  if (!Number.isFinite(capturedAt)) defects.push('capturedAt invalide')

  const relay = proof.relay ?? {}
  requireExact(relay.wakeToRun, true, 'relay.wakeToRun', defects)
  requireExact(relay.startWhenAvailable, false, 'relay.startWhenAvailable', defects)
  requireExact(relay.multipleInstances, 'IgnoreNew', 'relay.multipleInstances', defects)

  const observed = proof.observed ?? {}
  requireExact(observed.processSurvivedWindowClose, true, 'processSurvivedWindowClose', defects)
  requireExact(observed.appRestartRoundTrip, true, 'appRestartRoundTrip', defects)
  requireExact(observed.persistedUserMessageCount, 1, 'persistedUserMessageCount', defects)
  requireExact(observed.persistedAssistantTurnCount, 1, 'persistedAssistantTurnCount', defects)
  requireExact(observed.renderedUserMessageCount, 1, 'renderedUserMessageCount', defects)
  requireExact(observed.renderedAssistantTurnCount, 1, 'renderedAssistantTurnCount', defects)
  requireExact(observed.occurrenceClaimCount, 1, 'occurrenceClaimCount', defects)
  requireExact(observed.occurrenceExecutionCount, 1, 'occurrenceExecutionCount', defects)
  requireAtLeast(observed.assistantActionCount, 1, 'assistantActionCount', defects)
  if (!TERMINAL_STATUSES.has(observed.assistantStatus)) {
    defects.push(`assistantStatus non terminal: ${String(observed.assistantStatus)}`)
  }

  const artifacts = Array.isArray(proof.artifacts) ? proof.artifacts : []
  if (artifacts.length < 2) defects.push('artifacts: JSON et PNG frais requis')
  for (const artifact of artifacts) {
    if (typeof artifact !== 'string' || artifact.trim() === '') {
      defects.push('artifact invalide')
      continue
    }
    const path = resolve(root, artifact)
    if (!existsSync(path)) {
      defects.push(`artifact absent: ${path}`)
      continue
    }
    if (proof.runId && !path.includes(proof.runId)) {
      defects.push(`artifact non lié au runId: ${path}`)
    }
    if (Number.isFinite(capturedAt) && statSync(path).mtimeMs + 1000 < capturedAt) {
      defects.push(`artifact antérieur au run: ${path}`)
    }
  }

  return { ok: defects.length === 0, defects }
}

async function main() {
  const proofIndex = process.argv.indexOf('--proof')
  if (proofIndex < 0 || !process.argv[proofIndex + 1]) {
    throw new Error('Usage: node scripts/task-manager-proof-validator.mjs --proof <proof.json>')
  }
  const proofPath = resolve(process.argv[proofIndex + 1])
  const { readFile } = await import('node:fs/promises')
  const proof = JSON.parse(await readFile(proofPath, 'utf8'))
  const result = validateTaskManagerProof(proof, { root: resolve(proofPath, '..') })
  process.stdout.write(`${JSON.stringify({ proofPath, ...result })}\n`)
  if (!result.ok) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
