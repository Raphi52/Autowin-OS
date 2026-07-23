import { describe, expect, it } from 'vitest'
import {
  NATIVE_PREFLIGHT_SCHEMA,
  assertNativePreflightWire,
  type NativePreflightWireV1
} from './native-trace-contract'

function wire(overrides: Partial<NativePreflightWireV1> = {}): NativePreflightWireV1 {
  return {
    schema: NATIVE_PREFLIGHT_SCHEMA,
    source: 'native',
    timestamp: '2026-07-23T09:00:00.000Z',
    session_id: 'session-1',
    turn_id: 'turn-1',
    api_request_id: 'native:1',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    request: { body: { messages: [] } },
    ...overrides
  }
}

describe('contrat partagé des traces natives', () => {
  it('accepte le schéma/source canonique', () => {
    const event = wire()
    expect(assertNativePreflightWire(event)).toBe(event)
  })

  it('rejette une source absente ou incompatible', () => {
    expect(() => assertNativePreflightWire({ ...wire(), source: undefined } as never)).toThrow(
      /source/i
    )
    expect(() => assertNativePreflightWire({ ...wire(), source: 'external' } as never)).toThrow(
      /source/i
    )
  })
})
