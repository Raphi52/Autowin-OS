import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appendPromptCall,
  attendreEcrituresPromptCalls,
  deletePromptCalls,
  flushAllPromptCalls,
  loadAllPromptCalls,
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
  resolvedModel: 'claude-sonnet-4-6',
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
  it('conserve sans troncature le payload exact et le rattachement causal', async () => {
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
          model: 'claude-sonnet',
          resolvedModel: 'claude-sonnet-4-6',
          system: 'REGLE EXACTE',
          messages: [{ role: 'user', content: 'Question exacte' }],
          response: 'Réponse exacte'
        })
      ])
      // L'ecriture part sur le pool d'I/O (voir `ecrireAsync`) : on attend qu'elle soit posee.
      await attendreEcrituresPromptCalls()
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

describe('écriture hors du fil principal', () => {
  it('ne bloque pas l appel sur le disque, reste relisible, et le flush d arrêt pose le fichier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-async-'))
    try {
      appendPromptCall(
        call,
        root,
        () => 1_700_000_000_000,
        () => 'call-async'
      )
      // Rendu AVANT le disque : l'enregistrement est déjà relisible…
      expect(loadPromptCalls('conv-42', root).map((c) => c.id)).toEqual(['call-async'])
      expect(loadAllPromptCalls(root).map((c) => c.id)).toEqual(['call-async'])
      // …et l'écriture réelle part sur le pool d'I/O.
      await attendreEcrituresPromptCalls()
      expect(readFileSync(join(root, 'conv-42.jsonl'), 'utf8')).toContain('call-async')
      expect(loadPromptCalls('conv-42', root).map((c) => c.id)).toEqual(['call-async'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('flushAllPromptCalls pose le tampon sur le disque en bloquant (arrêt de l app)', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-flush-'))
    try {
      appendPromptCall(
        call,
        root,
        () => 1_700_000_000_000,
        () => 'call-quit'
      )
      flushAllPromptCalls()
      expect(readFileSync(join(root, 'conv-42.jsonl'), 'utf8')).toContain('call-quit')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('la suppression d une conversation emporte aussi ce qui n est pas encore écrit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-prompt-delete-async-'))
    try {
      appendPromptCall(
        call,
        root,
        () => 1_700_000_000_000,
        () => 'call-doomed'
      )
      expect(deletePromptCalls('conv-42', root)).toBe(true)
      await attendreEcrituresPromptCalls()
      expect(loadPromptCalls('conv-42', root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
