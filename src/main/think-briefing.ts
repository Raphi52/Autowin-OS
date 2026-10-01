/**
 * UN BRIEFING `think` QUI N'A PAS LA FORME D'UN BRIEFING EST SIGNALE A L'ETAPE SUIVANTE.
 *
 * Meme geste que `scout-cible.ts` : la garde est de FORME (les six titres de
 * `skills/think/SKILL.md` §5 sont-ils la, oui ou non), jamais de qualite — producteur et juge etant
 * le meme modele, seule une verification de forme est falsifiable.
 *
 * CE QUI LA JUSTIFIE, mesure le 2026-10-01 sur `run-state/*.json` : 5 sorties `think` sur 34 n'ont
 * pas les six titres. Ce ne sont pas des briefings mal rediges : `think` y a fait le travail d'une
 * AUTRE etape (un SOP, un `## Besoin`, un compte rendu de construction, un verdict), et l'etape
 * suivante le recevait comme un briefing. Sans `## Trous`, rien ne lui dit ce qui n'a pas ete cherche.
 *
 * CE QUI LA DISTINGUE DE `frame-cas-limites.ts` : AUCUNE relance. `think` ignore toute ligne
 * `SUITE:` (`recordPhase`, orchestrator.ts), et refaire un briefing coute 1 a 2 $ sans garantir
 * mieux. L'avertissement en TETE suffit a ce qu'un texte qui n'est pas un briefing ne soit pas lu
 * comme tel.
 *
 * PUR : pas d'horloge, pas de provider, aucune E/S.
 */

/** Les six titres de `skills/think/SKILL.md` §5, normalises (sans accent, sans casse). */
export const TITRES_BRIEFING = [
  'localisation',
  'cartographie',
  'decisions',
  'constats',
  'contraintes',
  'trous'
] as const

/** Marque de l'avertissement deja pose — rend l'application idempotente. */
const MARQUE = '⚠️ Briefing `think` incomplet'

function normaliser(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Les titres de §5 absents du texte, dans l'ordre de la skill.
 *
 * Un titre compte s'il ouvre une ligne `#`/`##`/`###` dont le premier mot est le titre attendu :
 * `## Décisions (options écartées)` vaut `decisions`. Un mot cite en prose ne compte pas.
 */
export function titresBriefingManquants(texte: string): string[] {
  const presents = new Set(
    (texte ?? '')
      .split('\n')
      .map((ligne) => /^\s{0,3}#{1,3}\s+(.+)$/u.exec(ligne)?.[1])
      .filter((titre): titre is string => Boolean(titre))
      .map((titre) => normaliser(titre).split(' ')[0])
  )
  return TITRES_BRIEFING.filter((titre) => !presents.has(titre))
}

/**
 * La sortie `think` telle qu'elle doit etre ENREGISTREE et portee a la suite.
 *
 * Inchangee quand les six titres sont la. Sinon l'avertissement est mis en TETE, nommant les titres
 * absents. Idempotente : un texte deja averti ne l'est pas deux fois.
 */
export function sortieThinkAvecForme(texte: string): string {
  if ((texte ?? '').includes(MARQUE)) return texte
  const manquants = titresBriefingManquants(texte)
  if (!manquants.length) return texte
  const liste = manquants.map((titre) => `\`${titre}\``).join(', ')
  return (
    `${MARQUE} — titres absents : ${liste}.\n` +
    "Ce texte n'a pas la forme demandée par `skills/think/SKILL.md` §5 : l'étape `think` a peut-être " +
    "fait le travail d'une autre étape. Ne tiens pas pour cherché ce qu'il ne dit pas : relis " +
    'toi-même ce dont ta tâche dépend.\n\n' +
    (texte ?? '')
  )
}
