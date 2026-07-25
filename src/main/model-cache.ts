import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ReasoningEffort } from './roles'
import type { ImportedModel, ModelDiscovery } from './models'
import { ensureAutowinAppData } from './app-data'

/**
 * Cache disque de la DERNIÈRE liste de modèles réellement découverte (par voie live).
 * But : au redémarrage hors ligne, retomber sur la dernière liste CONNUE plutôt que
 * sur le seed minimal — sans jamais inventer un nom (le cache n'est écrit qu'à partir
 * d'une découverte live). Fichier : %APPDATA%\autowin-os\models-cache.json.
 */
interface ModelCachePayload {
  version: 1
  savedAt: string
  models: ImportedModel[]
}

const VALID_EFFORTS = new Set<string>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
])

export function modelCachePath(): string {
  return join(ensureAutowinAppData(), 'models-cache.json')
}

function isImportedModel(value: unknown): value is ImportedModel {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    typeof m.provider === 'string' &&
    m.provider.length > 0 &&
    typeof m.model === 'string' &&
    m.model.length > 0 &&
    typeof m.label === 'string' &&
    Array.isArray(m.reasoningEfforts) &&
    m.reasoningEfforts.length > 0 &&
    m.reasoningEfforts.every((e) => typeof e === 'string' && VALID_EFFORTS.has(e)) &&
    typeof m.defaultReasoningEffort === 'string' &&
    (m.reasoningEfforts as ReasoningEffort[]).includes(
      m.defaultReasoningEffort as ReasoningEffort
    )
  )
}

/** Charge le cache ; toute entrée invalide invalide le fichier ENTIER (jamais de nom douteux). */
export function loadModelCache(path = modelCachePath()): ImportedModel[] | undefined {
  if (!existsSync(path)) return undefined
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as ModelCachePayload
    if (payload.version !== 1 || !Array.isArray(payload.models)) return undefined
    if (payload.models.length === 0 || !payload.models.every(isImportedModel)) return undefined
    return payload.models
  } catch {
    return undefined
  }
}

export function saveModelCache(models: ImportedModel[], path = modelCachePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const payload: ModelCachePayload = {
    version: 1,
    savedAt: new Date().toISOString(),
    models
  }
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8')
}

/**
 * Fusion pure découverte × cache, par voie :
 * - voie LIVE → les modèles frais font autorité (et alimenteront le cache) ;
 * - voie en REPLI → la dernière liste connue du cache si elle existe, sinon le seed frais ;
 * - kimi (aucune voie de listing) → toujours la découverte (seed vérifié).
 */
export function mergeDiscoveryWithCache(
  discovery: ModelDiscovery,
  cached: ImportedModel[] | undefined
): ImportedModel[] {
  const pick = (provider: 'codex' | 'claude'): ImportedModel[] => {
    const fresh = discovery.models.filter((m) => m.provider === provider)
    if (discovery.live[provider]) return fresh
    const known = (cached ?? []).filter((m) => m.provider === provider)
    return known.length > 0 ? known : fresh
  }
  return [
    ...pick('codex'),
    ...pick('claude'),
    ...discovery.models.filter((m) => m.provider !== 'codex' && m.provider !== 'claude')
  ]
}
