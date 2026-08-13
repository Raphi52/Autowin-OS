import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendClaudeSelectionArgs,
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
      for (const event of events) {
        const emitted =
          event.type === 'result'
            ? {
                subtype: 'success',
                is_error: false,
                usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                  cache_read_input_tokens: 0
                },
                ...event
              }
            : event
        stdout.emit('data', Buffer.from(`${JSON.stringify(emitted)}\n`))
      }
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

beforeEach(() => {
  spawnCapture.stdoutEvents = []
})

describe('ClaudeCliAdapter — plafond de depense provider', () => {
  it('transmet la borne dure au CLI Claude en mode print', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, { model: 'haiku', maxBudgetUsd: 0.0625 })

    expect(args).toEqual(['--model', 'haiku', '--max-budget-usd', '0.0625'])
  })

  it('conserve le cout reel et interdit le retry quand Claude coupe sur la borne', async () => {
    const previousWorkspace = process.env.AUTOWIN_OS_WORKSPACE
    process.env.AUTOWIN_OS_WORKSPACE = process.cwd()
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: { model: 'claude-haiku-real', content: [] }
      },
      {
        type: 'result',
        subtype: 'error_max_budget_usd',
        result: '',
        session_id: 'budget-session',
        is_error: true,
        total_cost_usd: 0.065648,
        usage: {
          input_tokens: 26,
          output_tokens: 1043,
          cache_read_input_tokens: 12
        }
      }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send(
      [{ role: 'user', content: 'Diagnostic borne' }],
      { maxBudgetUsd: 0.0625, toolProfile: 'watchdog-read-only' }
    )

    await expect(async () => {
      let step = await gen.next()
      while (!step.done) step = await gen.next()
    }).rejects.toMatchObject({
      retryable: false,
      code: 'error_max_budget_usd',
      resolvedModel: 'claude-haiku-real',
      usage: { inputTokens: 38, outputTokens: 1043, cacheReadTokens: 12, costUsd: 0.065648 }
    })
    // Cette assertion cherchait l'element EXACT `'Read,Grep,Glob'`. Elle a rougi le 2026-08-13 quand
    // le web est devenu une capacite de base : la liste passee vaut desormais
    // `'Read,Grep,Glob,WebFetch,WebSearch'` en UNE chaine. Le litteral epinglait une composition, pas
    // une garantie — donc il interdisait toute capacite supplementaire, meme voulue.
    //
    // Ce qui compte reellement dans ce profil (fond autonome, contexte d'evenement NON FIABLE) : la
    // lecture est permise et le SHELL est interdit. Le prompt systeme n'est qu'une consigne ; cette
    // liste est la capacite reelle. On verifie donc l'invariant, pas sa forme du jour.
    //
    // FUSION de deux formulations concurrentes (2026-08-13) : l'invariant vient de la version d'une
    // autre session, qui a raison de generaliser ; les deux dernieres assertions viennent de la mienne
    // et couvrent une propriete que l'invariant ne dit pas — `--allowedTools` recoit les outils web en
    // arguments SEPARES. Mesure A/B sur le CLI reel : en une chaine a virgules, toute recuperation de
    // page PEND jusqu'au delai maximum (code 124). Garder les deux, c'est garder les deux intentions.
    const outils = spawnCapture.args[spawnCapture.args.indexOf('--tools') + 1]
    expect(outils).toMatch(/(^|,)Read(,|$)/)
    expect(outils).toMatch(/(^|,)Grep(,|$)/)
    expect(outils).toMatch(/(^|,)Glob(,|$)/)
    expect(outils).not.toMatch(/(^|,)Bash/)
    expect(spawnCapture.args).not.toContain('Bash')
    expect(spawnCapture.args).toContain('WebFetch')
    expect(spawnCapture.args).toContain('WebSearch')
    expect(spawnCapture.args.join(' ')).not.toContain('Bash')
    if (previousWorkspace === undefined) delete process.env.AUTOWIN_OS_WORKSPACE
    else process.env.AUTOWIN_OS_WORKSPACE = previousWorkspace
  })
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
  it('ne republie pas une image utilisateur identique comme artefact généré', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-test',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'YWJj' }
            }
          ]
        }
      },
      { type: 'result', result: 'Image lue', session_id: 'artifact-session', is_error: false }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([
      {
        role: 'user',
        content: 'Lis cette image',
        attachments: [
          {
            name: 'preuve.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          }
        ]
      }
    ])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toBeUndefined()
  })

  it('conserve une image Claude différente même si le tour contient une image utilisateur', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-test',
          content: [
            {
              type: 'image',
              name: 'résultat.png',
              source: { type: 'base64', media_type: 'image/png', data: 'ZGVm' }
            }
          ]
        }
      },
      { type: 'result', result: 'Image créée', session_id: 'artifact-session', is_error: false }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([
      {
        role: 'user',
        content: 'Transforme cette image',
        attachments: [
          {
            name: 'preuve.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          }
        ]
      }
    ])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toEqual([
      expect.objectContaining({ name: 'résultat.png', content: 'ZGVm', kind: 'image' })
    ])
  })

  it('déduplique deux encodages base64 équivalents de la même image utilisateur', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-test',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'Y W J j\n' }
            }
          ]
        }
      },
      { type: 'result', result: 'Image lue', session_id: 'artifact-session', is_error: false }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([
      {
        role: 'user',
        content: 'Lis cette image',
        attachments: [
          {
            name: 'preuve.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          }
        ]
      }
    ])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toBeUndefined()
  })

  it('ne supprime pas un document ayant les mêmes octets qu’une image utilisateur', async () => {
    spawnCapture.stdoutEvents = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-test',
          content: [
            {
              type: 'document',
              name: 'preuve.pdf',
              source: { type: 'base64', media_type: 'application/pdf', data: 'YWJj' }
            }
          ]
        }
      },
      { type: 'result', result: 'Document prêt', session_id: 'artifact-session', is_error: false }
    ]
    const { ClaudeCliAdapter } = await import('./claude')
    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([
      {
        role: 'user',
        content: 'Lis cette image',
        attachments: [
          {
            name: 'preuve.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          }
        ]
      }
    ])
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toEqual([
      expect.objectContaining({ name: 'preuve.pdf', mimeType: 'application/pdf', content: 'YWJj' })
    ])
  })

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
