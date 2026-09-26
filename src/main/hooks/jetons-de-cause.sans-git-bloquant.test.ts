import { describe, expect, it, vi } from 'vitest'
import { resolve, sep } from 'node:path'

// Gel mesuré (gels.jsonl) : 17 gels du process principal dans `lignesAjouteesAuDernierChangement`,
// qui lançait git en `execFileSync`. Le jeton doit toujours être trouvé, sans appel git bloquant.
vi.mock('node:child_process', async (orig) => {
  const reel = await orig<typeof import('node:child_process')>()
  return { ...reel, execFileSync: vi.fn(reel.execFileSync) }
})

import * as cp from 'node:child_process'
import { jetonsDeCauseParFichier } from './default-gate-hooks'

describe('jetonsDeCauseParFichier — source 3 sans git bloquant', () => {
  it('credite le jeton sur disque sans execFileSync', async () => {
    const cible = resolve(process.cwd(), 'src/main/hooks/default-gate-hooks.ts').split(sep).join('/')
    vi.mocked(cp.execFileSync).mockClear()
    expect(await jetonsDeCauseParFichier(undefined, [], [cible])).toEqual({ [cible]: true })
    expect(vi.mocked(cp.execFileSync)).not.toHaveBeenCalled()
  })
})
