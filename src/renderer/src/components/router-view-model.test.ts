import { describe, expect, it } from 'vitest'
import { connectionIdentity, statusLabel } from './router-view-model'

describe('Router view model', () => {
  it('uses the account label and email without inventing an identity', () => {
    expect(connectionIdentity({ label: 'Travail', email: 'a@b.test' })).toBe('Travail · a@b.test')
    expect(connectionIdentity({ label: 'Travail' })).toBe('Travail')
    expect(connectionIdentity({})).toBe('Compte sans nom')
  })

  it('labels every supervision state explicitly', () => {
    expect(statusLabel('healthy')).toBe('Opérationnel')
    expect(statusLabel('unavailable')).toBe('Non connecté')
    expect(statusLabel('degraded')).toBe('Dégradé')
  })
})
