import { describe, expect, it } from 'vitest'
import { consigneBureauCache, identifiantBureauCache } from './consigne-bureau-cache'

describe('consigne du bureau caché injectée aux agents de run', () => {
  it('nomme la voie du bureau caché', () => {
    const texte = consigneBureauCache('run-abc123')
    expect(texte).toContain('scripts/hdesk-lancer.ps1')
    expect(texte).toContain('scripts/hdesk-observe.ps1')
  })

  it('dérive un identifiant de bureau du runId — deux runs ne partagent jamais le même', () => {
    expect(identifiantBureauCache('abc123')).toBe('run-abc123')
    expect(identifiantBureauCache('abc123')).not.toBe(identifiantBureauCache('def456'))
    expect(consigneBureauCache('abc123')).toContain('-Id run-abc123')
    expect(consigneBureauCache('abc123')).toContain('-InstanceId run-abc123')
  })

  it('assainit un runId qui porte des caractères de chemin', () => {
    expect(identifiantBureauCache('conv-618/build:1')).toBe('run-conv-618-build-1')
    expect(identifiantBureauCache('///')).toBe('run-sans-id')
  })

  it('ne dit rien sans runId', () => {
    expect(consigneBureauCache('')).toBe('')
    expect(consigneBureauCache('   ')).toBe('')
  })
})
