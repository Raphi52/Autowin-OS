import { describe, expect, it } from 'vitest'
import { diffPayloadLines } from './harness-payload-diff'

describe('diff de payload Harnais', () => {
  it('marque les lignes ajoutees, supprimees et conservees', () => {
    expect(diffPayloadLines('RUN.md\nskill build\nmode high', 'RUN.md\nskill judge\nmode high\ngate on')).toEqual([
      { kind: 'same', left: 'RUN.md', right: 'RUN.md' },
      { kind: 'changed', left: 'skill build', right: 'skill judge' },
      { kind: 'same', left: 'mode high', right: 'mode high' },
      { kind: 'added', right: 'gate on' }
    ])
  })
})
