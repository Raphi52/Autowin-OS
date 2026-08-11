import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendTurnEvent, readTurnJournal } from './turn-journal'
import { writeSurvivableExit } from './stdout-journal'
import {
  listRecoverableChatProviderCalls,
  recoverCompletedChatProviderCall,
  streamedPrefixForProviderCall
} from './chat-provider-recovery'

let root = ''

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

function claudeSuccess(path: string, text: string): void {
  writeFileSync(
    path,
    `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: text,
      session_id: 'session-recovered',
      total_cost_usd: 0.42,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 40
      }
    })}\n`,
    'utf8'
  )
  writeSurvivableExit(path, 0)
}

describe('reprise des appels provider du chat direct', () => {
  it('retrouve le dernier journal lie a un tour non terminal et son prefixe visible', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-recovery-'))
    const journalPath = join(root, 'provider.stdout.jsonl')
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'provider-1',
      journalPath,
      iteration: 2,
      attempt: 1,
      streamId: '2:1',
      requestId: 'request-1',
      policy: { readOnly: true, maxIterations: 1 }
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'delta',
      streamId: '2:1',
      text: 'Debut '
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'delta',
      streamId: '2:1',
      text: 'visible'
    })

    const calls = listRecoverableChatProviderCalls(root)
    expect(calls).toEqual([
      expect.objectContaining({
        conversationId: 'conv-1',
        turnId: 'turn-1',
        provider: 'claude',
        token: 'provider-1',
        journalPath,
        iteration: 2,
        attempt: 1,
        streamId: '2:1',
        requestId: 'request-1',
        policy: { readOnly: true, maxIterations: 1 }
      })
    ])
    expect(streamedPrefixForProviderCall(readTurnJournal(root, 'conv-1', 'turn-1'), '2:1')).toBe(
      'Debut visible'
    )
  })

  it('refuse une reprise dont la politique persistée est invalide (fail-closed)', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-policy-'))
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'provider-1',
      journalPath: join(root, 'provider.stdout.jsonl'),
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      requestId: 'request-1',
      policy: { readOnly: true, maxIterations: 0 }
    })

    expect(listRecoverableChatProviderCalls(root)).toEqual([])
  })

  it('ne retombe jamais sur un ancien essai quand le journal provider le plus récent est invalide', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-chain-policy-'))
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'older-normal',
      journalPath: join(root, 'older.stdout.jsonl'),
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      requestId: 'request-old'
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'newer-invalid',
      journalPath: join(root, 'newer.stdout.jsonl'),
      iteration: 0,
      attempt: 1,
      streamId: '0:1',
      requestId: 'request-new',
      policy: { readOnly: true, maxIterations: 0 }
    })

    expect(listRecoverableChatProviderCalls(root)).toEqual([])
  })

  it('ignore un tour deja terminal pour ne jamais rejouer un resultat', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-terminal-'))
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'provider-1',
      journalPath: join(root, 'provider.stdout.jsonl'),
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      requestId: 'request-1'
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'done' })

    expect(listRecoverableChatProviderCalls(root)).toEqual([])
  })

  it('rattache au provider les actions deja resolues avant un second crash', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-settled-action-'))
    const journalPath = join(root, 'provider.stdout.jsonl')
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'provider-journal',
      provider: 'claude',
      token: 'paid-call',
      journalPath,
      iteration: 0,
      attempt: 0,
      streamId: '0:0',
      requestId: 'request-1'
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'resumed' })
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'command',
      actionId: '0:0',
      name: 'ticket_create',
      args: { title: 'Ne jamais dupliquer' }
    })
    appendTurnEvent(root, 'conv-1', 'turn-1', {
      kind: 'result',
      actionId: '0:0',
      name: 'ticket_create',
      ok: true,
      data: { id: 42 },
      attachments: [
        {
          name: 'desktop.jpg',
          mimeType: 'image/jpeg',
          size: 3,
          kind: 'image',
          content: 'YWJj'
        }
      ]
    })

    expect(listRecoverableChatProviderCalls(root)).toEqual([
      expect.objectContaining({
        token: 'paid-call',
        settledActions: [
          {
            actionId: '0:0',
            name: 'ticket_create',
            ok: true,
            data: { id: 42 },
            attachments: [
              {
                name: 'desktop.jpg',
                mimeType: 'image/jpeg',
                size: 3,
                kind: 'image',
                content: 'YWJj'
              }
            ]
          }
        ]
      })
    ])
  })

  it('reconstruit seulement un resultat Claude certifie, usage et session compris', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-result-'))
    const journalPath = join(root, 'provider.stdout.jsonl')
    claudeSuccess(journalPath, 'reponse deja payee')

    expect(recoverCompletedChatProviderCall('claude', journalPath)).toEqual(
      expect.objectContaining({
        text: 'reponse deja payee',
        provider: 'claude',
        sessionId: 'session-recovered',
        usage: {
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 30,
          costUsd: 0.42
        }
      })
    )

    writeSurvivableExit(journalPath, 1)
    expect(recoverCompletedChatProviderCall('claude', journalPath)).toBeUndefined()
  })

  it('conserve les commandes assistant emises avant le resultat terminal Claude', () => {
    root = mkdtempSync(join(tmpdir(), 'autowin-chat-provider-command-recovery-'))
    const journalPath = join(root, 'provider.stdout.jsonl')
    const command = '<cmd>{"name":"edit_file","args":{"path":"src/x.ts"}}</cmd>'
    writeFileSync(
      journalPath,
      [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: command }] }
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Conclusion apres commande.' }] }
        }),
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Conclusion apres commande.',
          session_id: 'session-recovered',
          total_cost_usd: 0.12,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 0
          }
        })
      ].join('\n') + '\n',
      'utf8'
    )
    writeSurvivableExit(journalPath, 0)

    expect(recoverCompletedChatProviderCall('claude', journalPath)?.text).toBe(
      `${command}Conclusion apres commande.`
    )
  })
})
