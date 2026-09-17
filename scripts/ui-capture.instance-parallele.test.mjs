import { describe, expect, it } from 'vitest'
import { instanceIdUiCapture } from './ui-capture.mjs'

describe('identifiant d instance de ui-capture', () => {
  it('est propre au processus : deux travaux paralleles ne se disputent pas le meme bureau cache', () => {
    expect(instanceIdUiCapture(['--view', 'chat'], 111)).toBe('ui-capture-111')
    expect(instanceIdUiCapture(['--view', 'chat'], 222)).toBe('ui-capture-222')
    expect(instanceIdUiCapture(['--view', 'chat'], 111)).not.toBe(
      instanceIdUiCapture(['--view', 'chat'], 222)
    )
  })

  it('respecte un identifiant explicite', () => {
    expect(instanceIdUiCapture(['--instance-id', 'preuve-x'], 111)).toBe('preuve-x')
  })

  it('ignore un --instance-id sans valeur', () => {
    expect(instanceIdUiCapture(['--instance-id', '--view', 'chat'], 111)).toBe('ui-capture-111')
  })
})
