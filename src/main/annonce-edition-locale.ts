import type { EditionLocaleNonRemise } from './store/worktree-manager'

/**
 * Phrase qui ANNONCE, dans la réponse d'un run, que la modification non commitée de l'utilisateur
 * n'a pas été toute remise dans ses fichiers après la publication (`editionLocaleNonRemise`).
 *
 * Vécu le 2026-10-24 (conv-1139, run run-58bfc90f8f7b-1) : deux fichiers modifiés par
 * l'utilisateur sont restés dans `stash@{0}`, revenus à la version commitée, et le compte rendu
 * disait seulement « intégré ». Rend `undefined` quand il n'y a rien à annoncer.
 */
export function annonceEditionLocaleNonRemise(issue: unknown): string | undefined {
  if (typeof issue !== 'object' || issue === null) return undefined
  const constat = (issue as { editionLocaleNonRemise?: EditionLocaleNonRemise })
    .editionLocaleNonRemise
  if (!constat || typeof constat !== 'object') return undefined
  const fichiers = Array.isArray(constat.fichiers) ? constat.fichiers : []
  const remise = typeof constat.remise === 'string' ? constat.remise.slice(0, 8) : ''
  const pile = remise ? `la remise de côté \`${remise}\` (\`git stash list\`)` : ''
  if (fichiers.length === 0) {
    if (!remise) return undefined
    return (
      `⚠️ Tes fichiers modifiés et non commités sont revenus, mais ${pile} n'a pas pu être retirée ` +
      `(${constat.cause}). Elle fait doublon : à supprimer quand tu l'auras vérifiée.`
    )
  }
  const liste = fichiers.map((f) => `\`${f}\``).join(', ')
  const ou = [pile, `la sauvegarde \`${constat.sauvegarde}\``].filter(Boolean).join(' et dans ')
  return (
    `⚠️ Ta modification non commitée de ${liste} n'a PAS été remise dans ${fichiers.length > 1 ? 'ces fichiers' : 'ce fichier'} ` +
    `après la publication (${constat.cause}). Elle est intacte dans ${ou} : ` +
    `\`git show ${constat.sauvegarde}:${fichiers[0]}\` la montre.`
  )
}
