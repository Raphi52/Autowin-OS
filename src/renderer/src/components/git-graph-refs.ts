/**
 * LES DÉCORATIONS D'UN COMMIT, lues comme SourceTree les affiche.
 *
 * `git log --decorate` rend une chaîne brute par commit : `HEAD -> main`, `origin/main`,
 * `tag: v1.0`. Le graphe les recevait déjà (champ `refs` du modèle) et ne les affichait NULLE PART —
 * or c'est l'étiquette posée sur la ligne qui dit d'un coup d'œil où est la tête et où va une branche.
 */

export type GenreRefCommit = 'head' | 'local' | 'remote' | 'tag'

export interface RefCommit {
  libelle: string
  genre: GenreRefCommit
}

/** Décorations que git ajoute et qui ne désignent aucune branche : les afficher serait du bruit. */
const TECHNIQUES = new Set(['grafted', 'replaced', 'rewritten'])

export function parserRefsCommit(refs: readonly string[] | undefined): RefCommit[] {
  return (refs ?? []).flatMap((brut): RefCommit[] => {
    const ref = brut.trim()
    if (!ref || TECHNIQUES.has(ref)) return []
    if (ref.startsWith('tag: ')) return [{ libelle: ref.slice('tag: '.length), genre: 'tag' }]
    if (ref.startsWith('HEAD -> '))
      return [{ libelle: ref.slice('HEAD -> '.length), genre: 'head' }]
    if (ref === 'HEAD') return [{ libelle: 'HEAD', genre: 'head' }]
    // Tout ce qui porte un `remote/` en tête vient de `refs/remotes` : git n'écrit pas le préfixe.
    if (/^(origin|upstream)\/.+/.test(ref)) return [{ libelle: ref, genre: 'remote' }]
    return [{ libelle: ref, genre: 'local' }]
  })
}

/**
 * Le nom de branche qui donne sa COULEUR à la voie. La locale prime : c'est celle que l'utilisateur
 * manipule. Une étiquette n'est jamais une branche — colorer d'après un tag `rescue/…` ferait changer
 * la couleur d'une branche au gré des sauvetages.
 */
export function brancheDeCommit(refs: readonly string[] | undefined): string | undefined {
  const refsLues = parserRefsCommit(refs)
  const locale = refsLues.find((ref) => ref.genre === 'head' || ref.genre === 'local')
  if (locale && locale.libelle !== 'HEAD') return locale.libelle
  return refsLues.find((ref) => ref.genre === 'remote')?.libelle
}
