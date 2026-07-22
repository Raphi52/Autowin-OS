import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeTransportEnvelope, materializeClaudeAttachments } from './claude'

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
