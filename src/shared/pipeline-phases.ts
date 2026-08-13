/**
 * LES PHASES DU PIPELINE — une seule liste, partagée par le moteur et l'interface.
 *
 * Il y en avait DEUX, et la seconde était périmée :
 *  - `src/main/skill-pipeline.ts` en déclarait huit, dont `remake` ;
 *  - `src/renderer/src/components/workflow-executability.ts` en recopiait sept à la main, SANS
 *    `remake`.
 *
 * Conséquence observée chez l'utilisateur : l'onglet Workflows affichait un badge d'anomalie « 1 »
 * accusant son profil « Remake » d'être injouable — alors que le moteur sait parfaitement jouer cette
 * phase, et que `workflow-defaults.ts` livre ce profil PAR DÉFAUT. L'app signalait donc comme cassé un
 * workflow qu'elle fournit elle-même. Un faux positif sur un indicateur d'alerte est pire qu'une
 * absence d'indicateur : il apprend à ignorer l'alerte.
 *
 * La liste vit ici, dans `shared/`, parce que c'est le SEUL endroit que le processus principal et le
 * renderer peuvent tous deux importer sans franchir la frontière Electron. Ajouter une phase se fait
 * désormais à un seul endroit — et si quelqu'un l'oublie, le typage le lui dira.
 */
export const PIPELINE_PHASES = [
  'scout',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge',
  'kaizen',
  'remake'
] as const

export type PipelinePhase = (typeof PIPELINE_PHASES)[number]

const PHASES = new Set<string>(PIPELINE_PHASES)

/** Vrai si la phase est jouable par le moteur. Utilisé par l'UI pour ne PAS crier au loup. */
export function isPipelinePhase(value: string): value is PipelinePhase {
  return PHASES.has(value)
}
