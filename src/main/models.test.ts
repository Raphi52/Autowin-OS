import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  discoverImportedModels,
  isValidImportedModel,
  saveImportedModelsCache,
  type ImportedModel
} from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexAuth = (): null => null

describe('catalogue Agents dynamique', () => {
  it('importe uniquement les modèles Claude réellement exposés', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }, { id: 'intrus' }] })
    )

    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth)

    expect(models.map((model) => model.model)).toEqual(['claude-fable-5', 'claude-opus-4-8'])
    expect(models[0]?.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(models[1]?.label).toBe('Claude Opus 4.8 · CLI')
  })

  it('retombe sur le dernier cache valide si le listing est indisponible', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-models-'))
    const cachePath = join(directory, 'models.json')
    const cached: ImportedModel = {
      id: 'claude/claude-opus-4-8', provider: 'claude', model: 'claude-opus-4-8',
      label: 'Claude Opus 4.8', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high'
    }
    saveImportedModelsCache(cachePath, [cached])
    const fetchFn = vi.fn(async () => { throw new Error('bridge offline') })
    try {
      await expect(discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth, cachePath))
        .resolves.toEqual([cached])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('returns no model without a valid listing or cache', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('bridge offline') })
    await expect(discoverImportedModels(fetchFn as unknown as typeof fetch, noCodexAuth)).resolves.toEqual([])
  })

  it('rejects invented model IDs that do not match their provider and model', () => {
    expect(isValidImportedModel({
      id: 'claude/other', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus',
      reasoningEfforts: ['high'], defaultReasoningEffort: 'high'
    })).toBe(false)
    expect(isValidImportedModel({
      id: 'claude/claude-opus-4-8', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus',
      reasoningEfforts: ['high'], defaultReasoningEffort: 'ultra'
    })).toBe(false)
  })

  it('ignores an invalid cache instead of inventing a model', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'autowin-models-'))
    const cachePath = join(directory, 'models.json')
    writeFileSync(cachePath, JSON.stringify([{
      id: 'claude/wrong', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus',
      reasoningEfforts: ['high'], defaultReasoningEffort: 'high'
    }]))
    const offline = vi.fn(async () => { throw new Error('bridge offline') })
    try {
      await expect(discoverImportedModels(offline as unknown as typeof fetch, noCodexAuth, cachePath))
        .resolves.toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('imports the models exposed by the ChatGPT account', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('chatgpt.com/backend-api/codex/models')) {
        return Response.json({ models: [{ slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }], default_reasoning_level: 'low' }] })
      }
      return Response.json({ data: [{ id: 'claude-fable-5' }] })
    })
    const models = await discoverImportedModels(fetchFn as unknown as typeof fetch, () => ({ accessToken: 'token', refreshToken: 'refresh', obtainedAt: Date.now() }))
    expect(models.map((model) => model.model)).toEqual(['gpt-5.6-sol', 'claude-fable-5'])
    expect(models[0]).toMatchObject({ id: 'codex/gpt-5.6-sol', reasoningEfforts: ['low'] })
  })
})

describe('sélection Claude depuis Agents', () => {
  it('transmet le modèle et l’effort au CLI', () => {
    const args: string[] = []
    appendClaudeSelectionArgs(args, { model: 'claude-fable-5', reasoningEffort: 'xhigh' })
    expect(args).toEqual(['--model', 'claude-fable-5', '--effort', 'xhigh'])
  })
})
