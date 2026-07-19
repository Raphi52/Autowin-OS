import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  filterHermesPreflight,
  normalizeHermesPreflight,
  readHermesPreflight,
  resolveHermesSessionsRoot,
  secureHermesSpool
} from './hermes-prompt-trace'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = () => ({
  schema: 'autowin.hermes-preflight/v1',
  timestamp: '2026-07-19T12:00:00.000Z',
  session_id: 'hermes-session-1',
  turn_id: 'turn-1',
  api_request_id: 'turn-1:api:1',
  conversation_id: 'conv-1',
  provider: 'openai-codex',
  model: 'gpt-5.6-terra',
  api_mode: 'codex_responses',
  request: {
    method: 'POST',
    url: 'https://example.invalid/responses',
    headers: {
      Authorization: 'Bearer should-never-persist',
      'x-api-key': 'x-secret',
      cookie: 'session=raw-cookie',
      clientSecret: 'camel-secret',
      private_key: 'private-secret'
    },
    body: {
      max_tokens: 512,
      instructions:
        'SOUL + AGENTS.md avec token=top-secret, sk-proj-raw-secret, AKIA1234567890ABCDEF, AIza123456789012345678901234567890 et eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123',
      input: [{ role: 'user', content: 'Analyse cette tâche' }],
      tools: [{ type: 'function', name: 'read_file' }]
    }
  }
})

describe('Hermes pre_api_request trace', () => {
  it('normalise le boundary exact et masque les secrets', () => {
    const event = normalizeHermesPreflight(fixture())
    expect(event).toMatchObject({
      sessionId: 'hermes-session-1',
      turnId: 'turn-1',
      provider: 'openai-codex',
      model: 'gpt-5.6-terra',
      conversationId: 'conv-1',
      fidelity: 'exact-redacted',
      messageCount: 1,
      toolCount: 1
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('should-never-persist')
    expect(serialized).not.toContain('top-secret')
    expect(serialized).not.toContain('x-secret')
    expect(serialized).not.toContain('raw-cookie')
    expect(serialized).not.toContain('camel-secret')
    expect(serialized).not.toContain('private-secret')
    expect(serialized).not.toContain('sk-proj-raw-secret')
    expect(serialized).not.toContain('AKIA1234567890ABCDEF')
    expect(serialized).not.toContain('AIza123456789012345678901234567890')
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(serialized).toContain('[REDACTED]')
    expect((event.request.body as Record<string, unknown>).max_tokens).toBe(512)
  })

  it('ignore les lignes corrompues et borne la lecture au plus récent', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-hermes-trace-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'events.jsonl'),
      `{broken}\n${JSON.stringify(fixture())}\n${JSON.stringify({ ...fixture(), api_request_id: 'api-2' })}\n`,
      'utf8'
    )
    expect(readHermesPreflight(root, 1).map((event) => event.apiRequestId)).toEqual(['api-2'])
  })

  it('rejette un schéma sans request.body', () => {
    expect(() => normalizeHermesPreflight({ schema: 'autowin.hermes-preflight/v1' })).toThrow(
      /request.body/
    )
  })

  it('utilise les request_dump Hermes comme fallback avec provenance distincte', () => {
    const spoolRoot = mkdtempSync(join(tmpdir(), 'autowin-hermes-empty-'))
    const dumpRoot = mkdtempSync(join(tmpdir(), 'autowin-hermes-dumps-'))
    roots.push(spoolRoot, dumpRoot)
    writeFileSync(
      join(dumpRoot, 'request_dump_session-x_20260719.json'),
      JSON.stringify({
        timestamp: '2026-07-19T13:00:00.000Z',
        session_id: 'session-x',
        reason: 'preflight',
        request: {
          method: 'POST',
          body: {
            model: 'fallback-model',
            messages: [{ role: 'user', content: 'AKIA1234567890ABCDEF' }],
            tools: []
          }
        }
      })
    )
    const fallback = readHermesPreflight(spoolRoot, 10, dumpRoot)[0]
    expect(fallback).toMatchObject({
      sessionId: 'session-x',
      model: 'fallback-model',
      source: 'request-dump',
      boundary: 'hermes.request_dump',
      fidelity: 'exact-redacted'
    })
    expect(JSON.stringify(fallback)).not.toContain('AKIA1234567890ABCDEF')
  })

  it('résout HERMES_HOME puis l’installation Windows locale avant ~/.hermes', () => {
    expect(resolveHermesSessionsRoot('C:\\Users\\me', 'C:\\Local', 'D:\\Hermes')).toBe(
      'D:\\Hermes\\sessions'
    )
    expect(resolveHermesSessionsRoot('C:\\Users\\me', 'C:\\Local')).toBe(
      'C:\\Local\\hermes\\sessions'
    )
    expect(resolveHermesSessionsRoot('/home/me')).toBe(join('/home/me', '.hermes', 'sessions'))
  })

  it('isole les traces Workflow par conversation et exclut les globales', () => {
    const linked = normalizeHermesPreflight(fixture())
    const global = normalizeHermesPreflight({ ...fixture(), conversation_id: '' })
    expect(filterHermesPreflight([linked, global], 'conv-1')).toEqual([linked])
    expect(filterHermesPreflight([linked, global])).toHaveLength(2)
  })

  it('crée uniquement le répertoire de spool explicitement fourni', () => {
    const parent = mkdtempSync(join(tmpdir(), 'autowin-hermes-secure-'))
    const root = join(parent, 'hermes-trace-spool')
    roots.push(parent)
    expect(secureHermesSpool(root)).toBe(true)
    expect(readHermesPreflight(root)).toEqual([])
  })
})
