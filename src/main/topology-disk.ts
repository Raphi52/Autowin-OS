import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImportedModel } from './models'
import {
  assertTopology,
  createDefaultTopology,
  migrateTopologyShape,
  type AgentTopology
} from './topology'

export function loadAgentTopology(path: string, models: ImportedModel[]): AgentTopology {
  try {
    const parsed = migrateTopologyShape(JSON.parse(readFileSync(path, 'utf8'))) as AgentTopology
    return assertTopology(parsed, models)
  } catch {
    return createDefaultTopology(models)
  }
}

export function saveAgentTopology(
  path: string,
  topology: AgentTopology,
  models: ImportedModel[]
): AgentTopology {
  const validated = assertTopology(topology, models)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(validated, null, 2), 'utf8')
  renameSync(temporary, path)
  return validated
}
