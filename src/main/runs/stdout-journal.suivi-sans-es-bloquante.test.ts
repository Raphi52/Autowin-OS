import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Gel mesuré (gels.jsonl, 300 derniers) : 47 gels du fil principal viennent de `readChunkFrom`
// appelé par la boucle de `tailJsonLines` — openSync/readSync toutes les 120 ms par tour suivi.
vi.mock('node:fs', async (orig) => {
  const reel = await orig<typeof import('node:fs')>()
  return { ...reel, openSync: vi.fn(reel.openSync), readSync: vi.fn(reel.readSync) }
})

import { tailJsonLines } from './stdout-journal'

describe('tailJsonLines — suivi sans E/S bloquante', () => {
  it('lit le journal sans openSync ni readSync', async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'tailasync-'))
    const path = join(dir, 'j.jsonl')
    fs.writeFileSync(path, '{"a":1}\n{"b":2}\n', 'utf8')
    vi.mocked(fs.openSync).mockClear()
    vi.mocked(fs.readSync).mockClear()
    const seen: string[] = []
    const r = await tailJsonLines(path, (l) => seen.push(l), { isComplete: () => true })
    expect(seen).toEqual(['{"a":1}', '{"b":2}'])
    expect(r.offset).toBe(16)
    expect(vi.mocked(fs.openSync)).not.toHaveBeenCalled()
    expect(vi.mocked(fs.readSync)).not.toHaveBeenCalled()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
