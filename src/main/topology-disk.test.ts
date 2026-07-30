import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEST_MODEL_CATALOG } from './models.fixture'
import { createDefaultTopology, setSlot, bindingForModel } from './topology'
import { loadAgentTopology, saveAgentTopology } from './topology-disk'

const directories: string[] = []

function temporaryFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'autowin-topology-'))
  directories.push(directory)
  return join(directory, 'agent-topology.json')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('agent topology disk persistence', () => {
  it('round-trips the validated topology atomically', () => {
    const path = temporaryFile()
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const changed = setSlot(
      base,
      'judge',
      bindingForModel('judge-2', codex),
      TEST_MODEL_CATALOG
    )

    saveAgentTopology(path, changed, TEST_MODEL_CATALOG)

    expect(loadAgentTopology(path, TEST_MODEL_CATALOG)).toEqual(changed)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(changed)
  })

  it('falls back to a valid default when persisted JSON is corrupt', () => {
    const path = temporaryFile()
    writeFileSync(path, '{broken', 'utf8')

    expect(loadAgentTopology(path, TEST_MODEL_CATALOG)).toEqual(
      createDefaultTopology(TEST_MODEL_CATALOG)
    )
  })

  it('rejects an unbounded panel before persistence', () => {
    const path = temporaryFile()
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const model = TEST_MODEL_CATALOG[0]
    const oversized = {
      ...base,
      subagents: Array.from({ length: 17 }, (_, index) =>
        bindingForModel(`subagent-${index + 1}`, model)
      )
    }

    expect(() => saveAgentTopology(path, oversized, TEST_MODEL_CATALOG)).toThrow(
      '16 slots maximum'
    )
  })
})
