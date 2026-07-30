import { DEFAULT_IMPORTED_MODELS, type ImportedModel } from './models'

/**
 * FIXTURE DE TEST UNIQUEMENT — aucun code de production ne doit importer ce module.
 *
 * Pourquoi il existe : depuis le 2026-07-30, `claude` et `codex` n'ont plus d'entree figee dans le
 * code (`DEFAULT_IMPORTED_MODELS` ne porte plus que `kimi` et `gemini`, qui n'ont pas de source
 * dynamique). Un seed statique pour ces deux voies MENTAIT des qu'un modele etait publie : sur un
 * poste sans le service de modeles, Agent Studio annoncait `opus-4-6` comme meilleur opus alors que
 * le service en expose `opus-5`.
 *
 * Les tests de topologie ont pourtant besoin d'un catalogue contenant un modele claude ET un modele
 * codex pour exercer le binding des slots. Ils se servaient du seed comme fixture — usage legitime,
 * mais qui les couplait a une liste de production qui n'existe plus. Ce module leur donne un
 * catalogue EXPLICITEMENT de test, de la meme forme que ce qu'une decouverte live produirait.
 *
 * Consequence voulue : ajouter un modele ici n'ajoute RIEN dans l'application. Le seul moyen de voir
 * un modele claude ou codex dans Autowin reste que la machine l'expose reellement.
 */
const discoveredClaude = (model: string): ImportedModel => ({
  id: `claude/${model}`,
  provider: 'claude',
  model,
  label: `${model} · CLI`,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultReasoningEffort: 'high'
})

const discoveredCodex: ImportedModel = {
  id: 'codex/gpt-5.6-terra',
  provider: 'codex',
  model: 'gpt-5.6-terra',
  label: 'GPT-5.6 Terra · ChatGPT',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultReasoningEffort: 'medium',
  priority: 0,
  visibility: 'list'
}

/** Catalogue de test : les declarations d'adaptateur reelles + une decouverte claude/codex simulee. */
export const TEST_MODEL_CATALOG: ImportedModel[] = [
  discoveredCodex,
  discoveredClaude('claude-fable-5'),
  discoveredClaude('claude-opus-4-6'),
  ...DEFAULT_IMPORTED_MODELS
]
