import { describe, expect, it } from 'vitest'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'

describe('discipline de pipeline canonique', () => {
  it('nomme les six phases dans l ordre et reste autonome', () => {
    const phases = ['SCOUT', 'FRAME', 'TERRAIN', 'BUILD', 'CLEAN', 'JUDGE']
    const positions = phases.map((phase) => PIPELINE_DISCIPLINE_INSTRUCTION.indexOf(phase))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(
      /~\/[.]claude|Audit\/workspaces|fingerprint[.]py/i
    )
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toContain('capacités réellement disponibles')
  })
})
