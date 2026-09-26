/**
 * LIBELLÉ AFFICHABLE d'un run. Le `subject` est un NOM DE DOSSIER
 * (`<slug>-<ts36>-workspace`, le suffixe `-workspace` déjà retiré) : c'est l'identifiant que
 * `@run:` résout, il ne change pas. Mais l'afficher tel quel montrait des tirets et une marque
 * horodatée (`…-mtd23401`) — du bruit pour l'œil. Cette fonction ne sert QUE l'affichage.
 *
 * La marque n'est retirée que si le dernier segment ressemble à un horodatage base 36 :
 * ≥ 6 caractères ET contenant au moins un chiffre. `v2` ou `court` restent donc intacts.
 */
const MARQUE_TS36 = /-(?=[a-z0-9]{6,}$)(?=[a-z0-9]*\d)[a-z0-9]+$/

export function libelleRun(subject: string): string {
  const sansMarque = subject.replace(MARQUE_TS36, '')
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(sansMarque)) return subject
  const mots = sansMarque.split('-').join(' ')
  return mots.charAt(0).toUpperCase() + mots.slice(1)
}
