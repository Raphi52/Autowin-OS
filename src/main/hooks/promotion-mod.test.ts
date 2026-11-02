import { describe, expect, it } from 'vitest'
import { creerPromotionModHandler } from './default-gate-hooks'
import type { HookContext } from './hook-bus'

const ANNONCE = 'Corrige: la règle X manquait\nRisque: un shell refusé à tort\n'
const ctx = (over: Partial<HookContext>): HookContext => ({
  event: 'pre-green',
  task: 't',
  cwd: 'D:/copie',
  editsByFile: { 'mods/autowin/hooks/regles.js': 1 },
  evidence: [],
  ...over
})

describe('contrôle de promotion d’un mod (conv-419)', () => {
  it('laisse passer un run qui ne touche pas mods/autowin', async () => {
    const h = creerPromotionModHandler(() => undefined)
    expect(await h(ctx({ editsByFile: { 'src/main/x.ts': 1 } }))).toEqual({ block: false })
  })

  it('refuse sans annonce ni test du mod', async () => {
    const r = await creerPromotionModHandler(() => undefined)(ctx({}))
    expect(r.block).toBe(true)
    expect(r.reason).toMatch(/PROMOTION\.md/)
    expect(r.reason).toMatch(/mod-autowin\.test/)
  })

  it('refuse une annonce sans risque, même avec le test vert', async () => {
    const r = await creerPromotionModHandler(() => 'Corrige: X\n')(
      ctx({ evidence: [{ ok: true, command: 'npx vitest run src/shared/mod-autowin.test.ts' } as never] })
    )
    expect(r.block).toBe(true)
  })

  it('refuse un test du mod en échec, chemin Windows compris', async () => {
    const r = await creerPromotionModHandler(() => ANNONCE)(
      ctx({
        editsByFile: { 'D:\\copie\\mods\\autowin\\hooks\\regles.js': 1 },
        evidence: [{ ok: false, command: 'npx vitest run src/shared/mod-autowin.test.ts' } as never]
      })
    )
    expect(r.block).toBe(true)
  })

  it('accepte annonce complète + test du mod vert', async () => {
    const r = await creerPromotionModHandler(() => ANNONCE)(
      ctx({ evidence: [{ ok: true, command: 'npx vitest run src/shared/mod-autowin.test.ts' } as never] })
    )
    expect(r).toEqual({ block: false })
  })
})
