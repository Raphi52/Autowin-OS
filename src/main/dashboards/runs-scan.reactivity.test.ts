import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanRuns } from './runs-scan'

const roots: string[] = []

function fixture(count: number): string {
  const root = mkdtempSync(join(tmpdir(), 'autowin-runs-reactivity-'))
  roots.push(root)
  for (let i = 0; i < count; i++) {
    const workspace = join(root, `session-${i}`, `subject-${i}-workspace`)
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'RUN.md'), `status: open\n## Besoin\n- [ ] item ${i}\n`)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('scanRuns responsiveness', () => {
  it('rend la main à la boucle d’événements pendant le scan', async () => {
    const root = fixture(12)
    let timerFired = false
    setTimeout(() => {
      timerFired = true
    }, 0)

    await scanRuns(root, { limit: 3 })

    expect(timerFired).toBe(true)
  })

  it('respecte la limite demandée', async () => {
    const entries = await scanRuns(fixture(12), { limit: 3 })

    expect(entries).toHaveLength(3)
  })
})
