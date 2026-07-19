import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LoopEvent, LoopRunInput } from './loop-runner'

export interface StoredLoopRun {
  runId: string
  startedAt: string
  finishedAt?: string
  input: LoopRunInput
  events: LoopEvent[]
  completed: number
  failed: number
}

export class LoopRunStore {
  constructor(private readonly path: string) {}

  list(): StoredLoopRun[] {
    if (!existsSync(this.path)) return []
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as StoredLoopRun[]
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  save(run: StoredLoopRun): void {
    const runs = this.list().filter((item) => item.runId !== run.runId)
    runs.unshift(run)
    mkdirSync(join(this.path, '..'), { recursive: true })
    writeFileSync(this.path, JSON.stringify(runs.slice(0, 100), null, 2), 'utf8')
  }
}
