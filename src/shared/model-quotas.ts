export interface ModelQuotaWindow {
  id: string
  label: string
  usedPercent: number
  remainingPercent: number
  resetsAt?: string
  modelFamily?: string
  /**
   * Tokens réellement CONSOMMÉS sur la fenêtre, quand ils sont mesurés (source locale).
   * Présent sans `limitKnown` ⇒ on connaît la consommation mais pas le plafond.
   */
  usedTokens?: number
  /**
   * `false` = aucun plafond officiel connu → `usedPercent`/`remainingPercent` ne veulent RIEN dire
   * et NE DOIVENT PAS être affichés comme un quota (honnêteté : on montre les tokens consommés).
   * Absent/`true` = quota officiel exposé par le provider.
   */
  limitKnown?: boolean
}

export type ModelQuotaAvailability = 'available' | 'stale' | 'unavailable'
export type ModelQuotaLevel = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface ModelQuota {
  modelId: string
  model: string
  label: string
  provider: string
  shared: boolean
  status: ModelQuotaAvailability
  source: string
  observedAt?: string
  windows: ModelQuotaWindow[]
  error?: string
}

export interface ModelQuotaSnapshot {
  observedAt: string
  summary: {
    remainingPercent?: number
    status: ModelQuotaLevel
  }
  models: ModelQuota[]
}

/**
 * L'HEURE À LAQUELLE ÇA REDEVIENT POSSIBLE — la seule utile pour PLANIFIER quelque chose.
 *
 * Constat du 2026-09-11 : `resetsAt` est calculé (src/main/model-quotas.ts:62) et stocké, mais hors
 * tests ses seuls lecteurs l'AFFICHENT (ModelQuotaIndicator). Aucune décision ne s'appuie dessus,
 * alors que 136 messages utilisateur ne disent que « reprend » / « go » — l'attente du retour de
 * quota est faite à la main. Ce sélecteur est le premier consommateur qui AGIT sur la donnée.
 *
 * Trois règles, toutes issues de ce que le planificateur exige pour ne pas se tromper :
 *  - un reset DÉJÀ PASSÉ n'est pas une échéance : il armerait un minuteur qui part immédiatement ;
 *  - une fenêtre sans `resetsAt` est IGNORÉE, jamais devinée (l'UI dit « reset non exposé ») ;
 *  - de plusieurs échéances futures, la PLUS PROCHE gagne : c'est elle qui rend la main en premier.
 *
 * `maintenant` est un paramètre et non `Date.now()` en dur : sans lui, la fonction n'est pas
 * testable sur ses cas limites, et c'est justement là qu'elle se trompe.
 */
export function prochainResetUtile(
  snapshot: Pick<ModelQuotaSnapshot, 'models'> | null | undefined,
  maintenant: Date = new Date()
): string | undefined {
  const seuil = maintenant.valueOf()
  if (!Number.isFinite(seuil)) return undefined
  let meilleur: { iso: string; at: number } | undefined
  for (const model of snapshot?.models ?? []) {
    for (const window of model?.windows ?? []) {
      const iso = window?.resetsAt
      if (!iso) continue
      const at = new Date(iso).valueOf()
      // Une date illisible n'est pas une échéance : la planifier ferait partir un minuteur au hasard.
      if (!Number.isFinite(at)) continue
      // STRICTEMENT futur : un reset qui tombe pile MAINTENANT est déjà consommé.
      if (at <= seuil) continue
      if (!meilleur || at < meilleur.at) meilleur = { iso, at }
    }
  }
  return meilleur?.iso
}
