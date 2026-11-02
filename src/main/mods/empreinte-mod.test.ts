import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { empreinteMod, lecteurVersionMod } from './empreinte-mod'
import { CostAggregator } from '../dashboards/cost'

function mod(): string {
  const d = mkdtempSync(join(tmpdir(), 'mod-'))
  mkdirSync(join(d, 'hooks'))
  writeFileSync(join(d, 'hooks', 'a.js'), 'x')
  return d
}

describe('version du mod sur cost.jsonl', () => {
  it("l'empreinte change quand un fichier du mod change, et seulement alors", () => {
    const d = mod()
    const v1 = empreinteMod(d)
    expect(v1).toMatch(/^[0-9a-f]{12}$/)
    expect(empreinteMod(d)).toBe(v1)
    writeFileSync(join(d, 'hooks', 'a.js'), 'y')
    expect(empreinteMod(d)).not.toBe(v1)
    expect(empreinteMod(join(d, 'absent'))).toBeUndefined()
  })

  it('chaque ligne écrite porte la version du mod du moment : avant/après une modif', async () => {
    const d = mod()
    let t = 0
    const path = join(mkdtempSync(join(tmpdir(), 'cost-mod-')), 'cost.jsonl')
    const agg = new CostAggregator(undefined, path, lecteurVersionMod(() => d, 1000, () => t))
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 0.1 })
    writeFileSync(join(d, 'hooks', 'a.js'), 'modifié')
    t = 5000
    agg.add({ provider: 'claude', inputTokens: 1, outputTokens: 1, costUsd: 0.2 })
    await agg.flushPersist()
    const [a, b] = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(a.modVersion).toMatch(/^[0-9a-f]{12}$/)
    expect(b.modVersion).toMatch(/^[0-9a-f]{12}$/)
    expect(a.modVersion).not.toBe(b.modVersion)
  })
})
