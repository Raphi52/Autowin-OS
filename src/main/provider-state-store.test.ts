import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderStateStore } from './provider-state-store'

const roots: string[] = []

function fixture(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'autowin-provider-state-'))
  roots.push(root)
  return { root, path: join(root, 'provider-state.json') }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ProviderStateStore', () => {
  it('refuse un chemin implicite pour ne jamais fuiter entre profils Electron', () => {
    expect(() => new ProviderStateStore()).toThrow('Chemin du store provider requis.')
  })

  it('met Kimi en standby par défaut sans masquer Claude ou Codex', () => {
    const { path } = fixture()
    const store = new ProviderStateStore(path)

    expect(store.get('kimi')).toEqual({ mode: 'standby' })
    expect(store.get('claude')).toEqual({ mode: 'active' })
    expect(store.get('codex')).toEqual({ mode: 'active' })
  })

  it('persiste le mode et le dernier probe réel entre deux démarrages', () => {
    const { path } = fixture()
    const first = new ProviderStateStore(path)

    first.setMode('kimi', 'active')
    first.recordProbe('kimi', 'authenticated', 1_700_000_000_000)

    expect(new ProviderStateStore(path).get('kimi')).toEqual({
      mode: 'active',
      lastProbe: { status: 'authenticated', checkedAt: 1_700_000_000_000 }
    })
  })

  it('retombe sur les défauts si le fichier est corrompu', () => {
    const { path } = fixture()
    writeFileSync(path, '{cassé', 'utf8')

    expect(new ProviderStateStore(path).get('kimi')).toEqual({ mode: 'standby' })
  })
})
