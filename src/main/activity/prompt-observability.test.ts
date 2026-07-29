import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendPromptCall,
  deletePromptCalls,
  loadPromptCalls,
  type PromptCallRecord
} from './prompt-observability'

const call: Omit<PromptCallRecord, 'id' | 'ts'> = {
  conversationId: 'conv-42',
  turnId: 'turn-7',
  iteration: 0,
  actor: 'orchestrator',
  provider: 'claude',
  model: 'claude-sonnet',
  transport: 'claude-cli',
  boundary: 'Autowin OS -> provider adapter',
  limitation: 'Les ajouts internes du provider ne sont pas observables.',
  system: 'REGLE EXACTE',
  messages: [{ role: 'user', content: 'Question exacte' }],
  options: { reasoningEffort: 'high', resumed: false },
  response: 'Réponse exacte',
  usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 20, costUsd: 0.004 }
}

describe('prompt observability', () => {
  it('conserve sans troncature le payload exact et le rattachement causal', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-observability-'))
    try {
      appendPromptCall(
        call,
        root,
        () => 1_700_000_000_000,
        () => 'call-1'
      )
      expect(loadPromptCalls('conv-42', root)).toEqual([
        expect.objectContaining({
          id: 'call-1',
          turnId: 'turn-7',
          system: 'REGLE EXACTE',
          messages: [{ role: 'user', content: 'Question exacte' }],
          response: 'Réponse exacte'
        })
      ])
      expect(readFileSync(join(root, 'conv-42.jsonl'), 'utf8')).toContain('REGLE EXACTE')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restaure les ponctuations UTF-8 altérées avant la frontière Observatory', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-observability-utf8-'))
    try {
      appendPromptCall(
        {
          ...call,
          messages: [{ role: 'user', content: 'Titre â€” citation â€˜ouvranteâ€™' }]
        },
        root,
        () => 1_700_000_000_000,
        () => 'call-utf8'
      )

      expect(loadPromptCalls('conv-42', root)[0]?.messages).toEqual([
        { role: 'user', content: 'Titre — citation ‘ouvrante’' }
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('supprime explicitement le journal exact d une conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-delete-'))
    appendPromptCall(
      call,
      root,
      () => 1_700_000_000_000,
      () => 'call-1'
    )
    expect(deletePromptCalls('conv-42', root)).toBe(true)
    expect(loadPromptCalls('conv-42', root)).toEqual([])
    expect(deletePromptCalls('conv-42', root)).toBe(false)
  })
})
