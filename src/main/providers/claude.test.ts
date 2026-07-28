import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { claudeTransportEnvelope, materializeClaudeAttachments } from './claude'

// Capture le spawn : args réels + ce qui est écrit sur stdin, pour prouver l'anti-ENAMETOOLONG.
const spawnCapture = vi.hoisted(() => ({ args: [] as string[], stdin: '' }))
vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    spawnCapture.args = args
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = {
      end: (data: string) => {
        spawnCapture.stdin = data
      }
    }
    child.kill = (): boolean => true
    child.exitCode = null
    // Émet un `result` minimal puis ferme proprement (le générateur se règle).
    setTimeout(() => {
      stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({ type: 'result', result: 'ok', session_id: 's', is_error: false }) + '\n'
        )
      )
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

describe('ClaudeCliAdapter — pièces jointes', () => {
  it('matérialise uniquement les fichiers déposés puis les nettoie', () => {
    const materialized = materializeClaudeAttachments([
      {
        name: '../capture.png',
        mimeType: 'image/png',
        size: 3,
        kind: 'image',
        content: 'YWJj'
      }
    ])

    expect(materialized.paths).toHaveLength(1)
    expect(materialized.paths[0]).not.toContain('..')
    expect(readFileSync(materialized.paths[0]).toString('utf8')).toBe('abc')
    expect(materialized.promptSuffix).toContain(materialized.paths[0])
    materialized.cleanup()
    expect(existsSync(materialized.dir)).toBe(false)
  })
  it('retire tous les caractères de contrôle Windows des noms matérialisés', () => {
    const materialized = materializeClaudeAttachments([
      {
        name: 'evil\ncarriage\rnull\u0000.txt',
        mimeType: 'text/plain',
        size: 3,
        kind: 'text',
        content: 'YWJj'
      }
    ])

    expect(basename(materialized.paths[0])).toBe('1-evil_carriage_null_.txt')
    materialized.cleanup()
  })
  it('decrit le prompt materialise et les vrais arguments transport', () => {
    const materialized = materializeClaudeAttachments([
      { name: 'preuve.txt', mimeType: 'text/plain', size: 3, kind: 'text', content: 'abc' }
    ])
    const envelope = claudeTransportEnvelope(
      [
        {
          role: 'user',
          content: 'Lis',
          attachments: [
            { name: 'preuve.txt', mimeType: 'text/plain', size: 3, kind: 'text', content: 'abc' }
          ]
        }
      ],
      { system: 'REGLE', model: 'claude-sonnet' },
      materialized,
      ['-p', `Lis${materialized.promptSuffix}`, '--tools', 'Read']
    )
    expect(envelope.messages[0].content).toBe(`Lis${materialized.promptSuffix}`)
    expect(envelope.messages[0].attachments?.[0].content).toBe('abc')
    expect(envelope.options.argv).toEqual([
      '-p',
      `Lis${materialized.promptSuffix}`,
      '--tools',
      'Read'
    ])
    materialized.cleanup()
  })
})

describe('B — Claude exécuteur', () => {
  it('déclare supportsExecution', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    expect(new ClaudeCliAdapter().supportsExecution).toBe(true)
  })
  it('claudeToolEvidenceKind classe mutation / vérification / inspection', async () => {
    const { claudeToolEvidenceKind } = await import('./claude')
    expect(claudeToolEvidenceKind('Edit', 'src/x.ts')).toBe('mutation')
    expect(claudeToolEvidenceKind('Write', 'f')).toBe('mutation')
    expect(claudeToolEvidenceKind('Bash', 'npm test')).toBe('verification')
    expect(claudeToolEvidenceKind('Bash', 'ls -la')).toBe('inspection')
    expect(claudeToolEvidenceKind('Read', 'x')).toBe('inspection')
    expect(claudeToolEvidenceKind('Grep', 'foo')).toBe('inspection')
  })
})

describe('ClaudeCliAdapter — prompt sur stdin (anti spawn ENAMETOOLONG)', () => {
  it('n’insère PAS le prompt en argv et l’écrit sur stdin (même très long)', async () => {
    const { ClaudeCliAdapter } = await import('./claude')
    const longPrompt = 'x'.repeat(50_000) // dépasserait la limite de ligne de commande Windows
    const adapter = new ClaudeCliAdapter({ bin: 'claude' })
    const gen = adapter.send([{ role: 'user', content: longPrompt }], {})
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    // `-p` présent en flag, mais AUCUN argument ne contient le prompt géant.
    expect(spawnCapture.args).toContain('-p')
    expect(spawnCapture.args.some((arg) => arg.length > 40_000)).toBe(false)
    // Le prompt est passé par stdin → aucune limite d’argv.
    expect(spawnCapture.stdin).toBe(longPrompt)
  })
})
