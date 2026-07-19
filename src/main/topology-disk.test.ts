import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_IMPORTED_MODELS } from './models'
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
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const codex = DEFAULT_IMPORTED_MODELS.find((model) => model.provider === 'codex')!
    const changed = setSlot(
      base,
      'judge',
      bindingForModel('judge-2', codex),
      DEFAULT_IMPORTED_MODELS
    )

    saveAgentTopology(path, changed, DEFAULT_IMPORTED_MODELS)

    expect(loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)).toEqual(changed)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(changed)
  })

  it('falls back to a valid default when persisted JSON is corrupt', () => {
    const path = temporaryFile()
    writeFileSync(path, '{broken', 'utf8')

    expect(loadAgentTopology(path, DEFAULT_IMPORTED_MODELS)).toEqual(
      createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    )
  })

  it('rejects an unbounded panel before persistence', () => {
    const path = temporaryFile()
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const model = DEFAULT_IMPORTED_MODELS[0]
    const oversized = {
      ...base,
      subagents: Array.from({ length: 17 }, (_, index) =>
        bindingForModel(`subagent-${index + 1}`, model)
      )
    }

    expect(() => saveAgentTopology(path, oversized, DEFAULT_IMPORTED_MODELS)).toThrow(
      '16 slots maximum'
    )
  })
})
