import { readDurableJson, writeDurableJson } from './durable-json'

/**
 * Opt-in PERSISTANT du pilote de routage shadow, pilotable depuis la vue Settings.
 *
 * Pourquoi : le seul interrupteur existant était la variable d'environnement
 * `AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED`, qu'aucun code du dépôt ne pose jamais et qu'un utilisateur
 * d'app packagée ne peut pas poser. La boucle « quelle route tient le vert au coût le plus bas »
 * restait donc vide à jamais. Ce réglage réutilise le mécanisme de préférences déjà en place
 * (`durable-json`, comme `orchestration-budget.json`) : aucun second système de préférences.
 *
 * Le défaut reste OFF, décision délibérée : rien n'est mesuré sans opt-in explicite.
 */
export interface ShadowRoutingPilotSetting {
  enabled: boolean
}

/** État rendu à l'UI : le réglage, son effet réel, et l'éventuelle surcharge d'environnement. */
export interface ShadowRoutingPilotState extends ShadowRoutingPilotSetting {
  /** Vrai quand le runtime shadow est réellement actif (env pris en compte). */
  active: boolean
  /** `true`/`false` quand l'environnement force le pilote, `null` quand il laisse décider. */
  envOverride: boolean | null
}

export const DEFAULT_SHADOW_ROUTING_PILOT: ShadowRoutingPilotSetting = { enabled: false }

function decodeStoredShadowRoutingPilot(value: unknown): ShadowRoutingPilotSetting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const proposed = value as Partial<ShadowRoutingPilotSetting>
  if (typeof proposed.enabled !== 'boolean') return undefined
  return { enabled: proposed.enabled }
}

/**
 * Lecture tolérante : ce réglage est lu au DÉMARRAGE du process principal. Un fichier corrompu ne
 * doit jamais empêcher l'app de démarrer, et OFF est le repli sûr (aucune collecte implicite).
 * Aucun fichier n'est créé par la lecture.
 */
export function loadShadowRoutingPilotSetting(path: string): ShadowRoutingPilotSetting {
  try {
    return (
      readDurableJson(path, decodeStoredShadowRoutingPilot) ?? { ...DEFAULT_SHADOW_ROUTING_PILOT }
    )
  } catch {
    return { ...DEFAULT_SHADOW_ROUTING_PILOT }
  }
}

/** Écrit l'opt-in de façon durable. Refuse toute valeur non booléenne sans rien écrire. */
export function saveShadowRoutingPilotSetting(
  path: string,
  value: unknown
): ShadowRoutingPilotSetting {
  if (typeof value !== 'boolean') {
    throw new Error('Le pilote de routage shadow attend un booleen.')
  }
  const setting: ShadowRoutingPilotSetting = { enabled: value }
  writeDurableJson(path, setting, decodeStoredShadowRoutingPilot)
  return setting
}
