/**
 * Le titre des blocs git posés dans le fil — la passe /git après un fil (`bandeauPublie`,
 * `git-apres-fil.ts`) et la clôture automatique d'un run (`annonce-commit-local.ts`).
 *
 * L'utilisateur veut un STATUT qui se lit seul, « 1 commit et push origin main réussi ».
 * « GIT : 1 commit » comptait les commits sans dire si le push avait abouti ni où.
 */

/**
 * Où le push est parti, lu dans la DERNIÈRE ligne `git push <distant> <réf>` : « origin main » pour
 * `git push -q origin HEAD:main`. `undefined` quand la ligne ne le dit pas (`git push` nu,
 * `git push origin 2>&1`) : le titre dit alors « push » sans destination plutôt que d'en inventer une.
 */
export function destinationDuPush(lignes: readonly string[]): string | undefined {
  const motif =
    /\bgit\s+push((?:\s+-\S+)*)\s+([^\s;|&<>-][^\s;|&<>]*)\s+([^\s;|&<>-][^\s;|&<>]*)(?=\s|$|[;|&])/g
  const dernier = [...lignes.join('\n').matchAll(motif)].at(-1)
  if (!dernier) return undefined
  const [, , distant = '', refspec = ''] = dernier
  const cible = (refspec.replace(/^\+/, '').split(':').at(-1) ?? '').replace(/^refs\/heads\//, '')
  return cible ? `${distant} ${cible}` : undefined
}

/**
 * Le statut du bloc. Il n'est posé que pour des commits déjà lus sur l'amont : sans ligne de push
 * retrouvée, ils sont « en ligne », jamais « réussi » sur une commande qu'on n'a pas vue.
 */
export function titreDuBandeau(n: number, lignesShell: readonly string[]): string {
  const commits = `${n} commit${n > 1 ? 's' : ''}`
  if (!/\bgit\s+push\b/.test(lignesShell.join('\n'))) return `${commits} en ligne`
  const destination = destinationDuPush(lignesShell)
  return `${commits} et push ${destination ? `${destination} ` : ''}réussi`
}
