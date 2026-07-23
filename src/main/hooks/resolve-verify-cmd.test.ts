import { describe, expect, it } from 'vitest'
import { resolveVerifyCmd } from './resolve-verify-cmd'

describe('resolveVerifyCmd', () => {
  it('package.json avec scripts.test → npm test', () => {
    const read = () => JSON.stringify({ scripts: { test: 'vitest run' } })
    expect(resolveVerifyCmd('/w', read)).toBe('npm test')
  })

  it('package.json SANS scripts.test → undefined (dormant)', () => {
    const read = () => JSON.stringify({ scripts: { build: 'tsc' } })
    expect(resolveVerifyCmd('/w', read)).toBeUndefined()
  })

  it('script test vide → undefined', () => {
    const read = () => JSON.stringify({ scripts: { test: '   ' } })
    expect(resolveVerifyCmd('/w', read)).toBeUndefined()
  })

  it('pas de package.json → undefined', () => {
    expect(resolveVerifyCmd('/w', () => null)).toBeUndefined()
  })

  it('package.json invalide → undefined (jamais throw)', () => {
    expect(resolveVerifyCmd('/w', () => '{ not json')).toBeUndefined()
  })
})
