/**
 * DECOUPER UN BLOC DE CODE PAR SES ACCOLADES, JAMAIS PAR UN REPERE DE TEXTE.
 *
 * DEFAUT MESURE le 2026-08-26 : trois gardes du depot etaient ROUGES alors que le code qu'ils
 * gardent etait INTACT. Tous decoupaient la source avec une borne fragile :
 *   - `ledger.refus-integration` prenait les 900 PREMIERS caracteres apres `private applyFinalize`
 *     et cherchait l'appel dedans. Un commentaire ajoute plus haut l'avait repousse a 1034.
 *   - `orchestration-state` bornait `relaunchResumableRun` sur un `indexOf("if (reprise === ...")`,
 *     un repere INTERIEUR a la fonction : des que du code s'est deplace, la tranche s'est mise a
 *     couper avant les appels attendus.
 *
 * Dans les deux cas le cablage etait la, un peu plus loin. Elargir la fenetre (900 -> 1200) aurait
 * fait passer la suite au vert en laissant la vraie cause : une borne qui ne suit pas la structure
 * du code recasse au commentaire suivant. Un garde qui crie au loup cesse d'etre cru — et celui-ci
 * bloquait une publication.
 *
 * La borne EST la structure : on compte les accolades depuis l'ancre jusqu'a leur equilibre.
 */
export function corpsDeBloc(source: string, ancre: string): string {
  const debut = source.indexOf(ancre)
  if (debut === -1) return ''
  let profondeur = 0
  let ouvert = false
  for (let i = debut; i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') {
      profondeur += 1
      ouvert = true
    } else if (c === '}') {
      profondeur -= 1
      // L'equilibre retrouve APRES au moins une ouverture ferme le bloc.
      if (ouvert && profondeur === 0) return source.slice(debut, i + 1)
    }
  }
  // Bloc non ferme (source tronquee) : rendre ce qu'on a plutot que rien, l'appelant assertera.
  return source.slice(debut)
}
