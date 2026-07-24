import { describe, expect, it } from 'vitest'
import { resolveVerifyReplayConfig } from './verify-replay-config'

describe('resolveVerifyReplayConfig (env AUTOWIN_VERIFY_REPLAY)', () => {
  it('absent / vide / off → dormant', () => {
    expect(resolveVerifyReplayConfig(undefined)).toEqual({})
    expect(resolveVerifyReplayConfig('')).toEqual({})
    expect(resolveVerifyReplayConfig('off')).toEqual({})
    expect(resolveVerifyReplayConfig('OFF')).toEqual({})
  })

  it('auto → autoVerify (convention workspace)', () => {
    expect(resolveVerifyReplayConfig('auto')).toEqual({ autoVerify: true })
    expect(resolveVerifyReplayConfig(' Auto ')).toEqual({ autoVerify: true })
  })

  it('commande explicite → verifyCmd', () => {
    expect(resolveVerifyReplayConfig('npm run test:ci')).toEqual({ verifyCmd: 'npm run test:ci' })
  })
})
