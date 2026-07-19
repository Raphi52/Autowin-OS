// Source CANONIQUE des modèles réellement disponibles dans Autowin OS.
//
// Un « modèle importé » est un objet de première classe : c'est LUI qu'on
// glisse sur un slot de topologie (orchestrateur / sous-agent / scout / judge).
// La liste est BORNÉE par ce que les adaptateurs providers savent réellement
// piloter — on n'invente jamais un modèle qui n'existe pas. Le seed par défaut
// reflète les voies vérifiées (Codex → gpt-5.6-terra ; Claude CLI → alias
// --model réels) et l'utilisateur peut importer/supprimer explicitement.

import type { ReasoningEffort } from './roles'

/** Un modèle importé, atomique et adressable par son `id` canonique. */
export interface ImportedModel {
  /** Identité canonique stable (ex. 'codex/gpt-5.6-terra', 'claude/opus'). */
  id: string
  /** Adaptateur provider qui sait piloter ce modèle ('claude' | 'codex' | …). */
  provider: string
  /** Identifiant de transport passé à l'adaptateur (`--model` CLI, champ `model` HTTP). */
  model: string
  /** Libellé lisible pour la bibliothèque. */
  label: string
  /** Efforts de raisonnement RÉELLEMENT supportés par ce modèle sur sa voie. */
  reasoningEfforts: ReasoningEffort[]
  /** Effort par défaut (∈ reasoningEfforts) proposé lors d'un binding. */
  defaultReasoningEffort: ReasoningEffort
}

/**
 * Seed de repli — borné aux voies vérifiées, JAMAIS un modèle inventé.
 * - Codex : `gpt-5.6-terra` accepté live (gpt-5-codex rejeté « model not supported »).
 *   L'API Responses accepte `reasoning.effort` ∈ minimal|low|medium|high.
 * - Claude : modèles exposés par le bridge local `/models`. Le CLI installé expose
 *   `--effort low|medium|high|xhigh|max` et accepte les identifiants complets.
 */
export const DEFAULT_IMPORTED_MODELS: ImportedModel[] = [
  {
    id: 'codex/gpt-5.6-terra',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra · Codex',
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude/claude-fable-5',
    provider: 'claude',
    model: 'claude-fable-5',
    label: 'Claude Fable 5 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'claude/claude-haiku-4-5-20251001',
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude/claude-opus-4-6',
    provider: 'claude',
    model: 'claude-opus-4-6',
    label: 'Claude Opus 4.6 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  }
]

const CLAUDE_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

function labelClaudeModel(id: string): string {
  const match = /^claude-(fable|haiku|opus|sonnet)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/.exec(id)
  if (!match) return `${id} · CLI`
  const [, family, major, minor, date] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `Claude ${name} ${major}${minor ? `.${minor}` : ''}${date ? ` (${date})` : ''} · CLI`
}

/**
 * Découvre le catalogue Claude/Fable réellement exposé par le bridge local.
 * Le modèle Codex reste le seul variant ChatGPT prouvé par son transport actuel.
 * Une indisponibilité du bridge retombe sur le seed vérifié, sans inventer de noms.
 */
export async function discoverImportedModels(
  fetchFn: typeof fetch = fetch
): Promise<ImportedModel[]> {
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return DEFAULT_IMPORTED_MODELS
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const discovered = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && /^claude-[a-z0-9-]+$/.test(id))
      .map<ImportedModel>((model) => ({
        id: `claude/${model}`,
        provider: 'claude',
        model,
        label: labelClaudeModel(model),
        reasoningEfforts: [...CLAUDE_EFFORTS],
        defaultReasoningEffort: model.includes('haiku') ? 'medium' : 'high'
      }))
    return [DEFAULT_IMPORTED_MODELS[0], ...discovered]
  } catch {
    return DEFAULT_IMPORTED_MODELS
  }
}

/** Validation stricte d'un modèle importé (avant persistance). */
export function assertImportedModel(model: ImportedModel): ImportedModel {
  const fields: Array<[keyof ImportedModel, unknown]> = [
    ['id', model.id],
    ['provider', model.provider],
    ['model', model.model],
    ['label', model.label]
  ]
  for (const [name, value] of fields) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Modèle importé invalide : champ « ${String(name)} » vide`)
    }
  }
  if (!Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.length === 0) {
    throw new Error(`Modèle importé « ${model.id} » : reasoningEfforts vide`)
  }
  if (!model.reasoningEfforts.includes(model.defaultReasoningEffort)) {
    throw new Error(
      `Modèle importé « ${model.id} » : effort par défaut « ${model.defaultReasoningEffort} » hors liste`
    )
  }
  return model
}

/** Retrouve un modèle importé par son id canonique. */
export function findModel(models: ImportedModel[], id: string): ImportedModel | undefined {
  return models.find((m) => m.id === id)
}

/** Premier modèle importé d'un provider donné (pour une migration/défaut sûr). */
export function defaultModelForProvider(
  models: ImportedModel[],
  provider: string
): ImportedModel | undefined {
  return models.find((m) => m.provider === provider)
}

/**
 * Importe (ajoute ou remplace) un modèle dans la liste, immuablement.
 * Un id déjà présent est REMPLACÉ (import idempotent), jamais dupliqué.
 */
export function importModel(models: ImportedModel[], model: ImportedModel): ImportedModel[] {
  assertImportedModel(model)
  const rest = models.filter((m) => m.id !== model.id)
  return [...rest, { ...model, reasoningEfforts: [...model.reasoningEfforts] }]
}

/** Retire un modèle par id, immuablement. */
export function removeModel(models: ImportedModel[], id: string): ImportedModel[] {
  return models.filter((m) => m.id !== id)
}
