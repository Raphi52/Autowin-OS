import { describe, expect, it } from 'vitest'
import type { BehaviourFile } from './behaviour-files'
import type { HermesPreflightTrace } from './activity/hermes-prompt-trace'
import { proveHermesInjections } from './hermes-injection-proof'

const file: BehaviourFile = {
  id: 'claude:root',
  label: 'CLAUDE.md',
  path: 'C:/test/CLAUDE.md',
  engine: 'claude',
  scope: 'project',
  state: 'declared',
  reason: '',
  injectedAt: '',
  injectedInto: '',
  active: true,
  size: 24
}
const trace = {
  schema: 'autowin.hermes-preflight/v1',
  timestamp: '2026-07-19T00:00:00.000Z',
  sessionId: 'test',
  turnId: 'test',
  apiRequestId: 'test',
  provider: 'test',
  model: 'test',
  fidelity: 'exact-redacted',
  boundary: 'hermes.pre_api_request',
  source: 'plugin-hook',
  messageCount: 1,
  toolCount: 0,
  request: { body: { system: 'prefix AB_MARKER_12345 suffix' } }
} satisfies HermesPreflightTrace

describe('proveHermesInjections', () => {
  it('marks a full candidate found in the captured payload as injected', () => {
    expect(
      proveHermesInjections([file], new Map([[file.id, 'AB_MARKER_12345']]), [trace])[0].verdict
    ).toBe('injected')
  })
  it('does not claim absence when the trace is from an uncorrelated workspace', () => {
    expect(
      proveHermesInjections([file], new Map([[file.id, 'AB_MARKER_67890']]), [trace])[0].verdict
    ).toBe('unproven')
  })
})
