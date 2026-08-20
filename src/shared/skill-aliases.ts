/**
 * ALIAS d'invocation `/` → identifiant RÉEL de la skill (= nom de dossier sur disque).
 *
 * Pourquoi ici et pas dans `main/` : la palette du composer vit côté renderer, l'injection du corps
 * vit côté main. Deux listes = l'« étiquette qui mentait » (palette qui propose ce que le main ne
 * charge pas, cf. `skill-invocation.test.ts`). `shared/` est le seul endroit visible des deux côtés.
 *
 * Un alias ne DUPLIQUE jamais le corps : il ne fait que renommer l'entrée. La cible reste un nom de
 * dossier, donc la garde anti-traversée de `skillInstruction` s'applique inchangée APRÈS résolution.
 */
export const SKILL_ALIASES: Readonly<Record<string, string>> = {
  // `front-converge` est long à taper et l'utilisateur l'appelle « design ».
  design: 'front-converge'
}

/** Résout un alias vers l'id réel ; rend l'entrée telle quelle si ce n'en est pas un. */
export function resolveSkillAlias(id: string): string {
  return SKILL_ALIASES[id.toLowerCase()] ?? id
}
