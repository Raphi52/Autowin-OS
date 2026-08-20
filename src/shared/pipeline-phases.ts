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

/**
 * Ce qu'un NŒUD de graphe peut porter : une phase du pipeline, OU l'identifiant d'une skill
 * quelconque découverte sur disque (`think`, `learn`, `graphify`…).
 *
 * `PipelinePhase` reste un type FERMÉ : les huit phases gardent leur sémantique (verdict du juge,
 * quorum, droits d'écriture de build/clean) et l'exhaustivité de leurs `Record`. Un nœud skill est
 * NEUTRE — pas de verdict, pas de quorum, lecture seule — et c'est `isPipelinePhase` qui sépare les
 * deux partout où la différence compte.
 */
export type NodePhase = PipelinePhase | (string & {})

/** Vrai si ce nœud porte une skill libre plutôt qu'une phase du pipeline. */
export function isSkillNode(value: NodePhase): boolean {
  return !isPipelinePhase(value)
}

/**
 * Un identifiant de nœud est-il BIEN FORMÉ ? (nom de dossier de skill, ou phase du pipeline)
 *
 * La SEULE definition de cette borne. Elle existe parce qu'on l'a apprise trois fois : chaque
 * controle runtime qui validait une phase contre `PIPELINE_PHASES` est devenu FAUX le jour ou le
 * type est passe a `NodePhase`, et le compilateur ne pouvait pas le voir — un `includes()` sur une
 * liste fermee compile parfaitement face a un type elargi.
 *
 * Mesure du 2026-08-20 : trois runs reels sont morts la-dessus. Le premier sur `isRunAgentRef`, le
 * suivant sur `isExecutionQuote`, et deux gardes de plus attendaient leur tour (fan-out, allocation).
 * Corriger au cas par cas aurait produit un quatrieme run mort ; on centralise donc la regle.
 */
export function estIdentifiantDeNoeud(value: unknown): boolean {
  return typeof value === 'string' && /^[\w-]{1,64}$/u.test(value)
}
