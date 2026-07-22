import { describe, expect, it } from 'vitest'
import {
  classifyGitState,
  computeSourceFingerprint,
  findCompletenessGaps
} from './export-compute-fabric-context.mjs'

const BASE_FINGERPRINT_INPUT = {
  schema: 'autowin.compute-fabric-context-sources/v1',
  commit: 'a'.repeat(40),
  branch: 'feature/context',
  files: [
    {
      path: 'src/main/compute-fabric/a.ts',
      bytes: 10,
      digest: 'b'.repeat(64),
      gitState: 'HEAD',
      headBlob: 'c'.repeat(40)
    },
    {
      path: 'docs/compute-fabric/README.md',
      bytes: 20,
      digest: 'd'.repeat(64),
      gitState: 'untracked',
      headBlob: null
    }
  ]
}

describe('Compute Fabric context exporter', () => {
  it('computes a stable source fingerprint independent of inventory order', () => {
    const forward = computeSourceFingerprint(BASE_FINGERPRINT_INPUT)
    const reversed = computeSourceFingerprint({
      ...BASE_FINGERPRINT_INPUT,
      files: [...BASE_FINGERPRINT_INPUT.files].reverse()
    })

    expect(forward).toMatch(/^[a-f0-9]{64}$/)
    expect(reversed).toBe(forward)
    expect(
      computeSourceFingerprint({
        ...BASE_FINGERPRINT_INPUT,
        files: [{ ...BASE_FINGERPRINT_INPUT.files[0], digest: 'e'.repeat(64) }]
      })
    ).not.toBe(forward)
  })

  it('classifies clean, changed and untracked Git states without inventing a HEAD blob', () => {
    expect(classifyGitState('', 'a'.repeat(40))).toBe('HEAD')
    expect(classifyGitState('??', null)).toBe('untracked')
    expect(classifyGitState(' M', 'a'.repeat(40))).toBe('changed:.M')
    expect(classifyGitState('', null)).toBe('untracked')
  })

  it('reports implementation and test files missing from the visible source selection', () => {
    const gaps = findCompletenessGaps({
      discovered: [
        'src/main/compute-fabric/a.ts',
        'src/main/compute-fabric/a.test.ts',
        'src/main/compute-fabric/b.test.ts'
      ],
      sourcePaths: ['src/main/compute-fabric/a.ts'],
      testPaths: ['src/main/compute-fabric/a.test.ts']
    })

    expect(gaps).toEqual({
      missingSources: ['src/main/compute-fabric/a.test.ts', 'src/main/compute-fabric/b.test.ts'],
      missingTests: ['src/main/compute-fabric/b.test.ts'],
      invisibleTests: ['src/main/compute-fabric/a.test.ts']
    })
  })
})
