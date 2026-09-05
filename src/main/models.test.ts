import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_IMPORTED_MODELS, discoverImportedModels, findModel } from './models'
import { appendClaudeSelectionArgs } from './providers/claude'

const noCodexModels = async (): Promise<[]> => []
/**
 * Le catalogue Claude lit desormais les ids du BINAIRE du CLI installe. Sans stub, ces tests
 * dependraient de la machine qui les execute (et changeraient a chaque mise a jour du CLI). On injecte
 * donc une liste fixe : `claude-opus-5` y figure parce que c'est LE cas qui a motive le changement.
 */
const cliIds = (): string[] => ['claude-opus-5', 'claude-sonnet-4-6']
/** Un CLI introuvable rend une liste vide — cas d'un poste sans CLI installe (teste plus bas). */
const noCliIds = (): string[] => []

describe('catalogue Agents dynamique', () => {
  it('n’expose plus aucun moteur retiré : Kimi et Gemini ont quitté le catalogue statique', () => {
    // Ces deux voies étaient les SEULES entrées de cette liste. Elles sont retirées du produit.
    expect(DEFAULT_IMPORTED_MODELS).toEqual([])
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
      noCodexModels,
      cliIds
    )

    expect(models.find((model) => model.model === 'opus')?.label).toBe('Claude Opus 5 · CLI')
    expect(models.find((model) => model.model === 'sonnet')?.label).toBe(
      'Claude Sonnet 4.6 · CLI'
    )
    expect(models.find((model) => model.model === 'fable')?.label).toBe('Claude Fable 5 · CLI')

    // Ordre du catalogue : les ALIAS du CLI — le socle portable, present sur toute machine qui a le
    // CLI —, puis les versions EXACTES qu'un service local expose (pour epingler). Plus aucune
    // entree kimi/gemini : ces moteurs sont retires du produit.
    expect(models.map((model) => model.model)).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'fable',
      // Lus dans le BINAIRE du CLI installe : c'est ce qui permet d'afficher « Claude Opus 5 » par son
      // nom, sans service tiers. Le stub `cliIds` les fournit.
      'claude-opus-5',
      'claude-sonnet-4-6',
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

  it('service local absent → les ALIAS du CLI restent : le dernier Opus est accessible partout', async () => {
    // LE cas du collegue (2026-07-30) : il ne voyait pas Opus 5. La cause n'etait pas qu'Opus 5 lui
    // etait indisponible — il l'etait parfaitement via son CLI — mais que la liste venait d'un service
    // PERSONNEL (`claude-bridge` de Hermes, dans le %LOCALAPPDATA% d'un seul poste). Sans ce projet
    // perso, l'ancien code retombait sur un seed fige a `opus-4-6`.
    // Les alias du CLI (`--model opus`) resolvent COTE SERVEUR vers le dernier modele : MESURE reelle,
    // `--model opus` a rendu `claude-opus-5`. Aucun service tiers requis.
    const fetchFn = vi.fn(async () => {
      throw new Error('service local absent')
    })

    const models = await discoverImportedModels(
      fetchFn as unknown as typeof fetch,
      undefined,
      noCodexModels,
      cliIds
    )

    const claude = models.filter((model) => model.provider === 'claude').map((model) => model.model)
    // LE point : Opus 5 est la, NOMME, sans aucun service tiers — lu dans le binaire du CLI.
    expect(claude).toContain('claude-opus-5')
    expect(claude).toEqual(['opus', 'sonnet', 'haiku', 'fable', 'claude-opus-5', 'claude-sonnet-4-6'])
    // CONTRÔLE NÉGATIF : aucun moteur retiré ne reparaît, quelle que soit la panne de source.
    expect(models.some((model) => model.provider === 'codex')).toBe(false)
    expect(models.some((model) => model.provider === 'kimi')).toBe(false)
    expect(models.some((model) => model.provider === 'gemini')).toBe(false)
  })

  it('n’importe AUCUN modèle du compte ChatGPT : Codex est retiré du produit', async () => {
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
      listCodexModels,
      cliIds
    )

    // Le compte ChatGPT expose toujours ces modèles (le stub ci-dessus le prouve), mais Codex est
    // RETIRÉ du produit : le catalogue ne doit plus en proposer un seul. Il ne reste que Claude.
    expect(models.map((model) => model.model)).toEqual([
      // Les alias du CLI Claude sont le socle portable : presents quoi que rende le service local.
      'opus',
      'sonnet',
      'haiku',
      'fable',
      'claude-opus-5',
      'claude-sonnet-4-6',
      'claude-fable-5'
    ])
    expect(models.some((model) => model.provider === 'codex')).toBe(false)
    expect(listCodexModels).toHaveBeenCalled()
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
      noCodexModels,
      cliIds
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
      noCodexModels,
      cliIds
    )
    expect(offline.some((m) => m.model === 'claude-opus-4-8')).toBe(true)
    expect(offline.some((m) => m.model === 'claude-opus-4-6')).toBe(false)
    // Le repli n'a pas ré-écrit le cache avec le seed.
    expect(JSON.parse(readFileSync(cachePath, 'utf8')).claude).toHaveLength(2)
  })

  it('étiquette l’alias avec la meilleure version du catalogue final, cache inclus', async () => {
    const cachePath = makeCachePath()
    const oldCliIds = (): string[] => ['claude-opus-4-8']
    const opus5Fetch = vi.fn(async () => Response.json({ data: [{ id: 'claude-opus-5' }] }))

    await discoverImportedModels(
      opus5Fetch as unknown as typeof fetch,
      cachePath,
      noCodexModels,
      oldCliIds
    )
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      cachePath,
      noCodexModels,
      oldCliIds
    )
    const alias = offline.find((model) => model.model === 'opus')

    expect(alias).toMatchObject({ model: 'opus', label: 'Claude Opus 5 · CLI' })
  })

  it('CLI absent ET service absent → seuls les alias, aucun id versionne invente', async () => {
    // Machine vierge, aucun service local, aucun cache : exactement le poste du collegue. Il obtient
    // desormais `opus` — qui resout vers le dernier Opus cote serveur — au lieu d'un `opus-4-6` fige
    // que personne n'avait choisi. Et aucun id VERSIONNE n'est fabrique : on ne pretend pas savoir
    // quelle version le CLI retiendra.
    const offline = await discoverImportedModels(
      deadFetch as unknown as typeof fetch,
      makeCachePath(),
      noCodexModels,
      noCliIds
    )
    const claude = offline.filter((m) => m.provider === 'claude').map((m) => m.model)
    // Poste SANS CLI installe (`noCliIds`) et sans service local : il ne reste que les alias, et
    // AUCUN id versionne n'est fabrique. C'est la seule situation ou l'on ne peut pas nommer le modele
    // — et elle est honnete, contrairement a l'ancien seed qui affirmait `opus-4-6`.
    expect(claude).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
    expect(claude.some((model) => /^claude-/.test(model))).toBe(false)
    expect(offline.find((model) => model.model === 'opus')?.label).toBe('Claude Opus · CLI')
    // Codex n'a pas d'alias equivalent cote CLI : sans listing ni cache, aucun modele codex.
    expect(offline.filter((m) => m.provider === 'codex')).toEqual([])
    expect(offline.some((m) => m.provider === 'gemini')).toBe(false)
    expect(offline.some((m) => m.provider === 'kimi')).toBe(false)
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
    // Moteur retiré : plus d'alias, donc plus de résolution — même si le catalogue de test en
    // garde une entrée (cas d'un cache antérieur au retrait).
    expect(findModel(catalog, 'codex/flagship')).toBeUndefined()
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

    // `--autocompact` suit la fenetre declaree, a 85 % : fable porte 200 k dans
    // CONTEXT_WINDOWS, donc le seuil vaut 170 000 et non le `auto` du CLI.
    expect(args).toEqual(['--model', 'claude-fable-5', '--effort', 'xhigh', '--autocompact', '170000'])
  })

  it('n’invente pas de flag effort pour none', () => {
    const args: string[] = []

    appendClaudeSelectionArgs(args, { model: 'claude-haiku-4-5-20251001', reasoningEffort: 'none' })

    expect(args).toEqual(['--model', 'claude-haiku-4-5-20251001', '--autocompact', '170000'])
  })
})
