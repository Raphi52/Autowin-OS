import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeContentArtifacts,
  claudeTransportEnvelope,
  materializeClaudeAttachments
} from './claude'
import { materializeChatArtifact, readConversationArtifact } from '../store/chat-artifact-store'
import { ConversationStore } from '../store/conversations'

// Capture le spawn : args réels + ce qui est écrit sur stdin, pour prouver l'anti-ENAMETOOLONG.
const spawnCapture = vi.hoisted(() => ({
  args: [] as string[],
  stdin: '',
  stdoutEvents: [] as Array<Record<string, unknown>>
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
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
    child.unref = (): void => {} // le vrai ChildProcess en expose un (spawn détaché)
    child.exitCode = null
    // Émet les événements demandés par le test, ou un `result` minimal par défaut.
    setTimeout(() => {
      const events = spawnCapture.stdoutEvents.splice(0)
      if (!events.length)
        events.push({ type: 'result', result: 'ok', session_id: 's', is_error: false })
      for (const event of events) stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

describe('ClaudeCliAdapter — pièces jointes', () => {
  it('convertit les blocs image/document Claude en artefacts supplier-agnostic', () => {
    expect(
      claudeContentArtifacts(
        [
          {
            type: 'image',
            name: 'capture.png',
            source: { type: 'base64', media_type: 'image/png', data: 'YWJj' }
          }
        ],
        'Screenshot'
      )
    ).toEqual([
      {
        name: 'capture.png',
        mimeType: 'image/png',
        encoding: 'base64',
        content: 'YWJj',
        tool: 'Screenshot'
      }
    ])
  })

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

describe('ClaudeCliAdapter — sorties artefact stream-json', () => {
  it('transporte un bloc image assistant complet jusqu’au résultat supplier-agnostic', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-test',
          content: [
            {
              type: 'image',
              name: 'capture.png',
              source: { type: 'base64', media_type: 'image/png', data: 'YWJj' }
            }
          ]
        }
      },
      { type: 'result', result: 'Image prête', session_id: 'artifact-session', is_error: false }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Image' }])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toEqual([
      expect.objectContaining({
        name: 'capture.png',
        kind: 'image',
        mimeType: 'image/png',
        content: 'YWJj',
        source: { provider: 'claude', model: 'claude-opus-test' }
      })
    ])

    const base = mkdtempSync(join(tmpdir(), 'autowin-claude-artifact-'))
    const store = new ConversationStore(() => 1)
    const conversation = store.create({ title: 'Claude', category: 'claude', provider: 'claude' })
    store.beginTurn(conversation.id, { content: 'Image' }, { turnId: 'turn-claude' })
    const stored = materializeChatArtifact(
      step.value.artifacts![0],
      conversation.id,
      'turn-claude',
      base
    )
    store.applyTurnEvent(conversation.id, 'turn-claude', { kind: 'artifact', artifact: stored })
    store.applyTurnEvent(conversation.id, 'turn-claude', { kind: 'done' })
    const reloaded = new ConversationStore(() => 2)
    reloaded.hydrate(JSON.parse(JSON.stringify(store.list())))
    expect(
      readConversationArtifact(reloaded.get(conversation.id), 'turn-claude', stored.id, base)
    ).toMatchObject({ ok: true, encoding: 'base64', content: 'YWJj' })
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

  it('normalise un fichier absolu du worktree en chemin relatif attribuable', async () => {
    const { claudeEvidencePath } = await import('./claude')
    expect(
      claudeEvidencePath(
        'C:\\repo\\.claude\\worktrees\\run-1\\src\\feature.ts',
        'C:\\repo\\.claude\\worktrees\\run-1'
      )
    ).toBe('src/feature.ts')
    expect(claudeEvidencePath('src/relative.ts', 'C:\\repo')).toBe('src/relative.ts')
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
