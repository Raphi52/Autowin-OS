import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMPORTED_MODELS, discoverImportedModels, findModel } from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexModels = async (): Promise<[]> => []

describe('catalogue Agents dynamique', () => {
  it('expose Gemini via le compte Google du CLI officiel, sans clé API', () => {
    expect(DEFAULT_IMPORTED_MODELS).toContainEqual(
      expect.objectContaining({
        id: 'gemini/Gemini 3.5 Flash (Low)',
        provider: 'gemini',
        model: 'Gemini 3.5 Flash (Low)'
      })
    )
  })

  it('expose Kimi Code compte comme modèle sélectionnable, sans API key', () => {
    expect(DEFAULT_IMPORTED_MODELS).toContainEqual(
      expect.objectContaining({
        id: 'kimi/kimi-code/kimi-for-coding',
        provider: 'kimi',
        model: 'kimi-code/kimi-for-coding'
      })
    )
  })

  it('importe Fable et tous les modèles Claude réellement exposés', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }, { id: 'intrus-non-claude' }]
      })
    )

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      undefined,
      noCodexModels
    )

    // `gpt-5.6-terra` a disparu de cette liste : le seed statique codex n'existe plus, et ce test ne
    // fournit AUCUN modele codex (`noCodexModels`). Ne restent que le live claude + les declarations
    // de capacite kimi/gemini, qui n'ont pas de source dynamique.
    expect(models.map((model) => model.model)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8',
      'kimi-code/kimi-for-coding',
      'Gemini 3.5 Flash (Low)',
      'Gemini 3.5 Flash (Medium)',
      'Gemini 3.5 Flash (High)',
      'Gemini 3.1 Pro (Low)',
      'Gemini 3.1 Pro (High)'
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

  it('bridge indisponible → AUCUN modèle claude inventé (plus de repli statique)', async () => {
    // Contrat INVERSÉ le 2026-07-30, et c'est le but. L'ancien repli affichait `opus-4-6` comme
    // meilleur opus disponible sur un poste sans le service, alors que celui-ci expose `opus-5` :
    // une liste périmée présentée comme la vérité, sans le moindre signal. Une liste VIDE se voit et
    // se répare ; une liste fausse se croit.
    const fetchFn = vi.fn(async () => {
      throw new Error('bridge hors ligne')
    })

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      undefined,
      noCodexModels
    )

    expect(models.some((model) => model.provider === 'claude')).toBe(false)
    expect(models.some((model) => model.provider === 'codex')).toBe(false)
    // Les providers SANS source dynamique restent : leurs entrées sont la capacité de l'adaptateur,
    // pas une copie d'un catalogue distant qui pourrait avoir bougé.
    expect(models.some((model) => model.provider === 'kimi')).toBe(true)
    expect(models.some((model) => model.provider === 'gemini')).toBe(true)
  })

  it('importe tous les modèles réellement exposés par le compte ChatGPT', async () => {
    const fetchFn = vi.fn(async () => Response.json({ data: [{ id: 'claude-fable-5' }] }))
    const listCodexModels = vi.fn(async () => [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }],
        defaultReasoningEffort: 'low'
      },
      {
        id: 'gpt-5.4-mini',
        model: 'gpt-5.4-mini',
        displayName: 'GPT-5.4-Mini',
        hidden: true,
        isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
        defaultReasoningEffort: 'medium'
      },
      {
        id: '../intrus',
        model: '../intrus',
        displayName: 'Intrus',
        hidden: false,
        isDefault: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium'
      }
    ])

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      undefined,
      listCodexModels
    )

    expect(models.map((model) => model.model)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.4-mini',
      'claude-fable-5',
      'kimi-code/kimi-for-coding',
      'Gemini 3.5 Flash (Low)',
      'Gemini 3.5 Flash (Medium)',
      'Gemini 3.5 Flash (High)',
      'Gemini 3.1 Pro (Low)',
      'Gemini 3.1 Pro (High)'
    ])
    // 'ultra' est filtré (400 sur /responses) → seul 'low' reste. Non-régression du fix HTTP 400.
    expect(models[0]).toMatchObject({
      id: 'codex/gpt-5.6-sol',
      label: 'GPT-5.6-Sol · ChatGPT',
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low'
    })
    // priority/visibility (contrat flagship) sont portés quand le listing les expose.
    expect(models[1]).toMatchObject({ visibility: 'hide' })
  })
})

describe('cache disque du dernier catalogue vu', () => {
  const tempDirs: string[] = []
  const makeCachePath = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-models-'))
    tempDirs.push(dir)
    return join(dir, 'model-catalog.json')
  }
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const liveClaudeFetch = vi.fn(async () =>
    Response.json({ data: [{ id: 'claude-fable-5' }, { id: 'claude-opus-4-8' }] })
  )
  const deadFetch = vi.fn(async () => {
    throw new Error('API KO')
  })

  it('écrit le cache à chaque listing réussi, puis le relit quand l’API est KO', async () => {
    const cachePath = makeCachePath()

    const live = await discoverImportedModels(
      liveClaudeFetch as unknown as typeof fetch,
      cachePath,
      noCodexModels
    )
    expect(live.some((m) => m.model === 'claude-opus-4-8')).toBe(true)
    const written = JSON.parse(readFileSync(cachePath, 'utf8'))
    expect(written).toMatchObject({ version: 1, discoveredAt: expect.any(Number) })
    expect(written.claude.map((m: { model: string }) => m.model)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8'
    ])

    // API KO → dernier catalogue vu (cache), PAS le seed figé (qui n'a pas opus-4-8).
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      cachePath,
      noCodexModels
    )
    expect(offline.some((m) => m.model === 'claude-opus-4-8')).toBe(true)
    expect(offline.some((m) => m.model === 'claude-opus-4-6')).toBe(false)
    // Le repli n'a pas ré-écrit le cache avec le seed.
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).claude).toHaveLength(2)
  })

  it('API KO et cache VIDE → aucun modèle claude/codex, rien d’inventé', async () => {
    // Le cas de ton collegue : premiere ouverture sur une machine ou le service de modeles ne tourne
    // pas. Avant, il recevait le seed (`opus-4-6`) presente comme le catalogue reel. Desormais il
    // recoit RIEN pour ces deux voies — l'absence est la seule reponse honnete.
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      makeCachePath(),
      noCodexModels
    )
    expect(offline.filter((m) => m.provider === 'claude')).toEqual([])
    expect(offline.filter((m) => m.provider === 'codex')).toEqual([])
    expect(offline.some((m) => m.provider === 'gemini')).toBe(true)
  })
})

describe('résolution des alias par famille via findModel', () => {
  it('id concret prioritaire, alias résolu au runtime, alias insoluble → undefined', () => {
    // Le catalogue ne vient plus d'un seed pour claude/codex : on construit ici un catalogue
    // DECOUVERT, tel que le service en rendrait un. C'est aussi plus fidele — la resolution d'alias
    // doit fonctionner sur ce que la machine expose reellement, pas sur une liste figee.
    const claude = (model: string): (typeof DEFAULT_IMPORTED_MODELS)[number] => ({
      id: `claude/${model}`,
      provider: 'claude',
      model,
      label: `${model} · CLI`,
      reasoningEfforts: ['high'],
      defaultReasoningEffort: 'high'
    })
    const catalog = [
      ...DEFAULT_IMPORTED_MODELS,
      claude('claude-opus-4-6'),
      claude('claude-opus-5'),
      claude('claude-fable-5'),
      {
        id: 'codex/gpt-5.6-terra',
        provider: 'codex',
        model: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra · ChatGPT',
        reasoningEfforts: ['medium' as const],
        defaultReasoningEffort: 'medium' as const,
        priority: 0,
        visibility: 'list'
      }
    ]
    expect(findModel(catalog, 'claude/claude-opus-4-6')?.model).toBe('claude-opus-4-6')
    // `opus-latest` doit suivre le catalogue REEL : opus-5 y est, donc c'est lui — exactement le bug
    // que le seed statique produisait (il figeait `opus-latest` sur opus-4-6).
    expect(findModel(catalog, 'claude/opus-latest')?.model).toBe('claude-opus-5')
    expect(findModel(catalog, 'claude/fable-latest')?.model).toBe('claude-fable-5')
    expect(findModel(catalog, 'codex/flagship')?.model).toBe('gpt-5.6-terra')
    expect(findModel(catalog, 'claude/sonnet-latest')).toBeUndefined()
    expect(findModel(catalog, 'claude/inexistant')).toBeUndefined()
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
