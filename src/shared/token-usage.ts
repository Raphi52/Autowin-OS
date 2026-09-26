/**
 * LA forme de l'usage en tokens — une seule définition pour tous les étages.
 *
 * Avant : cinq déclarations concurrentes (`TokenUsageShape`, `TurnCost`, `CostRow`,
 * `CostSample`/`CostBreakdownRow`, `ExecutionUsageLike`), chacune redéclarant les mêmes champs et
 * en oubliant un au passage. C'est ainsi que l'écriture de cache s'est perdue entre le provider et
 * l'écran, et que le modèle manquait là où il aurait fallu tarifer.
 *
 * Tous les champs sont OPTIONNELS — et doivent le rester : les instantanés déjà persistés
 * (`cost.jsonl`, journaux d'activité, checkpoints du superviseur) n'ont jamais porté les compteurs
 * de cache. Rendre l'un d'eux obligatoire invaliderait une douzaine d'instantanés existants ; le
 * commit `b55e1864` a déjà rencontré ce mur. Les étages qui SAVENT qu'un champ est toujours
 * renseigné le RESSERRENT chez eux (`inputTokens: number`), ce qui est compatible.
 */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  /** Tokens RELUS depuis le cache — SOUS-ENSEMBLE de `inputTokens`. */
  cacheReadTokens?: number
  /** Tokens ÉCRITS dans le cache — SOUS-ENSEMBLE de `inputTokens`, jamais un ajout. */
  cacheCreationTokens?: number
  /**
   * Part de `cacheCreationTokens` écrite avec une durée de vie d'1 HEURE — SOUS-ENSEMBLE, jamais un
   * ajout. Se facture 2× l'entrée, contre 1,25× pour le cache de 5 min. Absent = durée inconnue.
   */
  cacheCreation1hTokens?: number
  /** Modèle concret servi : sans lui, aucun tarif n'est reconstituable. */
  model?: string
  provider?: string
}
