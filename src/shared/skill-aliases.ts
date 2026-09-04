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
  // Aucun alias actif. `/design` a été retiré sur demande de l'utilisateur (03/09/2026) :
  // `draft` s'invoque par son seul nom de dossier.
}

/** Résout un alias vers l'id réel ; rend l'entrée telle quelle si ce n'en est pas un. */
export function resolveSkillAlias(id: string): string {
  return SKILL_ALIASES[id.toLowerCase()] ?? id
}

/**
 * Une SEULE faute de frappe sépare-t-elle `a` de `b` ? (insertion, suppression ou substitution)
 *
 * Défaut vécu le 2026-09-04 (conv-257) : `/draf` — une lettre manquante — n'a résolu AUCUNE skill.
 * `skillInstruction` rend alors la chaîne vide EN SILENCE : le corps de `draft` n'a jamais été
 * injecté, l'agent a improvisé une maquette hors de toutes les règles de la skill, et personne —
 * ni l'utilisateur ni l'agent — n'a su que la commande n'avait pas pris. Un `/` mal tapé doit
 * porter, pas échouer sans bruit.
 */
export function uneSeuleFauteDeFrappe(a: string, b: string): boolean {
  if (a === b) return false
  const [court, long] = a.length <= b.length ? [a, b] : [b, a]
  if (long.length - court.length > 1) return false
  let i = 0
  let j = 0
  let fautes = 0
  while (i < court.length && j < long.length) {
    if (court[i] === long[j]) {
      i++
      j++
      continue
    }
    if (++fautes > 1) return false
    if (court.length === long.length) {
      i++
      j++
    } else {
      j++
    }
  }
  return fautes + (long.length - j) === 1
}

/**
 * Rattrape un `/nom` mal tapé vers la SEULE skill connue à une faute près.
 *
 * Volontairement STRICT : deux candidats (`/buld` entre `build` et `bold`) = AUCUNE correction.
 * Deviner à la place de l'utilisateur coûte plus cher que de ne rien faire.
 */
export function corrigeSkillMalTapee(
  id: string,
  nomsConnus: Iterable<string>
): string | undefined {
  const cible = id.toLowerCase()
  const candidats = [...new Set([...nomsConnus].map((n) => n.toLowerCase()))].filter((n) =>
    uneSeuleFauteDeFrappe(cible, n)
  )
  return candidats.length === 1 ? candidats[0] : undefined
}
