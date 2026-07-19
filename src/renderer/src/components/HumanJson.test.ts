import { describe, expect, it } from 'vitest'
import { parseJsonValue } from './HumanJson'

describe('HumanJson', () => {
  it('only offers structured rendering for valid JSON values', () => {
    expect(parseJsonValue('{"model":"terra","enabled":true}')).toEqual({ model: 'terra', enabled: true })
    expect(parseJsonValue('plain prompt text')).toBeNull()
  })
})
