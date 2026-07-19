import { describe, expect, it, vi } from 'vitest'
import { discoverImportedModels } from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

describe('catalogue Agents dynamique', () => {
  it('importe Fable et tous les modèles Claude réellement exposés', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }, { id: 'intrus-non-claude' }]
      })
    )

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch)

    expect(models.map((model) => model.model)).toEqual([
      'gpt-5.6-terra',
      'claude-fable-5',
      'claude-opus-4-8'
    ])
    expect(models.find((model) => model.model === 'claude-fable-5')?.reasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(models.find((model) => model.model === 'claude-fable-5')?.label).toBe(
      'Claude Fable 5 · CLI'
    )
    expect(models.find((model) => model.model === 'claude-opus-4-8')?.label).toBe(
      'Claude Opus 4.8 · CLI'
    )
  })

  it('retombe sur le catalogue vérifié si le bridge est indisponible', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('bridge hors ligne')
    })

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch)

    expect(models.some((model) => model.model === 'gpt-5.6-terra')).toBe(true)
    expect(models.some((model) => model.model === 'claude-fable-5')).toBe(true)
  })
})

describe('sélection Claude depuis Agents', () => {
  it('transmet le modèle Fable et l’effort au CLI', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, {
      model: 'claude-fable-5',
      reasoningEffort: 'xhigh'
    })

    expect(args).toEqual(['--model', 'claude-fable-5', '--effort', 'xhigh'])
  })

  it('n’invente pas de flag effort pour none', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, { model: 'claude-haiku-4-5-20251001', reasoningEffort: 'none' })

    expect(args).toEqual(['--model', 'claude-haiku-4-5-20251001'])
  })
})
