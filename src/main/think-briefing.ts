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
 * PUR : pas d'horloge, pas de provider, aucune E/S (git est passe en parametre a `sansThinkPerime`).
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

// fix-ok: run-85d8e7f57af2-1 réparation 2 — ce bloc a été ajouté par un heredoc bash qui a mangé
// les doubles barres obliques inverses des regex (esbuild : « think-briefing.ts:93:51 Unterminated
// string literal ») ; les regex ont été rétablies par une édition directe, sans changer la logique.
/**
 * LE PREMIER FICHIER CITE PAR LE BRIEFING QUI A CHANGE, ou `undefined`.
 *
 * Un briefing repris pointe des lignes (`Localisation`) : si l'un des fichiers qu'il cite a change
 * depuis le commit qu'il a lu, ses reperes peuvent etre faux. Un fichier compte comme cite si son
 * chemin complet OU son nom seul apparait : un briefing ecrit souvent `workflow-walk.ts:76` sans le
 * dossier. Le nom seul peut rejeter a tort (deux `index.ts`) — l'erreur coute alors un `think`
 * rejoue, jamais un briefing perime repris.
 */
export function fichierCiteModifie(
  briefing: string,
  modifies: readonly string[]
): string | undefined {
  const texte = (briefing ?? '').replace(/\\/g, '/')
  return modifies.find((chemin) => {
    const propre = chemin.replace(/\\/g, '/').trim()
    if (!propre) return false
    if (texte.includes(propre)) return true
    const nom = propre.split('/').pop() ?? ''
    const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return nom.length > 0 && new RegExp(`(^|[^\\w.-])${echappe}(?![\\w-])`, 'u').test(texte)
  })
}

/**
 * L'acquis repris, SANS le briefing `think` quand il est perime ou qu'on ne peut pas le savoir.
 *
 * `fichiersModifiesDepuis(sha)` rend les fichiers changes entre ce commit et le code d'aujourd'hui,
 * ou `undefined` s'il ne sait pas (commit inconnu, git en echec). Le doute rejoue `think` : c'est
 * l'etat d'avant la reprise, jamais un briefing faux. Les autres phases passent telles quelles.
 */
export async function sansThinkPerime<T extends { phase: string; text: string; codeSha?: string }>(
  acquis: readonly T[],
  fichiersModifiesDepuis: (sha: string) => Promise<readonly string[] | undefined>
): Promise<T[]> {
  const think = acquis.find((output) => output.phase === 'think')
  if (!think) return [...acquis]
  const modifies = think.codeSha ? await fichiersModifiesDepuis(think.codeSha) : undefined
  const perime = !modifies || fichierCiteModifie(think.text, modifies) !== undefined
  return perime ? acquis.filter((output) => output !== think) : [...acquis]
}
