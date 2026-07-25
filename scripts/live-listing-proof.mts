// PREUVE LIVE — exécute la découverte réelle (APIs providers) + résolution des alias.
// Sortie : JSON brut sur stdout (capturé dans le fichier de preuve).
import { discoverImportedModelsDetailed } from '../src/main/models'
import { MODEL_ALIASES, resolveModelAlias } from '../src/main/model-aliases'
import { loadTokens } from '../src/main/providers/codex-auth'

const rawCaptures: Record<string, unknown> = {}

// fetch instrumenté : capture les réponses brutes SANS altérer la découverte.
const instrumentedFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  const response = await fetch(input, init)
  const clone = response.clone()
  let body: unknown
  try {
    body = await clone.json()
  } catch {
    body = await response.clone().text()
  }
  rawCaptures[url] = { status: response.status, body }
  return response
}

const codexTokens = loadTokens()
const discovery = await discoverImportedModelsDetailed(instrumentedFetch, () => codexTokens)

const aliasResolutions = MODEL_ALIASES.map((alias) => {
  const resolved = resolveModelAlias(discovery.models, alias)
  return {
    alias,
    resolved: resolved ?? null,
    // Vérif : l'id résolu est PRÉSENT dans la liste découverte (jamais inventé).
    presentInDiscovery: resolved ? discovery.models.some((m) => m.model === resolved) : false
  }
})

const proof = {
  capturedAt: new Date().toISOString(),
  codexAuthPresent: Boolean(codexTokens),
  live: discovery.live,
  kimi: 'aucune voie de listing HTTP (OAuth/CLI) — seed vérifié only, conforme au design',
  discoveredModels: discovery.models.map((m) => ({ id: m.id, provider: m.provider, model: m.model, label: m.label })),
  aliasResolutions,
  rawApiResponses: rawCaptures
}

console.log(JSON.stringify(proof, null, 2))
