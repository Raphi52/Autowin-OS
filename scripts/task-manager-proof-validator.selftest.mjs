import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateTaskManagerProof } from './task-manager-proof-validator.mjs'

const root = mkdtempSync(join(tmpdir(), 'autowin-task-proof-'))
const runId = `TASK-E2E-${Date.now()}`

try {
  const png = `${runId}.png`
  const json = `${runId}.json`
  writeFileSync(join(root, png), 'png-fixture')
  writeFileSync(join(root, json), '{"fixture":true}')

  const valid = {
    runId,
    capturedAt: new Date(Date.now() - 100).toISOString(),
    sentinel: `sentinel-${runId}`,
    occurrenceId: `occurrence-${runId}`,
    executableSha256: 'fixture-sha256',
    packageFresh: true,
    relay: {
      wakeToRun: true,
      startWhenAvailable: false,
      multipleInstances: 'IgnoreNew'
    },
    observed: {
      processSurvivedWindowClose: true,
      appRestartRoundTrip: true,
      persistedUserMessageCount: 1,
      persistedAssistantTurnCount: 1,
      renderedUserMessageCount: 1,
      renderedAssistantTurnCount: 1,
      occurrenceClaimCount: 1,
      occurrenceExecutionCount: 1,
      assistantActionCount: 1,
      assistantStatus: 'completed'
    },
    artifacts: [png, json]
  }

  assert.deepEqual(validateTaskManagerProof(valid, { root }), { ok: true, defects: [] })

  const duplicate = structuredClone(valid)
  duplicate.observed.persistedUserMessageCount = 2
  duplicate.observed.occurrenceExecutionCount = 2
  const duplicateResult = validateTaskManagerProof(duplicate, { root })
  assert.equal(duplicateResult.ok, false)
  assert(duplicateResult.defects.some((defect) => defect.includes('persistedUserMessageCount')))
  assert(duplicateResult.defects.some((defect) => defect.includes('occurrenceExecutionCount')))

  const invisible = structuredClone(valid)
  invisible.observed.renderedAssistantTurnCount = 0
  invisible.observed.assistantStatus = 'streaming'
  const invisibleResult = validateTaskManagerProof(invisible, { root })
  assert.equal(invisibleResult.ok, false)
  assert(invisibleResult.defects.some((defect) => defect.includes('renderedAssistantTurnCount')))
  assert(invisibleResult.defects.some((defect) => defect.includes('assistantStatus')))

  process.stdout.write(
    `${JSON.stringify({ ok: true, controls: ['valid', 'duplicate-rejected', 'incomplete-rejected'] })}\n`
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
