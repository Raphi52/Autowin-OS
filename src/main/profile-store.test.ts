import { describe, expect, it } from 'vitest'
import { resolveProfileRoute } from './profile-store'

describe('profile transport migration', () => {
  it('normalise un ancien profil direct vers la route OmniRoute courante', () => {
    expect(resolveProfileRoute({ mode: 'direct' }, 'auto/coding')).toBe('auto/coding')
  })

  it('conserve une route OmniRoute explicitement enregistrée', () => {
    expect(resolveProfileRoute({ mode: 'omniroute', routeModel: 'auto/cheap' }, 'auto/coding')).toBe(
      'auto/cheap'
    )
  })
})
